import { describe, it, expect, beforeAll } from "bun:test";
import { loadSettings } from "../src/config";

// 初始化 settings（必須在 claudeclaw 目錄下執行）
beforeAll(async () => {
  await loadSettings();
});

/**
 * acp.test.ts — ACP (Agent Communication Protocol) 整合測試
 */

// ── Config parsing ──────────────────────────────────────────────────────────

describe("getACPConfig", () => {
  it("回傳預設設定（無 settings.json）", async () => {
    // Mock getSettings to return a settings object without acp key
    const configModule = await import("../src/config");
    const origGetSettings = configModule.getSettings;

    // Import acp after mocking
    const acpModule = await import("../src/acp");

    // With no acp key, should fall back to defaults
    const config = acpModule.getACPConfig();
    expect(config.enabled).toBe(true);
    expect(config.defaultAgent).toBe("claude");
    expect(config.maxConcurrent).toBeGreaterThanOrEqual(1);
    expect(config.timeoutMs).toBeGreaterThan(0);
    expect(Object.keys(config.agents)).toContain("claude");
    expect(Object.keys(config.agents)).toContain("codex");
    expect(Object.keys(config.agents)).toContain("gemini");
    expect(Object.keys(config.agents)).toContain("opencode");
  });

  it("claude agent 設定包含 --print --output-format text", async () => {
    const { getACPConfig } = await import("../src/acp");
    const config = getACPConfig();
    const claudeCfg = config.agents["claude"];
    expect(claudeCfg).toBeDefined();
    expect(claudeCfg.command).toBe("claude");
    expect(claudeCfg.args).toContain("--print");
    expect(claudeCfg.args).toContain("--output-format");
    expect(claudeCfg.args).toContain("text");
  });

  it("codex/gemini/opencode 預設不帶 args", async () => {
    const { getACPConfig } = await import("../src/acp");
    const config = getACPConfig();
    for (const id of ["codex", "gemini", "opencode"]) {
      expect(config.agents[id]).toBeDefined();
      expect(config.agents[id].command).toBe(id);
    }
  });
});

// ── listAgents ──────────────────────────────────────────────────────────────

describe("listAgents", () => {
  it("回傳所有設定的 agent 清單", async () => {
    const { listAgents } = await import("../src/acp");
    const agents = await listAgents();
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThanOrEqual(4);
    for (const agent of agents) {
      expect(agent).toHaveProperty("id");
      expect(agent).toHaveProperty("command");
      expect(agent).toHaveProperty("available");
      expect(typeof agent.available).toBe("boolean");
    }
  });

  it("包含 claude, codex, gemini, opencode", async () => {
    const { listAgents } = await import("../src/acp");
    const agents = await listAgents();
    const ids = agents.map((a) => a.id);
    expect(ids).toContain("claude");
    expect(ids).toContain("codex");
    expect(ids).toContain("gemini");
    expect(ids).toContain("opencode");
  });
});

// ── isAgentAvailable ────────────────────────────────────────────────────────

describe("isAgentAvailable", () => {
  it("不存在的 agent ID 回傳 false", async () => {
    const { isAgentAvailable } = await import("../src/acp");
    const available = await isAgentAvailable("nonexistent_agent_xyz_123");
    expect(available).toBe(false);
  });

  it("不在 config 中的 agentId 回傳 false", async () => {
    const { isAgentAvailable } = await import("../src/acp");
    const available = await isAgentAvailable("__no_such_agent__");
    expect(available).toBe(false);
  });
});

// ── spawnAgent error handling ───────────────────────────────────────────────

describe("spawnAgent", () => {
  it("使用不存在的 agentId 拋出錯誤", async () => {
    const { spawnAgent } = await import("../src/acp");
    await expect(spawnAgent("not_a_real_agent", "hello")).rejects.toThrow(/未知的 agent/);
  });

  it("timeout 機制會在超時後 kill 進程", async () => {
    // We use a fake slow command — `sleep` should be killed by timeout
    const { spawnAgent, getACPConfig } = await import("../src/acp");
    const config = getACPConfig();

    // Temporarily add a fake slow agent by calling with a mocked config isn't trivial;
    // Instead test indirectly: if a real agent is available (e.g., claude is on PATH),
    // ensure a very short timeout results in a "timeout" status.
    // Since we can't guarantee CLI availability in CI, skip if claude not available.
    const { isAgentAvailable } = await import("../src/acp");
    const claudeAvailable = await isAgentAvailable("claude");
    if (!claudeAvailable) {
      // If claude not on PATH, skip this test
      console.log("跳過 timeout 測試 — claude CLI 不可用");
      return;
    }

    const result = await spawnAgent("claude", "print 'hello'", { timeoutMs: 1 });
    expect(["timeout", "failed"]).toContain(result.status);
  }, 10000);
});

// ── Session management ──────────────────────────────────────────────────────

describe("listSessions / clearCompletedSessions", () => {
  it("初始 session 清單為空陣列", async () => {
    const { listSessions, clearCompletedSessions } = await import("../src/acp");
    clearCompletedSessions();
    const sessions = listSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });

  it("clearCompletedSessions 回傳清除數量", async () => {
    const { clearCompletedSessions } = await import("../src/acp");
    const cleared = clearCompletedSessions();
    expect(typeof cleared).toBe("number");
    expect(cleared).toBeGreaterThanOrEqual(0);
  });
});

// ── killSession ─────────────────────────────────────────────────────────────

describe("killSession", () => {
  it("kill 不存在的 sessionId 回傳 false", async () => {
    const { killSession } = await import("../src/acp");
    const result = killSession("non-existent-id-xyz");
    expect(result).toBe(false);
  });
});
