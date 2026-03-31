import { ensureProjectClaudeMd, runUserMessage, compactCurrentSession, onProgress, clearProgressCallback } from "../runner";
import { getSettings, loadSettings } from "../config";
import { getQueueManager } from "../queue-manager";
import { resetSession, peekSession } from "../sessions";
import { transcribeAudioToText } from "../whisper";
import { resolveSkillPrompt } from "../skills";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

let makeWASocket: any, useMultiFileAuthState: any, DisconnectReason: any, downloadMediaMessage: any;

async function loadBaileys() {
  const b = await import("@whiskeysockets/baileys");
  makeWASocket = b.default || b.makeWASocket || (b as any).default?.default;
  useMultiFileAuthState = b.useMultiFileAuthState;
  DisconnectReason = b.DisconnectReason;
  downloadMediaMessage = b.downloadMediaMessage;
}

let waDebug = false;
function debugLog(msg: string): void { if (waDebug) console.log(`[WhatsApp][debug] ${msg}`); }

let sock: any = null;
let running = false;

function resolveSessionPath(): string {
  return (getSettings().whatsapp.sessionPath || "~/.claude/claudeclaw/whatsapp-session").replace(/^~/, homedir());
}

function isAllowedNumber(jid: string): boolean {
  const c = getSettings().whatsapp;
  if (!c.allowedNumbers?.length) return true;
  const n = jid.split("@")[0];
  return c.allowedNumbers.some(a => { const cl = a.replace(/[^0-9]/g, ""); return n === cl || n.endsWith(cl); });
}

function isImageMessage(m: any): boolean { return !!m.message?.imageMessage; }
function isAudioMessage(m: any): boolean { return !!m.message?.audioMessage; }
function isDocumentMessage(m: any): boolean { return !!m.message?.documentMessage; }

function getTextContent(m: any): string {
  return (m.message?.conversation || m.message?.extendedTextMessage?.text || m.message?.imageMessage?.caption || m.message?.documentMessage?.caption || "").trim();
}

function extensionFromMimeType(t: string): string {
  const m: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/ogg; codecs=opus": ".ogg", "audio/ogg": ".ogg", "audio/wav": ".wav", "application/ogg": ".ogg" };
  return m[t] ?? ".bin";
}

async function downloadMedia(msg: any, label: string, type: string): Promise<string | null> {
  try {
    const buffer = await downloadMediaMessage(msg, "buffer", {});
    const dir = join(process.cwd(), ".claude", "claudeclaw", "inbox", "whatsapp");
    await mkdir(dir, { recursive: true });
    const mm = msg.message?.imageMessage || msg.message?.audioMessage || msg.message?.documentMessage;
    const ext = extensionFromMimeType(mm?.mimetype ?? "application/octet-stream");
    const p = join(dir, `${label}-${type}-${Date.now()}${ext}`);
    await writeFile(p, buffer);
    return p;
  } catch (err) { console.error(`[WhatsApp] Download failed: ${err instanceof Error ? err.message : err}`); return null; }
}

function extractCommand(t: string): string | null { const f = t.trim().split(/\s+/, 1)[0]; return f.startsWith("/") ? f.toLowerCase() : null; }

function extractReactionDirective(text: string): { cleanedText: string; reactionEmoji: string | null } {
  let reactionEmoji: string | null = null;
  const cleanedText = text.replace(/\[react:([^\]\r\n]+)\]/gi, (_m, raw) => { const c = String(raw).trim(); if (!reactionEmoji && c) reactionEmoji = c; return ""; }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { cleanedText, reactionEmoji };
}

async function sendMessage(jid: string, text: string): Promise<void> {
  if (!sock) return;
  const MAX = 4096;
  for (let i = 0; i < text.length; i += MAX) await sock.sendMessage(jid, { text: text.slice(i, i + MAX) });
}

async function sendReaction(jid: string, key: any, emoji: string): Promise<void> {
  if (!sock) return;
  try { await sock.sendMessage(jid, { react: { text: emoji, key } }); } catch {}
}

async function handleMessage(msg: any): Promise<void> {
  if (msg.key.remoteJid === "status@broadcast" || msg.key.fromMe) return;
  const jid = msg.key.remoteJid!;
  if (!isAllowedNumber(jid)) return;

  const text = getTextContent(msg);
  const hasImage = isImageMessage(msg), hasAudio = isAudioMessage(msg), hasDoc = isDocumentMessage(msg);
  if (!text && !hasImage && !hasAudio && !hasDoc) return;

  const command = text ? extractCommand(text) : null;
  const label = jid.split("@")[0].slice(-4);

  if (command === "/start") { await sendMessage(jid, "Hello! Send a message.\n/reset for fresh session."); return; }
  if (command === "/reset") { await resetSession(); await sendMessage(jid, "Session reset。"); return; }
  if (command === "/compact") { await sendMessage(jid, "⏳ 壓縮中..."); const r = await compactCurrentSession(); await sendMessage(jid, r.message); return; }
  if (command === "/status") {
    const s = await peekSession(); const st = getSettings();
    if (!s) { await sendMessage(jid, "📊 無 session。"); return; }
    await sendMessage(jid, `📊 Session: ${s.sessionId.slice(0,8)} | Turns: ${s.turnCount??0} | Model: ${st.model||"default"}`); return;
  }

  console.log(`[${new Date().toLocaleTimeString()}] WhatsApp ${label}: "${text.slice(0,60)}"`);
  try { await sock.sendPresenceUpdate("composing", jid); } catch {}

  try {
    let imagePath: string | null = null, voicePath: string | null = null, voiceTranscript: string | null = null, docPath: string | null = null;
    if (hasImage) imagePath = await downloadMedia(msg, label, "image");
    if (hasAudio) { voicePath = await downloadMedia(msg, label, "voice"); if (voicePath) try { voiceTranscript = await transcribeAudioToText(voicePath, { debug: waDebug, log: debugLog }); } catch {} }
    if (hasDoc) docPath = await downloadMedia(msg, label, "doc");

    let skillContext: string | null = null;
    if (command && !["/start","/reset","/compact","/status"].includes(command)) try { skillContext = await resolveSkillPrompt(command); } catch {}

    const parts = [`[WhatsApp from ${jid}]`];
    if (skillContext) { parts.push(`<command-name>${command}</command-name>`, skillContext); const a = text.slice(command!.length).trim(); if (a) parts.push(`User arguments: ${a}`); }
    else if (text) parts.push(`Message: ${text}`);
    if (imagePath) parts.push(`Image path: ${imagePath}`, "Inspect image before answering.");
    else if (hasImage) parts.push("Image download failed.");
    if (voiceTranscript) parts.push(`Voice transcript: ${voiceTranscript}`, "Use transcript as spoken message.");
    else if (hasAudio) parts.push("Voice could not be transcribed.");
    if (docPath) parts.push(`Document path: ${docPath}`, "Read document if relevant.");
    else if (hasDoc) parts.push("Document download failed.");

    const qm = getQueueManager(getSettings().maxConcurrent);
    onProgress((u) => { sendMessage(jid, u.message).catch(() => {}); });
    const result = await qm.enqueue(jid, () => runUserMessage("whatsapp", parts.join("\n")));
    clearProgressCallback();
    try { await sock.sendPresenceUpdate("paused", jid); } catch {}

    if (result.exitCode !== 0) await sendMessage(jid, `Error: ${result.stderr || result.stdout}`);
    else { const { cleanedText, reactionEmoji } = extractReactionDirective(result.stdout || ""); if (reactionEmoji) await sendReaction(jid, msg.key, reactionEmoji); await sendMessage(jid, cleanedText || "(empty)"); }
  } catch (err) {
    console.error(`[WhatsApp] Error: ${err instanceof Error ? err.message : err}`);
    try { await sock.sendPresenceUpdate("paused", jid); } catch {}
    await sendMessage(jid, `Error: ${err instanceof Error ? err.message : err}`);
  }
}

async function connectWhatsApp(): Promise<void> {
  await loadBaileys();
  const sessionPath = resolveSessionPath();
  await mkdir(sessionPath, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  sock = makeWASocket({ auth: state, printQRInTerminal: true, browser: ["ClaudeClaw", "Desktop", "1.0.0"] });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (update: any) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) console.log("[WhatsApp] 請掃描 QR Code 連結手機");
    if (connection === "close") {
      const code = (lastDisconnect?.error as any)?.output?.statusCode;
      if (code !== DisconnectReason?.loggedOut) { console.log("[WhatsApp] 重連中..."); setTimeout(connectWhatsApp, 3000); }
      else { console.log("[WhatsApp] 已登出。"); running = false; }
    } else if (connection === "open") { console.log("[WhatsApp] 已連線！"); running = true; }
  });
  sock.ev.on("messages.upsert", async (m: any) => {
    if (m.type !== "notify") return;
    for (const msg of m.messages) handleMessage(msg).catch(e => console.error(`[WhatsApp] Unhandled: ${e}`));
  });
}

export { sendMessage };
export function stopWhatsApp(): void { running = false; if (sock) { sock.end(undefined); sock = null; } }
export function startPolling(debug = false): void {
  waDebug = debug;
  (async () => { await ensureProjectClaudeMd(); await connectWhatsApp(); })().catch(e => console.error(`[WhatsApp] Fatal: ${e}`));
}
export async function whatsapp() { await loadSettings(); await ensureProjectClaudeMd(); waDebug = true; await connectWhatsApp(); await new Promise(() => {}); }
