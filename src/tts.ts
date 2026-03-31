/**
 * TTS (Text-to-Speech) 語音合成模組
 *
 * 支援多個 backend：
 * - edge-tts：免費微軟 Edge TTS（支援中文）
 * - openai：OpenAI TTS API（付費、高品質）
 * - local：本地 TTS（piper 等）
 */

import { tmpdir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";

// ─── Types ───

export type TtsProvider = "edge-tts" | "openai" | "local";
export type TtsFormat = "mp3" | "wav" | "ogg";

export interface TtsConfig {
  enabled: boolean;
  provider: TtsProvider;
  voice: string;
  speed: number;
  triggerPattern: string;
  autoVoice: boolean;
  openaiModel: string;
  openaiApiKey: string;
  localCommand: string;
}

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  enabled: false,
  provider: "edge-tts",
  voice: "zh-TW-HsiaoChenNeural",
  speed: 1.0,
  triggerPattern: "[voice]",
  autoVoice: false,
  openaiModel: "tts-1",
  openaiApiKey: "",
  localCommand: "piper --model zh_TW --output_file {output}",
};

export interface TtsOptions {
  voice?: string;
  speed?: number;
  format?: TtsFormat;
  provider?: TtsProvider;
}

export interface TtsResult {
  buffer: Buffer;
  format: TtsFormat;
  filename: string;
}

// ─── Voice tag 萃取 ───

export function extractVoiceTag(text: string, pattern: string = "[voice]"): { text: string; triggered: boolean } {
  if (!text.includes(pattern)) {
    return { text, triggered: false };
  }
  const cleaned = text.replace(new RegExp(escapeRegExp(pattern), "gi"), "").trim();
  return { text: cleaned, triggered: true };
}

export function parseVoiceCommand(text: string): string | null {
  const match = text.match(/^\/voice\s+(.+)/s);
  return match ? match[1].trim() : null;
}

export function shouldSynthesizeVoice(
  responseText: string,
  config: TtsConfig,
  isVoiceCommand: boolean,
): { shouldSpeak: boolean; textToSpeak: string } {
  if (!config.enabled) return { shouldSpeak: false, textToSpeak: "" };
  if (isVoiceCommand) return { shouldSpeak: true, textToSpeak: responseText };

  const { text, triggered } = extractVoiceTag(responseText, config.triggerPattern);
  if (triggered) return { shouldSpeak: true, textToSpeak: text };
  if (config.autoVoice) return { shouldSpeak: true, textToSpeak: responseText };

  return { shouldSpeak: false, textToSpeak: "" };
}

// ─── 合成 ───

export async function synthesize(text: string, config: TtsConfig, options: TtsOptions = {}): Promise<TtsResult> {
  const provider = options.provider ?? config.provider;
  const voice = options.voice ?? config.voice;
  const speed = options.speed ?? config.speed;
  const format = options.format ?? "mp3";

  switch (provider) {
    case "edge-tts":
      return synthesizeEdgeTts(text, voice, speed, format);
    case "openai":
      return synthesizeOpenAI(text, voice, speed, format, config);
    case "local":
      return synthesizeLocal(text, format, config);
    default:
      throw new Error(`不支援的 TTS provider: ${provider}`);
  }
}

async function synthesizeEdgeTts(
  text: string, voice: string, speed: number, format: TtsFormat,
): Promise<TtsResult> {
  const tmpFile = join(tmpdir(), `tts-${Date.now()}.${format}`);
  const rateStr = speed >= 1 ? `+${Math.round((speed - 1) * 100)}%` : `-${Math.round((1 - speed) * 100)}%`;

  try {
    const proc = Bun.spawn([
      "edge-tts",
      "--voice", voice,
      "--rate", rateStr,
      "--text", text,
      "--write-media", tmpFile,
    ], { stdout: "pipe", stderr: "pipe" });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`edge-tts 失敗 (exit ${exitCode}): ${stderr}`);
    }

    const buffer = Buffer.from(await Bun.file(tmpFile).arrayBuffer());
    return { buffer, format, filename: `voice.${format}` };
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

async function synthesizeOpenAI(
  text: string, voice: string, speed: number, format: TtsFormat, config: TtsConfig,
): Promise<TtsResult> {
  const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI TTS 需要 API key（設定 tts.openaiApiKey 或 OPENAI_API_KEY 環境變數）");

  const openaiVoice = voice.includes("-") ? "nova" : voice;
  const responseFormat = format === "wav" ? "wav" : format === "ogg" ? "opus" : "mp3";

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.openaiModel || "tts-1",
      input: text,
      voice: openaiVoice,
      speed,
      response_format: responseFormat,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI TTS API 失敗 (${res.status}): ${errText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, format, filename: `voice.${format}` };
}

async function synthesizeLocal(text: string, format: TtsFormat, config: TtsConfig): Promise<TtsResult> {
  const tmpFile = join(tmpdir(), `tts-${Date.now()}.${format}`);
  const cmd = (config.localCommand || DEFAULT_TTS_CONFIG.localCommand)
    .replace("{output}", tmpFile)
    .replace("{text}", text);

  try {
    const proc = Bun.spawn(["sh", "-c", `echo ${JSON.stringify(text)} | ${cmd}`], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`本地 TTS 失敗 (exit ${exitCode}): ${stderr}`);
    }

    const buffer = Buffer.from(await Bun.file(tmpFile).arrayBuffer());
    return { buffer, format, filename: `voice.${format}` };
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

// ─── Discord 語音發送 ───

export async function sendDiscordVoice(
  token: string, channelId: string, result: TtsResult, text?: string,
): Promise<void> {
  const form = new FormData();
  const blob = new Blob([result.buffer], { type: mimeForFormat(result.format) });
  form.append("files[0]", blob, result.filename);
  if (text) {
    form.append("payload_json", JSON.stringify({ content: text.slice(0, 2000) }));
  }

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Discord 語音發送失敗 (${res.status}): ${errText}`);
  }
}

// ─── Telegram 語音發送 ───

export async function sendTelegramVoice(
  token: string, chatId: number, result: TtsResult, threadId?: number,
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  const method = result.format === "ogg" ? "sendVoice" : "sendAudio";
  const fieldName = method === "sendVoice" ? "voice" : "audio";
  const blob = new Blob([result.buffer], { type: mimeForFormat(result.format) });
  form.append(fieldName, blob, result.filename);
  if (threadId) form.append("message_thread_id", String(threadId));

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Telegram 語音發送失敗 (${res.status}): ${errText}`);
  }
}

// ─── Config 解析 ───

export function parseTtsConfig(raw: Record<string, unknown> | undefined): TtsConfig {
  if (!raw) return { ...DEFAULT_TTS_CONFIG };
  return {
    enabled: raw.enabled === true,
    provider: isValidProvider(raw.provider) ? raw.provider : DEFAULT_TTS_CONFIG.provider,
    voice: typeof raw.voice === "string" && raw.voice.trim() ? raw.voice.trim() : DEFAULT_TTS_CONFIG.voice,
    speed: typeof raw.speed === "number" && raw.speed > 0 && raw.speed <= 4 ? raw.speed : DEFAULT_TTS_CONFIG.speed,
    triggerPattern: typeof raw.triggerPattern === "string" && raw.triggerPattern.trim()
      ? raw.triggerPattern.trim() : DEFAULT_TTS_CONFIG.triggerPattern,
    autoVoice: raw.autoVoice === true,
    openaiModel: typeof raw.openaiModel === "string" && raw.openaiModel.trim()
      ? raw.openaiModel.trim() : DEFAULT_TTS_CONFIG.openaiModel,
    openaiApiKey: typeof raw.openaiApiKey === "string" ? raw.openaiApiKey.trim() : DEFAULT_TTS_CONFIG.openaiApiKey,
    localCommand: typeof raw.localCommand === "string" && raw.localCommand.trim()
      ? raw.localCommand.trim() : DEFAULT_TTS_CONFIG.localCommand,
  };
}

// ─── Helpers ───

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidProvider(v: unknown): v is TtsProvider {
  return v === "edge-tts" || v === "openai" || v === "local";
}

function mimeForFormat(format: TtsFormat): string {
  switch (format) {
    case "mp3": return "audio/mpeg";
    case "wav": return "audio/wav";
    case "ogg": return "audio/ogg";
  }
}
