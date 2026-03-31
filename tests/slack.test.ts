import { describe, expect, it } from "bun:test";

function isImageFile(m: string | undefined): boolean { return (m ?? "").startsWith("image/"); }
function isAudioFile(m: string | undefined): boolean { const s = m ?? ""; return s.startsWith("audio/") || s === "application/ogg"; }
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
function isAllowedUser(u: string, list: string[]): boolean { return list.length === 0 || list.includes(u); }
function isListenChannel(c: string, list: string[]): boolean { return list.length === 0 || list.includes(c); }

describe("Slack helpers", () => {
  it("isImageFile detects images", () => { expect(isImageFile("image/png")).toBe(true); expect(isImageFile("audio/ogg")).toBe(false); expect(isImageFile(undefined)).toBe(false); });
  it("isAudioFile detects audio", () => { expect(isAudioFile("audio/ogg")).toBe(true); expect(isAudioFile("application/ogg")).toBe(true); expect(isAudioFile("image/png")).toBe(false); expect(isAudioFile(undefined)).toBe(false); });
  it("extractCommand parses slash commands", () => { expect(extractCommand("/reset")).toBe("/reset"); expect(extractCommand("/STATUS args")).toBe("/status"); expect(extractCommand("hello")).toBeNull(); expect(extractCommand("")).toBeNull(); });
  it("extractReactionDirective extracts reaction", () => { const r = extractReactionDirective("Hello [react:👍] world"); expect(r.reactionEmoji).toBe("👍"); expect(r.cleanedText).toBe("Hello  world"); });
  it("extractReactionDirective returns null when no directive", () => { const r = extractReactionDirective("Hello world"); expect(r.reactionEmoji).toBeNull(); expect(r.cleanedText).toBe("Hello world"); });
  it("extractReactionDirective takes first reaction only", () => { expect(extractReactionDirective("[react:👍] then [react:❤️]").reactionEmoji).toBe("👍"); });
  it("markdownToSlackMrkdwn converts bold", () => { expect(markdownToSlackMrkdwn("**bold**")).toBe("*bold*"); expect(markdownToSlackMrkdwn("__bold__")).toBe("*bold*"); });
  it("markdownToSlackMrkdwn converts links", () => { expect(markdownToSlackMrkdwn("[text](https://example.com)")).toBe("<https://example.com|text>"); });
  it("markdownToSlackMrkdwn converts strikethrough", () => { expect(markdownToSlackMrkdwn("~~strike~~")).toBe("~strike~"); });
  it("markdownToSlackMrkdwn handles empty", () => { expect(markdownToSlackMrkdwn("")).toBe(""); });
  it("isAllowedUser allows all when empty", () => { expect(isAllowedUser("U123", [])).toBe(true); });
  it("isAllowedUser filters", () => { expect(isAllowedUser("U123", ["U123"])).toBe(true); expect(isAllowedUser("U789", ["U123"])).toBe(false); });
  it("isListenChannel allows all when empty", () => { expect(isListenChannel("C123", [])).toBe(true); });
  it("isListenChannel filters", () => { expect(isListenChannel("C123", ["C123"])).toBe(true); expect(isListenChannel("C999", ["C123"])).toBe(false); });
});
