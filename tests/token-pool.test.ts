import { describe, it, expect, beforeEach } from "bun:test";
import {
  selectToken,
  recordUsage,
  resetTokenPoolState,
  isRateLimited,
  parseTokenPoolConfig,
  type TokenPoolConfig,
  type TokenPoolEntry,
} from "../src/token-pool";

const makeEntry = (name: string, priority: number, model = "opus"): TokenPoolEntry => ({
  name,
  model,
  api: `sk-ant-${name}`,
  priority,
});

describe("Token Pool", () => {
  beforeEach(() => {
    resetTokenPoolState();
  });

  describe("fallback-chain 策略", () => {
    const config: TokenPoolConfig = {
      pool: [
        makeEntry("charlie", 3),
        makeEntry("rex", 1),
        makeEntry("alice", 2),
      ],
      strategy: "fallback-chain",
    };

    it("按 priority 順序選擇", () => {
      const pick = selectToken(config);
      expect(pick?.name).toBe("rex"); // priority 1
    });

    it("排除後選下一個", () => {
      const pick = selectToken(config, new Set(["rex"]));
      expect(pick?.name).toBe("alice"); // priority 2
    });

    it("全部排除回傳 null", () => {
      const pick = selectToken(config, new Set(["rex", "alice", "charlie"]));
      expect(pick).toBeNull();
    });
  });

  describe("round-robin 策略", () => {
    const config: TokenPoolConfig = {
      pool: [
        makeEntry("rex", 1),
        makeEntry("alice", 2),
        makeEntry("bob", 3),
      ],
      strategy: "round-robin",
    };

    it("依序輪流", () => {
      expect(selectToken(config)?.name).toBe("rex");
      expect(selectToken(config)?.name).toBe("alice");
      expect(selectToken(config)?.name).toBe("bob");
      expect(selectToken(config)?.name).toBe("rex"); // 繞回
    });

    it("排除後跳過", () => {
      // 先 reset 確保從頭開始
      resetTokenPoolState();
      const filtered: TokenPoolConfig = {
        pool: config.pool.filter((e) => e.name !== "alice"),
        strategy: "round-robin",
      };
      expect(selectToken(filtered)?.name).toBe("rex");
      expect(selectToken(filtered)?.name).toBe("bob");
    });
  });

  describe("least-used 策略", () => {
    const config: TokenPoolConfig = {
      pool: [
        makeEntry("rex", 1),
        makeEntry("alice", 2),
        makeEntry("bob", 3),
      ],
      strategy: "least-used",
    };

    it("選使用次數最少的", () => {
      // 都是 0 次，選第一個
      const first = selectToken(config);
      expect(first?.name).toBe("rex");

      // rex 用了 2 次，alice 1 次
      recordUsage(config.pool[0]); // rex
      recordUsage(config.pool[0]); // rex
      recordUsage(config.pool[1]); // alice

      const pick = selectToken(config);
      expect(pick?.name).toBe("bob"); // 0 次，最少
    });

    it("使用次數一樣時選第一個", () => {
      const pick = selectToken(config);
      expect(pick?.name).toBe("rex");
    });
  });

  describe("rate limit 偵測", () => {
    it("偵測 stderr 中的 rate limit", () => {
      expect(isRateLimited("", "you've hit your limit")).toBe(true);
      expect(isRateLimited("", "You've hit your limit for today")).toBe(true);
      expect(isRateLimited("out of extra usage credits", "")).toBe(true);
    });

    it("正常輸出不觸發", () => {
      expect(isRateLimited("Hello world", "")).toBe(false);
      expect(isRateLimited("", "some warning")).toBe(false);
    });
  });

  describe("rate limit 自動切換（fallback-chain 模擬）", () => {
    it("逐一排除直到找到可用的", () => {
      const config: TokenPoolConfig = {
        pool: [
          makeEntry("rex", 1),
          makeEntry("alice", 2),
          makeEntry("bob", 3),
        ],
        strategy: "fallback-chain",
      };

      const excluded = new Set<string>();

      // 第一個 rate limited
      const first = selectToken(config, excluded);
      expect(first?.name).toBe("rex");
      excluded.add("rex");

      // 第二個也 rate limited
      const second = selectToken(config, excluded);
      expect(second?.name).toBe("alice");
      excluded.add("alice");

      // 第三個成功
      const third = selectToken(config, excluded);
      expect(third?.name).toBe("bob");
    });
  });

  describe("parseTokenPoolConfig", () => {
    it("解析有效設定", () => {
      const raw = {
        tokenPool: [
          { name: "rex", model: "opus", api: "sk-ant-xxx1", priority: 1 },
          { name: "alice", model: "opus", api: "sk-ant-xxx2", priority: 2 },
        ],
        tokenStrategy: "round-robin",
      };
      const config = parseTokenPoolConfig(raw);
      expect(config).not.toBeNull();
      expect(config!.pool).toHaveLength(2);
      expect(config!.strategy).toBe("round-robin");
    });

    it("沒有 tokenPool 回傳 null", () => {
      expect(parseTokenPoolConfig({})).toBeNull();
      expect(parseTokenPoolConfig({ tokenPool: [] })).toBeNull();
    });

    it("無效策略預設 fallback-chain", () => {
      const raw = {
        tokenPool: [{ name: "test", model: "opus", api: "sk-ant-xxx", priority: 1 }],
        tokenStrategy: "invalid-strategy",
      };
      const config = parseTokenPoolConfig(raw);
      expect(config!.strategy).toBe("fallback-chain");
    });

    it("跳過沒有 api 的 entry", () => {
      const raw = {
        tokenPool: [
          { name: "no-api", model: "opus", priority: 1 },
          { name: "has-api", model: "opus", api: "sk-ant-xxx", priority: 2 },
        ],
      };
      const config = parseTokenPoolConfig(raw);
      expect(config!.pool).toHaveLength(1);
      expect(config!.pool[0].name).toBe("has-api");
    });
  });
});
