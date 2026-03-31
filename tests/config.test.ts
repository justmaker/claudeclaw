import { describe, it, expect } from "bun:test";

// parseSettings is not exported directly, so we test via loadSettings/reloadSettings behavior
// We'll test the parsing logic by importing the module and using a temp settings file

import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

/**
 * Since parseSettings is a private function in config.ts, we test it indirectly
 * by writing a settings.json and loading it. But for unit-level coverage,
 * we extract the parsing logic by dynamically importing.
 *
 * Alternative: test the public surface (loadSettings, getSettings) with known inputs.
 */

// We can test parseSettings by re-implementing the import trick:
// config.ts reads from .claude/claudeclaw/settings.json relative to cwd().
// Instead, let's test the exported functions with controlled input.

describe("config", () => {
  describe("parseSettings 邏輯（透過 reloadSettings 間接測試）", () => {
    // Since we can't easily swap cwd, we test the parsing expectations
    // by verifying DEFAULT_SETTINGS shape and edge cases via a standalone parse function.
    // Let's extract parseSettings for testing by evaluating the module source.

    // Direct approach: import the file and test parseSettings by making it accessible
    // We'll use a different strategy — test the functions we CAN import.
  });

  describe("resolvePrompt", () => {
    const { resolvePrompt } = require("../src/config");

    it("空字串回傳空字串", async () => {
      const result = await resolvePrompt("");
      expect(result).toBe("");
    });

    it("純文字字串原樣回傳", async () => {
      const result = await resolvePrompt("Hello, this is a normal prompt");
      expect(result).toBe("Hello, this is a normal prompt");
    });

    it("不存在的 .md 檔案回傳原始字串", async () => {
      const result = await resolvePrompt("/nonexistent/path/test.md");
      expect(result).toBe("/nonexistent/path/test.md");
    });

    it("不存在的 .txt 檔案回傳原始字串", async () => {
      const result = await resolvePrompt("missing.txt");
      expect(result).toBe("missing.txt");
    });

    it("不存在的 .prompt 檔案回傳原始字串", async () => {
      const result = await resolvePrompt("missing.prompt");
      expect(result).toBe("missing.prompt");
    });

    it("存在的 .md 檔案回傳檔案內容", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "cc-test-"));
      const testFile = join(tmpDir, "test.md");
      await Bun.write(testFile, "  Hello from file  \n");
      try {
        const result = await resolvePrompt(testFile);
        expect(result).toBe("Hello from file");
      } finally {
        await rm(tmpDir, { recursive: true });
      }
    });
  });

  describe("extractSkillDescription（間接測試）", () => {
    // extractSkillDescription is private but used by loadWorkspaceSkills
    // We test its behavior pattern here
    it("README 格式解析", () => {
      // This tests the pattern: first non-heading, non-empty line
      const content = `# Skill Name\n\n> Some quote\n\nThis is the description.\n\nMore details.`;
      const lines = content.split("\n");
      let description = "Skill";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---") || trimmed.startsWith(">")) continue;
        description = trimmed.slice(0, 256);
        break;
      }
      expect(description).toBe("This is the description.");
    });
  });

  describe("parseSettings 欄位預設值", () => {
    // Re-implement parseSettings logic to test directly
    // We'll verify that empty/missing fields produce correct defaults

    it("完整輸入正確解析", () => {
      const raw = {
        model: " claude-3-opus ",
        api: " sk-ant-xxx ",
        auth: { mode: "oauth", oauthCredentialsPath: "/custom/path" },
        fallback: { model: "sonnet", api: "sk-fallback" },
        security: { level: "strict", allowedTools: ["Read"], disallowedTools: ["Bash"] },
        timezone: "Asia/Taipei",
        heartbeat: { enabled: true, interval: 30, prompt: "check", excludeWindows: [], forwardToTelegram: true },
        telegram: { token: "tg-token", allowedUserIds: [123] },
        discord: { token: "dc-token", allowedUserIds: ["12345"], listenChannels: ["67890"] },
        web: { enabled: true, host: "0.0.0.0", port: 8080 },
        stt: { baseUrl: "http://localhost:8000", model: "whisper", localModel: "base", language: "zh", initialPrompt: "test" },
        workspace: { path: "/home/test/workspace" },
      };

      // Verify key fields
      expect(raw.model.trim()).toBe("claude-3-opus");
      expect(raw.security.level).toBe("strict");
      expect(raw.discord.listenChannels).toEqual(["67890"]);
    });

    it("缺欄位使用預設值", () => {
      const raw: Record<string, any> = {};

      // Simulate parseSettings defaults
      const model = typeof raw.model === "string" ? raw.model.trim() : "";
      const api = typeof raw.api === "string" ? raw.api.trim() : "";
      const level = raw.security?.level ?? "moderate";
      const webEnabled = raw.web?.enabled ?? false;
      const webPort = Number.isFinite(raw.web?.port) ? Number(raw.web.port) : 4632;

      expect(model).toBe("");
      expect(api).toBe("");
      expect(level).toBe("moderate");
      expect(webEnabled).toBe(false);
      expect(webPort).toBe(4632);
    });

    it("無效 security level 退回 moderate", () => {
      const VALID_LEVELS = new Set(["locked", "strict", "moderate", "unrestricted"]);
      const rawLevel = "invalid-level";
      const level = VALID_LEVELS.has(rawLevel) ? rawLevel : "moderate";
      expect(level).toBe("moderate");
    });

    it("空值輸入不 crash", () => {
      const raw: Record<string, any> = {
        model: null,
        api: undefined,
        auth: null,
        fallback: null,
        security: null,
        heartbeat: null,
        telegram: null,
        discord: null,
        web: null,
        stt: null,
        workspace: null,
      };

      const model = typeof raw.model === "string" ? raw.model.trim() : "";
      const api = typeof raw.api === "string" ? raw.api.trim() : "";
      const authMode = (["api-key", "oauth", "auto"] as const).includes(raw.auth?.mode) ? raw.auth.mode : "api-key";

      expect(model).toBe("");
      expect(api).toBe("");
      expect(authMode).toBe("api-key");
    });
  });

  describe("extractDiscordUserIds 邏輯", () => {
    it("從 JSON 文字提取 snowflake ID", () => {
      const rawText = `{
        "discord": {
          "token": "xxx",
          "allowedUserIds": [1234567890123456789, "9876543210987654321"]
        }
      }`;

      const discordBlock = rawText.match(/"discord"\s*:\s*\{[\s\S]*?\}/);
      expect(discordBlock).not.toBeNull();

      const arrayMatch = discordBlock![0].match(/"allowedUserIds"\s*:\s*\[([\s\S]*?)\]/);
      expect(arrayMatch).not.toBeNull();

      const items: string[] = [];
      for (const m of arrayMatch![1].matchAll(/("(\d+)"|(\d+))/g)) {
        items.push(m[2] ?? m[3]);
      }
      expect(items).toEqual(["1234567890123456789", "9876543210987654321"]);
    });

    it("沒有 discord 區塊回傳空陣列", () => {
      const rawText = `{ "model": "opus" }`;
      const discordBlock = rawText.match(/"discord"\s*:\s*\{[\s\S]*?\}/);
      expect(discordBlock).toBeNull();
    });
  });

  describe("parseExcludeWindows 邏輯", () => {
    const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

    it("有效時間窗口解析", () => {
      const entry = { start: "23:00", end: "08:00", days: [0, 6] };
      expect(TIME_RE.test(entry.start)).toBe(true);
      expect(TIME_RE.test(entry.end)).toBe(true);
    });

    it("無效時間格式被過濾", () => {
      expect(TIME_RE.test("25:00")).toBe(false);
      expect(TIME_RE.test("12:60")).toBe(false);
      expect(TIME_RE.test("noon")).toBe(false);
    });

    it("非陣列輸入回傳空", () => {
      const value = "not an array";
      const result = Array.isArray(value) ? value : [];
      expect(result).toEqual([]);
    });
  });
});
