import { describe, expect, it } from "bun:test";

function isAllowedNumber(jid: string, list: string[]): boolean {
  if (list.length === 0) return true;
  const n = jid.split("@")[0];
  return list.some(a => { const c = a.replace(/[^0-9]/g, ""); return n === c || n.endsWith(c); });
}
function getTextContent(m: any): string { return (m.message?.conversation || m.message?.extendedTextMessage?.text || m.message?.imageMessage?.caption || m.message?.documentMessage?.caption || "").trim(); }
function isImageMessage(m: any): boolean { return !!m.message?.imageMessage; }
function isAudioMessage(m: any): boolean { return !!m.message?.audioMessage; }
function isDocumentMessage(m: any): boolean { return !!m.message?.documentMessage; }
function extractCommand(t: string): string | null { const f = t.trim().split(/\s+/, 1)[0]; return f.startsWith("/") ? f.toLowerCase() : null; }
function extractReactionDirective(text: string): { cleanedText: string; reactionEmoji: string | null } {
  let reactionEmoji: string | null = null;
  const cleanedText = text.replace(/\[react:([^\]\r\n]+)\]/gi, (_m, raw) => { const c = String(raw).trim(); if (!reactionEmoji && c) reactionEmoji = c; return ""; }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { cleanedText, reactionEmoji };
}
function extensionFromMimeType(m: string): string {
  const map: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "audio/ogg": ".ogg", "audio/ogg; codecs=opus": ".ogg" };
  return map[m] ?? ".bin";
}

describe("WhatsApp helpers", () => {
  it("isAllowedNumber allows all when empty", () => { expect(isAllowedNumber("886912345678@s.whatsapp.net", [])).toBe(true); });
  it("isAllowedNumber filters", () => { expect(isAllowedNumber("886912345678@s.whatsapp.net", ["+886912345678"])).toBe(true); expect(isAllowedNumber("886999999999@s.whatsapp.net", ["+886912345678"])).toBe(false); });
  it("isAllowedNumber partial match", () => { expect(isAllowedNumber("886912345678@s.whatsapp.net", ["912345678"])).toBe(true); });
  it("getTextContent conversation", () => { expect(getTextContent({ message: { conversation: "hello" } })).toBe("hello"); });
  it("getTextContent extended", () => { expect(getTextContent({ message: { extendedTextMessage: { text: "world" } } })).toBe("world"); });
  it("getTextContent caption", () => { expect(getTextContent({ message: { imageMessage: { caption: "photo" } } })).toBe("photo"); });
  it("getTextContent empty", () => { expect(getTextContent({ message: {} })).toBe(""); expect(getTextContent({})).toBe(""); });
  it("isImageMessage", () => { expect(isImageMessage({ message: { imageMessage: {} } })).toBe(true); expect(isImageMessage({ message: {} })).toBe(false); });
  it("isAudioMessage", () => { expect(isAudioMessage({ message: { audioMessage: {} } })).toBe(true); expect(isAudioMessage({ message: {} })).toBe(false); });
  it("isDocumentMessage", () => { expect(isDocumentMessage({ message: { documentMessage: {} } })).toBe(true); expect(isDocumentMessage({ message: {} })).toBe(false); });
  it("extractCommand", () => { expect(extractCommand("/reset")).toBe("/reset"); expect(extractCommand("hello")).toBeNull(); });
  it("extractReactionDirective", () => { const r = extractReactionDirective("Hi [react:👍]"); expect(r.reactionEmoji).toBe("👍"); });
  it("extractReactionDirective null", () => { expect(extractReactionDirective("Hi").reactionEmoji).toBeNull(); });
  it("extensionFromMimeType", () => { expect(extensionFromMimeType("image/jpeg")).toBe(".jpg"); expect(extensionFromMimeType("audio/ogg; codecs=opus")).toBe(".ogg"); expect(extensionFromMimeType("unknown")).toBe(".bin"); });
});
