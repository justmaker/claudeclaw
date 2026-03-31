import { ensureProjectClaudeMd, run, runUserMessage, compactCurrentSession, onProgress, clearProgressCallback } from "../runner";
import { getSettings, loadSettings } from "../config";
import { getQueueManager } from "../queue-manager";
import { resetSession, peekSession } from "../sessions";
import { transcribeAudioToText } from "../whisper";
import { resolveSkillPrompt } from "../skills";
import { mkdir } from "node:fs/promises";
import { extname, join } from "node:path";

// --- Signal REST API Client (for signal-cli-rest-api) ---

let signalDebug = false;

function debugLog(message: string): void {
  if (!signalDebug) return;
  console.log(`[Signal][debug] ${message}`);
}

function getApiUrl(): string {
  return getSettings().signal.apiUrl.replace(/\/+$/, "");
}

function getPhone(): string {
  return getSettings().signal.phone;
}

async function callSignalApi<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const url = `${getApiUrl()}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Signal API ${method} ${path}: ${res.status} ${res.statusText} ${text}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return {} as T;
}

// --- Message types ---

interface SignalAttachment {
  contentType: string;
  filename?: string;
  id: string;
  size?: number;
}

interface SignalDataMessage {
  timestamp: number;
  message?: string;
  attachments?: SignalAttachment[];
  reaction?: {
    emoji: string;
    targetAuthor: string;
    targetSentTimestamp: number;
  };
}

interface SignalEnvelope {
  source: string;
  sourceDevice?: number;
  timestamp: number;
  dataMessage?: SignalDataMessage;
  typingMessage?: { action: string };
}

// --- Helpers ---

function isImageAttachment(att: SignalAttachment): boolean {
  return att.contentType.startsWith("image/");
}

function isVoiceAttachment(att: SignalAttachment): boolean {
  return (
    att.contentType.startsWith("audio/") ||
    att.contentType === "application/ogg"
  );
}

function extensionFromMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "application/ogg": ".ogg",
  };
  return map[mimeType] ?? "";
}

async function downloadAttachment(
  attachmentId: string,
  mimeType: string,
  label: string
): Promise<string | null> {
  try {
    const url = `${getApiUrl()}/v1/attachments/${attachmentId}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    const dir = join(process.cwd(), ".claude", "claudeclaw", "inbox", "signal");
    await mkdir(dir, { recursive: true });

    const ext = extensionFromMimeType(mimeType) || ".bin";
    const filename = `${label}-${Date.now()}${ext}`;
    const localPath = join(dir, filename);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await Bun.write(localPath, bytes);
    debugLog(`Downloaded attachment: ${localPath} (${bytes.length} bytes)`);
    return localPath;
  } catch (err) {
    console.error(
      `[Signal] Failed to download attachment ${attachmentId}: ${err instanceof Error ? err.message : err}`
    );
    return null;
  }
}

async function sendMessage(recipient: string, message: string): Promise<void> {
  const MAX_LEN = 4096;
  for (let i = 0; i < message.length; i += MAX_LEN) {
    await callSignalApi("POST", "/v2/send", {
      message: message.slice(i, i + MAX_LEN),
      number: getPhone(),
      recipients: [recipient],
    });
  }
}

async function sendTyping(recipient: string): Promise<void> {
  try {
    await callSignalApi("PUT", "/v1/typing-indicator/" + encodeURIComponent(getPhone()), {
      recipient,
    });
  } catch {
    // typing indicator is best-effort
  }
}

async function sendReaction(
  recipient: string,
  emoji: string,
  targetAuthor: string,
  targetTimestamp: number
): Promise<void> {
  try {
    await callSignalApi("POST", "/v1/reactions/" + encodeURIComponent(getPhone()), {
      reaction: emoji,
      recipient,
      target_author: targetAuthor,
      timestamp: targetTimestamp,
    });
  } catch (err) {
    debugLog(`Failed to send reaction: ${err instanceof Error ? err.message : err}`);
  }
}

function extractReactionDirective(text: string): {
  cleanedText: string;
  reactionEmoji: string | null;
} {
  let reactionEmoji: string | null = null;
  const cleanedText = text
    .replace(/\[react:([^\]\r\n]+)\]/gi, (_match, raw) => {
      const candidate = String(raw).trim();
      if (!reactionEmoji && candidate) reactionEmoji = candidate;
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanedText, reactionEmoji };
}

function extractCommand(text: string): string | null {
  const firstToken = text.trim().split(/\s+/, 1)[0];
  if (!firstToken.startsWith("/")) return null;
  return firstToken.toLowerCase();
}

// --- Message handler ---

async function handleEnvelope(envelope: SignalEnvelope): Promise<void> {
  const config = getSettings().signal;
  const sender = envelope.source;
  const data = envelope.dataMessage;

  if (!data) return;
  if (data.reaction) return;

  if (
    config.allowedNumbers.length > 0 &&
    !config.allowedNumbers.includes(sender)
  ) {
    debugLog(`Ignored message from unauthorized number: ${sender}`);
    return;
  }

  const text = data.message?.trim() ?? "";
  const attachments = data.attachments ?? [];
  const hasImage = attachments.some(isImageAttachment);
  const hasVoice = attachments.some(isVoiceAttachment);

  if (!text && !hasImage && !hasVoice) {
    debugLog(`Skip empty message from ${sender}`);
    return;
  }

  const command = text ? extractCommand(text) : null;

  if (command === "/start") {
    await sendMessage(sender, "Hello! Send me a message and I'll respond using Claude.\nUse /reset to start a fresh session.");
    return;
  }

  if (command === "/reset") {
    await resetSession();
    await sendMessage(sender, "Session reset. Next message starts fresh.");
    return;
  }

  if (command === "/compact") {
    await sendMessage(sender, "⏳ Compacting session...");
    const result = await compactCurrentSession();
    await sendMessage(sender, result.message);
    return;
  }

  if (command === "/status") {
    const session = await peekSession();
    const settings = getSettings();
    if (!session) {
      await sendMessage(sender, "📊 No active session.");
      return;
    }
    const lines = [
      "📊 Session Status",
      `Session: ${session.sessionId.slice(0, 8)}`,
      `Turns: ${session.turnCount ?? 0}`,
      `Model: ${settings.model || "default"}`,
      `Security: ${settings.security.level}`,
    ];
    await sendMessage(sender, lines.join("\n"));
    return;
  }

  const label = sender.replace(/[^+\d]/g, "").slice(-4) || "unknown";
  const mediaParts = [hasImage ? "image" : "", hasVoice ? "voice" : ""].filter(Boolean);
  const mediaSuffix = mediaParts.length > 0 ? ` [${mediaParts.join("+")}]` : "";
  console.log(
    `[${new Date().toLocaleTimeString()}] Signal ${label}${mediaSuffix}: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`
  );

  const typingInterval = setInterval(() => sendTyping(sender), 4000);

  try {
    await sendTyping(sender);

    let imagePath: string | null = null;
    let voicePath: string | null = null;
    let voiceTranscript: string | null = null;

    if (hasImage) {
      const imageAtt = attachments.find(isImageAttachment)!;
      imagePath = await downloadAttachment(imageAtt.id, imageAtt.contentType, label);
    }

    if (hasVoice) {
      const voiceAtt = attachments.find(isVoiceAttachment)!;
      voicePath = await downloadAttachment(voiceAtt.id, voiceAtt.contentType, label);

      if (voicePath) {
        try {
          debugLog(`Voice file saved: path=${voicePath}`);
          voiceTranscript = await transcribeAudioToText(voicePath, {
            debug: signalDebug,
            log: (message) => debugLog(message),
          });
        } catch (err) {
          console.error(`[Signal] Failed to transcribe voice for ${label}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    let skillContext: string | null = null;
    if (command && !["/start", "/reset", "/compact", "/status"].includes(command)) {
      try {
        skillContext = await resolveSkillPrompt(command);
        if (skillContext) debugLog(`Skill resolved for ${command}: ${skillContext.length} chars`);
      } catch (err) {
        debugLog(`Skill resolution failed for ${command}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const promptParts = [`[Signal from ${sender}]`];
    if (skillContext) {
      const args = text.trim().slice(command!.length).trim();
      promptParts.push(`<command-name>${command}</command-name>`);
      promptParts.push(skillContext);
      if (args) promptParts.push(`User arguments: ${args}`);
    } else if (text) {
      promptParts.push(`Message: ${text}`);
    }
    if (imagePath) {
      promptParts.push(`Image path: ${imagePath}`);
      promptParts.push("The user attached an image. Inspect this image file directly before answering.");
    } else if (hasImage) {
      promptParts.push("The user attached an image, but downloading it failed. Respond and ask them to resend.");
    }
    if (voiceTranscript) {
      promptParts.push(`Voice transcript: ${voiceTranscript}`);
      promptParts.push("The user attached voice audio. Use the transcript as their spoken message.");
    } else if (hasVoice) {
      promptParts.push("The user attached voice audio, but it could not be transcribed. Respond and ask them to resend a clearer clip.");
    }

    const prefixedPrompt = promptParts.join("\n");
    const qm = getQueueManager(getSettings().maxConcurrent);

    onProgress((update) => {
      sendMessage(sender, update.message).catch(() => {});
    });

    const result = await qm.enqueue(sender, () => runUserMessage("signal", prefixedPrompt));
    clearProgressCallback();

    if (result.exitCode !== 0) {
      await sendMessage(sender, `Error (exit ${result.exitCode}): ${result.stderr || result.stdout || "Unknown error"}`);
    } else {
      const { cleanedText, reactionEmoji } = extractReactionDirective(result.stdout || "");
      if (reactionEmoji) {
        await sendReaction(sender, reactionEmoji, sender, data.timestamp);
      }
      await sendMessage(sender, cleanedText || "(empty response)");
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Signal] Error for ${label}: ${errMsg}`);
    await sendMessage(sender, `Error: ${errMsg}`);
  } finally {
    clearInterval(typingInterval);
  }
}

// --- Polling loop (signal-cli-rest-api /v1/receive) ---

let running = true;

async function poll(): Promise<void> {
  const config = getSettings().signal;
  const phone = encodeURIComponent(config.phone);

  console.log("Signal listener started (polling)");
  console.log(`  Phone: ${config.phone}`);
  console.log(`  API URL: ${config.apiUrl}`);
  console.log(`  Allowed numbers: ${config.allowedNumbers.length === 0 ? "all" : config.allowedNumbers.join(", ")}`);
  if (signalDebug) console.log("  Debug: enabled");

  while (running) {
    try {
      const data = await callSignalApi<SignalEnvelope[]>(
        "GET",
        `/v1/receive/${phone}?timeout=30`
      );

      if (!data || !Array.isArray(data) || data.length === 0) continue;

      for (const envelope of data) {
        debugLog(`Envelope from=${envelope.source} keys=${Object.keys(envelope).join(",")}`);
        handleEnvelope(envelope).catch((err) => {
          console.error(`[Signal] Unhandled: ${err}`);
        });
      }
    } catch (err) {
      if (!running) break;
      console.error(`[Signal] Poll error: ${err instanceof Error ? err.message : err}`);
      await Bun.sleep(5000);
    }
  }
}

// --- Exports ---

export { sendMessage };

process.on("SIGTERM", () => { running = false; });
process.on("SIGINT", () => { running = false; });

export function startPolling(debug = false): void {
  signalDebug = debug;
  (async () => {
    await ensureProjectClaudeMd();
    await poll();
  })().catch((err) => {
    console.error(`[Signal] Fatal: ${err}`);
  });
}

export async function signal() {
  await loadSettings();
  await ensureProjectClaudeMd();
  await poll();
}
