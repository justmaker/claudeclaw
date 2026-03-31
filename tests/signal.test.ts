import { describe, expect, it } from "bun:test";

// --- Signal message parsing tests ---

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

function isImageAttachment(att: SignalAttachment): boolean {
  return att.contentType.startsWith("image/");
}

function isVoiceAttachment(att: SignalAttachment): boolean {
  return att.contentType.startsWith("audio/") || att.contentType === "application/ogg";
}

function extractCommand(text: string): string | null {
  const firstToken = text.trim().split(/\s+/, 1)[0];
  if (!firstToken.startsWith("/")) return null;
  return firstToken.toLowerCase();
}

function extractReactionDirective(text: string): { cleanedText: string; reactionEmoji: string | null } {
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

interface SignalConfig {
  enabled: boolean;
  phone: string;
  apiUrl: string;
  allowedNumbers: string[];
}

function validateSignalConfig(raw: Partial<SignalConfig>): SignalConfig {
  return {
    enabled: raw.enabled ?? false,
    phone: typeof raw.phone === "string" ? raw.phone.trim() : "",
    apiUrl: typeof raw.apiUrl === "string" ? raw.apiUrl.trim() : "http://localhost:8080",
    allowedNumbers: Array.isArray(raw.allowedNumbers) ? raw.allowedNumbers.map(String) : [],
  };
}

function isAllowedNumber(sender: string, allowedNumbers: string[]): boolean {
  if (allowedNumbers.length === 0) return true;
  return allowedNumbers.includes(sender);
}

// --- Tests ---

describe("Signal message parsing", () => {
  it("should parse text-only envelope", () => {
    const envelope: SignalEnvelope = {
      source: "+886912345678",
      timestamp: Date.now(),
      dataMessage: { timestamp: Date.now(), message: "Hello, Claude!" },
    };
    expect(envelope.dataMessage?.message).toBe("Hello, Claude!");
    expect(envelope.source).toBe("+886912345678");
  });

  it("should detect image attachments", () => {
    const attachments: SignalAttachment[] = [
      { contentType: "image/jpeg", id: "abc123", filename: "photo.jpg" },
    ];
    expect(attachments.some(isImageAttachment)).toBe(true);
    expect(attachments.some(isVoiceAttachment)).toBe(false);
  });

  it("should detect voice attachments", () => {
    const attachments: SignalAttachment[] = [{ contentType: "audio/ogg", id: "def456" }];
    expect(attachments.some(isVoiceAttachment)).toBe(true);
    expect(attachments.some(isImageAttachment)).toBe(false);
  });

  it("should detect application/ogg as voice", () => {
    expect(isVoiceAttachment({ contentType: "application/ogg", id: "x" })).toBe(true);
  });

  it("should ignore reaction envelopes", () => {
    const envelope: SignalEnvelope = {
      source: "+886912345678",
      timestamp: Date.now(),
      dataMessage: {
        timestamp: Date.now(),
        reaction: { emoji: "👍", targetAuthor: "+886900000000", targetSentTimestamp: Date.now() - 1000 },
      },
    };
    expect(envelope.dataMessage?.reaction).toBeTruthy();
    expect(envelope.dataMessage?.message).toBeUndefined();
  });

  it("should skip envelope without dataMessage", () => {
    const envelope: SignalEnvelope = {
      source: "+886912345678",
      timestamp: Date.now(),
      typingMessage: { action: "STARTED" },
    };
    expect(envelope.dataMessage).toBeUndefined();
  });

  it("should extract commands", () => {
    expect(extractCommand("/reset")).toBe("/reset");
    expect(extractCommand("/Status extra")).toBe("/status");
    expect(extractCommand("hello")).toBeNull();
    expect(extractCommand("")).toBeNull();
  });

  it("should extract reaction directives", () => {
    const result = extractReactionDirective("Great job! [react:👍]");
    expect(result.reactionEmoji).toBe("👍");
    expect(result.cleanedText).toBe("Great job!");
  });
});

describe("Signal config validation", () => {
  it("should use defaults for empty config", () => {
    const config = validateSignalConfig({});
    expect(config.enabled).toBe(false);
    expect(config.phone).toBe("");
    expect(config.apiUrl).toBe("http://localhost:8080");
    expect(config.allowedNumbers).toEqual([]);
  });

  it("should parse full config", () => {
    const config = validateSignalConfig({
      enabled: true,
      phone: "+886912345678",
      apiUrl: "http://localhost:9090",
      allowedNumbers: ["+886900000001", "+886900000002"],
    });
    expect(config.enabled).toBe(true);
    expect(config.phone).toBe("+886912345678");
    expect(config.allowedNumbers).toHaveLength(2);
  });

  it("should trim phone and apiUrl", () => {
    const config = validateSignalConfig({ phone: "  +886912345678  ", apiUrl: " http://localhost:8080 " });
    expect(config.phone).toBe("+886912345678");
    expect(config.apiUrl).toBe("http://localhost:8080");
  });
});

describe("Signal allowedNumbers filtering", () => {
  it("should allow all when empty", () => {
    expect(isAllowedNumber("+886999999999", [])).toBe(true);
  });

  it("should allow listed number", () => {
    expect(isAllowedNumber("+886912345678", ["+886912345678"])).toBe(true);
  });

  it("should block unlisted number", () => {
    expect(isAllowedNumber("+886999999999", ["+886912345678"])).toBe(false);
  });

  it("should handle multiple allowed numbers", () => {
    const allowed = ["+886900000001", "+886900000002", "+886900000003"];
    expect(isAllowedNumber("+886900000002", allowed)).toBe(true);
    expect(isAllowedNumber("+886900000004", allowed)).toBe(false);
  });
});
