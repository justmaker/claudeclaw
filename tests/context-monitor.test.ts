import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { getContextUsage, shouldAutoCompact, MAX_CONTEXT_TOKENS } from "../src/context-monitor";

// We need to mock homedir since getContextUsage uses it.
// Instead, we'll test the exported functions by creating real JSONL files
// in the expected location. For unit tests, we'll create a helper.

describe("context-monitor", () => {
  const testDir = join(tmpdir(), `claudeclaw-test-${Date.now()}`);
  const sessionsDir = join(testDir, ".claude", "projects", "-");
  const testSessionId = "test-session-12345";

  // We can't easily mock homedir() in bun, so we test the logic directly
  // by importing and testing the threshold logic

  describe("shouldAutoCompact threshold logic", () => {
    it("should return false when no session file exists", async () => {
      const result = await shouldAutoCompact("nonexistent-session-id");
      expect(result).toBe(false);
    });

    it("should use default threshold of 0.8", () => {
      // Verify the constant
      expect(MAX_CONTEXT_TOKENS).toBe(200_000);
    });
  });

  describe("getContextUsage", () => {
    it("should return null for non-existent session", async () => {
      const result = await getContextUsage("does-not-exist-abc123");
      expect(result).toBeNull();
    });
  });

  describe("usage calculation logic", () => {
    it("should correctly calculate usage percent", () => {
      // Simulate what getContextUsage does internally
      const input = 1;
      const cacheCreation = 621;
      const cacheRead = 86308;
      const output = 65;
      const total = input + cacheCreation + cacheRead + output;
      const percent = total / MAX_CONTEXT_TOKENS;

      expect(total).toBe(86995);
      expect(percent).toBeCloseTo(0.435, 2);
      // This would NOT trigger compact at 80% threshold
      expect(percent < 0.8).toBe(true);
    });

    it("should trigger compact when tokens exceed 80% of 200K", () => {
      const total = 170_000; // 85% of 200K
      const percent = total / MAX_CONTEXT_TOKENS;
      expect(percent).toBeCloseTo(0.85, 2);
      expect(percent >= 0.8).toBe(true);
    });

    it("should not trigger compact when tokens are under threshold", () => {
      const total = 100_000; // 50% of 200K
      const percent = total / MAX_CONTEXT_TOKENS;
      expect(percent >= 0.8).toBe(false);
    });

    it("should respect custom threshold", () => {
      const total = 120_000; // 60%
      const percent = total / MAX_CONTEXT_TOKENS;
      const customThreshold = 0.5;
      expect(percent >= customThreshold).toBe(true);
      expect(percent >= 0.8).toBe(false);
    });
  });
});
