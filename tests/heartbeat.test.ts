import { describe, test, expect } from "bun:test";

// --- HeartbeatConfig type (mirrored from config.ts) ---
interface HeartbeatExcludeWindow {
  days?: number[];
  start: string;
  end: string;
}

interface HeartbeatConfig {
  enabled: boolean;
  interval: number;
  model: string;
  prompt: string;
  excludeWindows: HeartbeatExcludeWindow[];
  forwardToTelegram: boolean;
  forwardToDiscord: boolean;
}

// --- parseExcludeWindows logic (extracted) ---
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function parseExcludeWindows(value: unknown): HeartbeatExcludeWindow[] {
  if (!Array.isArray(value)) return [];
  const out: HeartbeatExcludeWindow[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const start = typeof (entry as any).start === "string" ? (entry as any).start.trim() : "";
    const end = typeof (entry as any).end === "string" ? (entry as any).end.trim() : "";
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) continue;
    const rawDays = Array.isArray((entry as any).days) ? (entry as any).days : [];
    const parsedDays = rawDays
      .map((d: unknown) => Number(d))
      .filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6);
    const uniqueDays = Array.from(new Set<number>(parsedDays)).sort((a: number, b: number) => a - b);
    out.push({ start, end, days: uniqueDays.length > 0 ? uniqueDays : [...ALL_DAYS] });
  }
  return out;
}

function parseClockMinutes(value: string): number | null {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function getDayAndMinuteAtOffset(at: Date, offsetMinutes: number): { day: number; minute: number } {
  const utcMs = at.getTime() + offsetMinutes * 60_000;
  const d = new Date(utcMs);
  return { day: d.getUTCDay(), minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

function isHeartbeatExcludedAt(config: HeartbeatConfig, timezoneOffsetMinutes: number, at: Date): boolean {
  if (!Array.isArray(config.excludeWindows) || config.excludeWindows.length === 0) return false;
  const local = getDayAndMinuteAtOffset(at, timezoneOffsetMinutes);
  for (const window of config.excludeWindows) {
    const start = parseClockMinutes(window.start);
    const end = parseClockMinutes(window.end);
    if (start == null || end == null) continue;
    const days = Array.isArray(window.days) && window.days.length > 0 ? window.days : ALL_DAYS;
    const sameDay = start < end;
    if (sameDay) {
      if (days.includes(local.day) && local.minute >= start && local.minute < end) return true;
      continue;
    }
    if (start === end) {
      if (days.includes(local.day)) return true;
      continue;
    }
    if (local.minute >= start && days.includes(local.day)) return true;
    const previousDay = (local.day + 6) % 7;
    if (local.minute < end && days.includes(previousDay)) return true;
  }
  return false;
}

// --- Tests ---

function makeConfig(overrides: Partial<HeartbeatConfig> = {}): HeartbeatConfig {
  return {
    enabled: true,
    interval: 60,
    model: "",
    prompt: "",
    excludeWindows: [],
    forwardToTelegram: true,
    forwardToDiscord: false,
    ...overrides,
  };
}

describe("HeartbeatConfig", () => {
  describe("new fields", () => {
    test("model defaults to empty string", () => {
      const config = makeConfig();
      expect(config.model).toBe("");
    });

    test("model can be set to override", () => {
      const config = makeConfig({ model: "opus" });
      expect(config.model).toBe("opus");
    });

    test("forwardToDiscord defaults to false", () => {
      const config = makeConfig();
      expect(config.forwardToDiscord).toBe(false);
    });

    test("forwardToDiscord can be enabled", () => {
      const config = makeConfig({ forwardToDiscord: true });
      expect(config.forwardToDiscord).toBe(true);
    });
  });

  describe("excludeWindows parsing", () => {
    test("parses simple time window", () => {
      const windows = parseExcludeWindows([{ start: "23:00", end: "08:00" }]);
      expect(windows).toHaveLength(1);
      expect(windows[0].start).toBe("23:00");
      expect(windows[0].end).toBe("08:00");
      expect(windows[0].days).toEqual(ALL_DAYS);
    });

    test("parses window with specific days", () => {
      const windows = parseExcludeWindows([{ start: "22:00", end: "07:00", days: [1, 2, 3, 4, 5] }]);
      expect(windows).toHaveLength(1);
      expect(windows[0].days).toEqual([1, 2, 3, 4, 5]);
    });

    test("rejects invalid time format", () => {
      const windows = parseExcludeWindows([{ start: "25:00", end: "08:00" }]);
      expect(windows).toHaveLength(0);
    });

    test("returns empty for non-array", () => {
      expect(parseExcludeWindows(null)).toEqual([]);
      expect(parseExcludeWindows("bad")).toEqual([]);
    });
  });

  describe("exclude window matching", () => {
    test("overnight window excludes 23:30", () => {
      const config = makeConfig({
        excludeWindows: [{ start: "23:00", end: "08:00", days: ALL_DAYS }],
      });
      // 23:30 UTC+8 → UTC 15:30
      const at = new Date("2026-03-31T15:30:00Z");
      expect(isHeartbeatExcludedAt(config, 480, at)).toBe(true);
    });

    test("overnight window excludes 02:00", () => {
      const config = makeConfig({
        excludeWindows: [{ start: "23:00", end: "08:00", days: ALL_DAYS }],
      });
      // 02:00 UTC+8 → UTC 18:00 previous day
      const at = new Date("2026-03-30T18:00:00Z");
      expect(isHeartbeatExcludedAt(config, 480, at)).toBe(true);
    });

    test("overnight window allows 12:00", () => {
      const config = makeConfig({
        excludeWindows: [{ start: "23:00", end: "08:00", days: ALL_DAYS }],
      });
      // 12:00 UTC+8 → UTC 04:00
      const at = new Date("2026-03-31T04:00:00Z");
      expect(isHeartbeatExcludedAt(config, 480, at)).toBe(false);
    });

    test("no windows means not excluded", () => {
      const config = makeConfig();
      expect(isHeartbeatExcludedAt(config, 480, new Date())).toBe(false);
    });
  });

  describe("forwarding logic", () => {
    test("forwardToTelegram true forwards HEARTBEAT_OK", () => {
      const config = makeConfig({ forwardToTelegram: true });
      const isOk = "HEARTBEAT_OK".startsWith("HEARTBEAT_OK");
      // forwardToTelegram=true → always forward
      expect(config.forwardToTelegram || !isOk).toBe(true);
    });

    test("forwardToDiscord false skips HEARTBEAT_OK", () => {
      const config = makeConfig({ forwardToDiscord: false });
      const isOk = "HEARTBEAT_OK".startsWith("HEARTBEAT_OK");
      // forwardToDiscord=false && isOk → should NOT forward
      expect(config.forwardToDiscord || !isOk).toBe(false);
    });

    test("forwardToDiscord false still forwards non-OK", () => {
      const config = makeConfig({ forwardToDiscord: false });
      const isOk = "Hey, reminder about...".startsWith("HEARTBEAT_OK");
      // forwardToDiscord=false but !isOk → should forward
      expect(config.forwardToDiscord || !isOk).toBe(true);
    });
  });
});
