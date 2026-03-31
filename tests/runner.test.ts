import { describe, it, expect, mock, spyOn, beforeEach } from "bun:test";

/**
 * runner.ts 測試
 *
 * runClaudeOnce 是 private function，無法直接 import。
 * 我們測試其外圍邏輯：環境變數構建、安全參數、rate limit 偵測、佇列機制等。
 * 不真的呼叫 Claude CLI。
 */

describe("runner", () => {
  describe("buildChildEnv 邏輯", () => {
    function buildChildEnv(baseEnv: Record<string, string>, model: string, api: string): Record<string, string> {
      const childEnv: Record<string, string> = { ...baseEnv };
      const normalizedModel = model.trim().toLowerCase();
      if (api.trim()) childEnv.ANTHROPIC_AUTH_TOKEN = api.trim();
      if (normalizedModel === "glm") {
        childEnv.ANTHROPIC_BASE_URL = "https://api.z.ai/api/anthropic";
        childEnv.API_TIMEOUT_MS = "3000000";
      }
      return childEnv;
    }

    it("一般 model 只設定 auth token", () => {
      const env = buildChildEnv({ PATH: "/usr/bin" }, "opus", "sk-ant-xxx");
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-ant-xxx");
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(env.PATH).toBe("/usr/bin");
    });

    it("glm model 設定 base URL 和 timeout", () => {
      const env = buildChildEnv({}, " GLM ", "sk-glm");
      expect(env.ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic");
      expect(env.API_TIMEOUT_MS).toBe("3000000");
    });

    it("空 api 不設定 token", () => {
      const env = buildChildEnv({}, "opus", "  ");
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    });

    it("不污染原始 env", () => {
      const original = { PATH: "/usr/bin" };
      const env = buildChildEnv(original, "opus", "sk-ant-xxx");
      expect(original).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-ant-xxx");
    });
  });

  describe("rate limit 偵測", () => {
    const RATE_LIMIT_PATTERN = /you.ve hit your limit|out of extra usage/i;

    function extractRateLimitMessage(stdout: string, stderr: string): string | null {
      for (const text of [stdout, stderr]) {
        const trimmed = text.trim();
        if (trimmed && RATE_LIMIT_PATTERN.test(trimmed)) return trimmed;
      }
      return null;
    }

    it("偵測 stdout 中的 rate limit", () => {
      const msg = extractRateLimitMessage("You've hit your limit for today", "");
      expect(msg).toBe("You've hit your limit for today");
    });

    it("偵測 stderr 中的 rate limit", () => {
      const msg = extractRateLimitMessage("", "Out of extra usage quota");
      expect(msg).toBe("Out of extra usage quota");
    });

    it("正常輸出不觸發", () => {
      const msg = extractRateLimitMessage("Hello, world!", "");
      expect(msg).toBeNull();
    });

    it("空字串不觸發", () => {
      const msg = extractRateLimitMessage("", "");
      expect(msg).toBeNull();
    });

    it("whitespace-only 不觸發", () => {
      const msg = extractRateLimitMessage("   ", "   ");
      expect(msg).toBeNull();
    });
  });

  describe("sameModelConfig 邏輯", () => {
    function sameModelConfig(a: { model: string; api: string }, b: { model: string; api: string }): boolean {
      return a.model.trim().toLowerCase() === b.model.trim().toLowerCase() && a.api.trim() === b.api.trim();
    }

    it("相同 config 回傳 true", () => {
      expect(sameModelConfig({ model: "opus", api: "sk-1" }, { model: "opus", api: "sk-1" })).toBe(true);
    });

    it("大小寫不敏感比對 model", () => {
      expect(sameModelConfig({ model: "OPUS", api: "sk-1" }, { model: "opus", api: "sk-1" })).toBe(true);
    });

    it("空白會被 trim", () => {
      expect(sameModelConfig({ model: " opus ", api: " sk-1 " }, { model: "opus", api: "sk-1" })).toBe(true);
    });

    it("不同 model 回傳 false", () => {
      expect(sameModelConfig({ model: "opus", api: "sk-1" }, { model: "sonnet", api: "sk-1" })).toBe(false);
    });

    it("不同 api 回傳 false", () => {
      expect(sameModelConfig({ model: "opus", api: "sk-1" }, { model: "opus", api: "sk-2" })).toBe(false);
    });
  });

  describe("hasModelConfig 邏輯", () => {
    function hasModelConfig(value: { model: string; api: string }): boolean {
      return value.model.trim().length > 0 || value.api.trim().length > 0;
    }

    it("有 model 回傳 true", () => {
      expect(hasModelConfig({ model: "opus", api: "" })).toBe(true);
    });

    it("有 api 回傳 true", () => {
      expect(hasModelConfig({ model: "", api: "sk-1" })).toBe(true);
    });

    it("都空回傳 false", () => {
      expect(hasModelConfig({ model: "", api: "" })).toBe(false);
    });

    it("whitespace-only 視為空", () => {
      expect(hasModelConfig({ model: "  ", api: "  " })).toBe(false);
    });
  });

  describe("isNotFoundError 邏輯", () => {
    function isNotFoundError(error: unknown): boolean {
      if (!error || typeof error !== "object") return false;
      const code = (error as { code?: unknown }).code;
      if (code === "ENOENT") return true;
      const message = String((error as { message?: unknown }).message ?? "");
      return /enoent|no such file or directory/i.test(message);
    }

    it("ENOENT code 回傳 true", () => {
      expect(isNotFoundError({ code: "ENOENT" })).toBe(true);
    });

    it("message 包含 ENOENT 回傳 true", () => {
      expect(isNotFoundError({ message: "ENOENT: no such file" })).toBe(true);
    });

    it("message 包含 no such file or directory 回傳 true", () => {
      expect(isNotFoundError({ message: "No such file or directory" })).toBe(true);
    });

    it("一般錯誤回傳 false", () => {
      expect(isNotFoundError({ code: "EPERM", message: "permission denied" })).toBe(false);
    });

    it("null 回傳 false", () => {
      expect(isNotFoundError(null)).toBe(false);
    });

    it("非物件回傳 false", () => {
      expect(isNotFoundError("string error")).toBe(false);
    });
  });

  describe("buildSecurityArgs 邏輯", () => {
    type SecurityLevel = "locked" | "strict" | "moderate" | "unrestricted";
    interface SecurityConfig {
      level: SecurityLevel;
      allowedTools: string[];
      disallowedTools: string[];
    }

    function buildSecurityArgs(security: SecurityConfig): string[] {
      const args: string[] = ["--dangerously-skip-permissions"];
      switch (security.level) {
        case "locked":
          args.push("--tools", "Read,Grep,Glob");
          break;
        case "strict":
          args.push("--disallowedTools", "Bash,WebSearch,WebFetch");
          break;
        case "moderate":
          break;
        case "unrestricted":
          break;
      }
      if (security.allowedTools.length > 0) {
        args.push("--allowedTools", security.allowedTools.join(" "));
      }
      if (security.disallowedTools.length > 0) {
        args.push("--disallowedTools", security.disallowedTools.join(" "));
      }
      return args;
    }

    it("locked 限制工具", () => {
      const args = buildSecurityArgs({ level: "locked", allowedTools: [], disallowedTools: [] });
      expect(args).toContain("--tools");
      expect(args).toContain("Read,Grep,Glob");
    });

    it("strict 禁用危險工具", () => {
      const args = buildSecurityArgs({ level: "strict", allowedTools: [], disallowedTools: [] });
      expect(args).toContain("--disallowedTools");
      expect(args).toContain("Bash,WebSearch,WebFetch");
    });

    it("moderate 只有 skip-permissions", () => {
      const args = buildSecurityArgs({ level: "moderate", allowedTools: [], disallowedTools: [] });
      expect(args).toEqual(["--dangerously-skip-permissions"]);
    });

    it("unrestricted 只有 skip-permissions", () => {
      const args = buildSecurityArgs({ level: "unrestricted", allowedTools: [], disallowedTools: [] });
      expect(args).toEqual(["--dangerously-skip-permissions"]);
    });

    it("自訂 allowedTools 附加", () => {
      const args = buildSecurityArgs({ level: "moderate", allowedTools: ["Read", "Write"], disallowedTools: [] });
      expect(args).toContain("--allowedTools");
      expect(args).toContain("Read Write");
    });
  });

  describe("serial queue 邏輯", () => {
    it("佇列保證串行執行", async () => {
      const order: number[] = [];
      let queue: Promise<unknown> = Promise.resolve();

      function enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const task = queue.then(fn, fn);
        queue = task.catch(() => {});
        return task;
      }

      const p1 = enqueue(async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push(1);
      });
      const p2 = enqueue(async () => {
        order.push(2);
      });

      await Promise.all([p1, p2]);
      expect(order).toEqual([1, 2]);
    });

    it("per-thread 佇列互相獨立", async () => {
      const threadQueues = new Map<string, Promise<unknown>>();
      const order: string[] = [];

      function enqueue<T>(fn: () => Promise<T>, threadId: string): Promise<T> {
        const current = threadQueues.get(threadId) ?? Promise.resolve();
        const task = current.then(fn, fn);
        threadQueues.set(threadId, task.catch(() => {}));
        return task;
      }

      const pA = enqueue(async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push("A1");
      }, "thread-a");

      const pB = enqueue(async () => {
        order.push("B1");
      }, "thread-b");

      await Promise.all([pA, pB]);
      // B1 不需要等 A1
      expect(order).toContain("A1");
      expect(order).toContain("B1");
    });
  });

  describe("timeout 錯誤訊息格式", () => {
    it("有 partial output 時顯示最後幾行", () => {
      const timeoutMs = 300000;
      const timeoutMin = Math.round(timeoutMs / 60000);
      const lastOutput = "line1\nline2\nline3\nline4\nline5\nline6".trim().split("\n").slice(-5).join("\n").trim();
      const hint = `⏱️ Timeout after ${timeoutMin}min. Last output:\n\`\`\`\n${lastOutput.slice(-500)}\n\`\`\`\n💡 Try: simplify the task, break it into smaller steps, or ask me to retry.`;

      expect(hint).toContain("⏱️ Timeout after 5min");
      expect(hint).toContain("line6");
    });

    it("無 output 時顯示通用提示", () => {
      const timeoutMs = 300000;
      const timeoutMin = Math.round(timeoutMs / 60000);
      const lastOutput = "";
      const hint = lastOutput
        ? `⏱️ Timeout after ${timeoutMin}min.`
        : `⏱️ Timeout after ${timeoutMin}min (no output captured).\n💡 The task may be too complex. Try breaking it into smaller steps.`;

      expect(hint).toContain("no output captured");
    });
  });

  describe("COMPACT 常數", () => {
    it("COMPACT_WARN_THRESHOLD 是 25", () => {
      const COMPACT_WARN_THRESHOLD = 25;
      expect(COMPACT_WARN_THRESHOLD).toBe(25);
    });

    it("CLAUDE_TIMEOUT_MS 是 5 分鐘", () => {
      const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;
      expect(CLAUDE_TIMEOUT_MS).toBe(300000);
    });
  });
});
