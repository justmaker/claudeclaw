import { ensureProjectClaudeMd, runUserMessage, compactCurrentSession, onProgress, clearProgressCallback, onStreamChunk, clearStreamCallback } from "../runner";
import { getSettings, loadSettings } from "../config";
import { StreamHandler } from "../stream-handler";
import { getQueueManager } from "../queue-manager";
import { resetSession, peekSession } from "../sessions";
import { transcribeAudioToText } from "../whisper";
import { resolveSkillPrompt } from "../skills";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { App, type GenericMessageEvent } from "@slack/bolt";

let slackDebug = false;
function debugLog(msg: string): void { if (slackDebug) console.log(`[Slack][debug] ${msg}`); }

let app: App | null = null;
let appRunning = false;

function isAllowedUser(userId: string): boolean {
  const c = getSettings().slack;
  return !c.allowedUsers?.length || c.allowedUsers.includes(userId);
}

function isListenChannel(channelId: string): boolean {
  const c = getSettings().slack;
  return !c.listenChannels?.length || c.listenChannels.includes(channelId);
}

function isImageFile(m: string | undefined): boolean { return (m ?? "").startsWith("image/"); }
function isAudioFile(m: string | undefined): boolean { const s = m ?? ""; return s.startsWith("audio/") || s === "application/ogg"; }

function extensionFromMimeType(t: string): string {
  const m: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/webm": ".webm", "application/ogg": ".ogg" };
  return m[t] ?? "";
}

async function downloadSlackFile(url: string, mimeType: string, label: string): Promise<string | null> {
  try {
    const config = getSettings().slack;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${config.botToken}` } });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const dir = join(process.cwd(), ".claude", "claudeclaw", "inbox", "slack");
    await mkdir(dir, { recursive: true });
    const ext = extensionFromMimeType(mimeType) || ".bin";
    const localPath = join(dir, `${label}-${Date.now()}${ext}`);
    await Bun.write(localPath, new Uint8Array(await res.arrayBuffer()));
    return localPath;
  } catch (err) { console.error(`[Slack] Download failed: ${err instanceof Error ? err.message : err}`); return null; }
}

function extractCommand(t: string): string | null { const f = t.trim().split(/\s+/, 1)[0]; return f.startsWith("/") ? f.toLowerCase() : null; }

function extractReactionDirective(text: string): { cleanedText: string; reactionEmoji: string | null } {
  let reactionEmoji: string | null = null;
  const cleanedText = text.replace(/\[react:([^\]\r\n]+)\]/gi, (_m, raw) => { const c = String(raw).trim(); if (!reactionEmoji && c) reactionEmoji = c; return ""; }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { cleanedText, reactionEmoji };
}

function markdownToSlackMrkdwn(t: string): string {
  if (!t) return "";
  return t.replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/__(.+?)__/g, "*$1*").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>").replace(/~~(.+?)~~/g, "~$1~");
}

async function sendSlackMessage(channel: string, text: string, threadTs?: string): Promise<string | undefined> {
  if (!app) return undefined;
  const MAX = 3900; let lastTs: string | undefined;
  for (let i = 0; i < text.length; i += MAX) {
    const r = await app.client.chat.postMessage({ channel, text: markdownToSlackMrkdwn(text.slice(i, i + MAX)), thread_ts: threadTs });
    lastTs = r.ts as string | undefined;
  }
  return lastTs;
}

async function addReaction(channel: string, timestamp: string, emoji: string): Promise<void> {
  if (!app) return;
  try { await app.client.reactions.add({ channel, name: emoji.replace(/:/g, ""), timestamp }); } catch {}
}

async function sendTypingIndicator(channel: string, threadTs?: string): Promise<string | undefined> {
  if (!app) return undefined;
  try { const r = await app.client.chat.postMessage({ channel, text: "⏳ _思考中..._", thread_ts: threadTs }); return r.ts as string | undefined; } catch { return undefined; }
}

async function deleteMessage(channel: string, ts: string): Promise<void> {
  if (!app) return;
  try { await app.client.chat.delete({ channel, ts }); } catch {}
}

async function handleMessage(event: GenericMessageEvent, isDM: boolean): Promise<void> {
  const userId = event.user;
  const channelId = event.channel;
  const text = (event.text ?? "").trim();
  const threadTs = event.thread_ts ?? event.ts;
  const files = (event as any).files as Array<{ url_private_download?: string; url_private?: string; mimetype?: string }> | undefined;

  if (!userId) return;
  if (!isAllowedUser(userId)) return;
  if (!isDM && !isListenChannel(channelId)) return;

  const hasImage = files?.some(f => isImageFile(f.mimetype)) ?? false;
  const hasVoice = files?.some(f => isAudioFile(f.mimetype)) ?? false;
  if (!text && !hasImage && !hasVoice) return;

  const command = text ? extractCommand(text) : null;
  if (command === "/reset") { await resetSession(); await sendSlackMessage(channelId, "Session reset。", threadTs); return; }
  if (command === "/compact") { await sendSlackMessage(channelId, "⏳ 壓縮中...", threadTs); const r = await compactCurrentSession(); await sendSlackMessage(channelId, r.message, threadTs); return; }
  if (command === "/status") {
    const s = await peekSession(); const st = getSettings();
    if (!s) { await sendSlackMessage(channelId, "📊 無進行中 session。", threadTs); return; }
    await sendSlackMessage(channelId, `📊 Session: ${s.sessionId.slice(0,8)} | Turns: ${s.turnCount??0} | Model: ${st.model||"default"}`, threadTs); return;
  }

  const label = userId.slice(-4);
  console.log(`[${new Date().toLocaleTimeString()}] Slack ${label}: "${text.slice(0,60)}"`);
  const typingTs = await sendTypingIndicator(channelId, threadTs);

  try {
    let imagePath: string | null = null, voicePath: string | null = null, voiceTranscript: string | null = null;
    if (hasImage && files) { const f = files.find(f => isImageFile(f.mimetype))!; const url = f.url_private_download || f.url_private; if (url) imagePath = await downloadSlackFile(url, f.mimetype ?? "image/png", label); }
    if (hasVoice && files) { const f = files.find(f => isAudioFile(f.mimetype))!; const url = f.url_private_download || f.url_private; if (url) { voicePath = await downloadSlackFile(url, f.mimetype ?? "audio/ogg", label); if (voicePath) try { voiceTranscript = await transcribeAudioToText(voicePath, { debug: slackDebug, log: debugLog }); } catch {} } }

    let skillContext: string | null = null;
    if (command && !["/reset","/compact","/status"].includes(command)) try { skillContext = await resolveSkillPrompt(command); } catch {}

    const parts = [`[Slack from <@${userId}> in ${channelId}]`];
    if (skillContext) { parts.push(`<command-name>${command}</command-name>`, skillContext); const a = text.slice(command!.length).trim(); if (a) parts.push(`User arguments: ${a}`); }
    else if (text) parts.push(`Message: ${text}`);
    if (imagePath) parts.push(`Image path: ${imagePath}`, "Inspect image before answering.");
    else if (hasImage) parts.push("Image download failed.");
    if (voiceTranscript) parts.push(`Voice transcript: ${voiceTranscript}`, "Use transcript as spoken message.");
    else if (hasVoice) parts.push("Voice could not be transcribed.");

    const qm = getQueueManager(getSettings().maxConcurrent);
    const settings = getSettings();

    if (settings.streaming?.enabled) {
      const handler = new StreamHandler({ updateIntervalMs: settings.streaming.updateIntervalMs, minChunkChars: settings.streaming.minChunkChars,
        onUpdate: async (partial) => { if (typingTs) try { await app!.client.chat.update({ channel: channelId, ts: typingTs, text: markdownToSlackMrkdwn(partial + "\n\n⏳") }); } catch {} },
      });
      onStreamChunk((chunk) => handler.addChunk(chunk));
      onProgress((u) => { sendSlackMessage(channelId, u.message, threadTs).catch(() => {}); });
      const result = await qm.enqueue(userId, () => runUserMessage("slack", parts.join("\n")));
      handler.flush(); clearStreamCallback(); clearProgressCallback();
      if (typingTs) await deleteMessage(channelId, typingTs);
      if (result.exitCode !== 0) await sendSlackMessage(channelId, `Error: ${result.stderr || result.stdout}`, threadTs);
      else { const { cleanedText, reactionEmoji } = extractReactionDirective(result.stdout || ""); if (reactionEmoji) await addReaction(channelId, event.ts, reactionEmoji); await sendSlackMessage(channelId, cleanedText || "(empty)", threadTs); }
    } else {
      onProgress((u) => { sendSlackMessage(channelId, u.message, threadTs).catch(() => {}); });
      const result = await qm.enqueue(userId, () => runUserMessage("slack", parts.join("\n")));
      clearProgressCallback();
      if (typingTs) await deleteMessage(channelId, typingTs);
      if (result.exitCode !== 0) await sendSlackMessage(channelId, `Error: ${result.stderr || result.stdout}`, threadTs);
      else { const { cleanedText, reactionEmoji } = extractReactionDirective(result.stdout || ""); if (reactionEmoji) await addReaction(channelId, event.ts, reactionEmoji); await sendSlackMessage(channelId, cleanedText || "(empty)", threadTs); }
    }
  } catch (err) {
    console.error(`[Slack] Error: ${err instanceof Error ? err.message : err}`);
    if (typingTs) await deleteMessage(channelId, typingTs);
    await sendSlackMessage(channelId, `Error: ${err instanceof Error ? err.message : err}`, threadTs);
  }
}

export { sendSlackMessage as sendMessage };

export function stopSlack(): void { if (app) { app.stop().catch(() => {}); app = null; appRunning = false; } }

export function startPolling(debug = false): void {
  slackDebug = debug;
  const config = getSettings().slack;
  if (!config.botToken || !config.appToken) { console.error("[Slack] Missing botToken or appToken."); return; }
  app = new App({ token: config.botToken, appToken: config.appToken, signingSecret: config.signingSecret || undefined, socketMode: true });
  app.message(async ({ message }) => {
    const msg = message as GenericMessageEvent;
    if (msg.subtype === "bot_message" || (msg as any).bot_id) return;
    await handleMessage(msg, msg.channel_type === "im");
  });
  (async () => {
    try { await ensureProjectClaudeMd(); await app!.start(); appRunning = true;
      console.log("Slack listener started (Socket Mode)");
      console.log(`  Allowed users: ${config.allowedUsers?.length === 0 ? "all" : config.allowedUsers?.join(", ")}`);
      console.log(`  Listen channels: ${config.listenChannels?.length === 0 ? "all" : config.listenChannels?.join(", ")}`);
    } catch (err) { console.error(`[Slack] Failed to start: ${err instanceof Error ? err.message : err}`); }
  })();
}

export async function slack() { await loadSettings(); await ensureProjectClaudeMd(); startPolling(); }
