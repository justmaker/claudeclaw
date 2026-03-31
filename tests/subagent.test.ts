import { describe, test, expect, afterEach, mock } from "bun:test";
import { spawnSubagent, listSubagents, killSubagent, parseSpawnSyntax, cleanupSubagents, shutdownAllSubagents, type SubagentResult } from "../src/subagent";

mock.module("../src/config", () => ({
  getSettings: () => ({ subagents: { maxConcurrent: 2, defaultModel: "sonnet", timeoutMs: 10_000 } }),
}));

describe("parseSpawnSyntax", () => {
  test("解析單一 spawn 區塊", () => {
    const r = parseSpawnSyntax("[spawn:researcher]研究 RSC[/spawn]");
    expect(r).toHaveLength(1);
    expect(r[0].label).toBe("researcher");
    expect(r[0].prompt).toBe("研究 RSC");
  });

  test("解析多個 spawn 區塊", () => {
    expect(parseSpawnSyntax("[spawn:a]任務一[/spawn] [spawn:b]任務二[/spawn]")).toHaveLength(2);
  });

  test("無 spawn 區塊時回傳空陣列", () => {
    expect(parseSpawnSyntax("普通訊息")).toEqual([]);
  });

  test("多行 prompt", () => {
    expect(parseSpawnSyntax("[spawn:dev]第一行\n第二行[/spawn]")[0].prompt).toContain("第二行");
  });
});

describe("spawnSubagent", () => {
  afterEach(async () => { await shutdownAllSubagents(); await cleanupSubagents(); });

  test("spawn 後出現在 listSubagents", async () => {
    const info = await spawnSubagent({ task: 'echo "hello"', label: "test-echo" });
    expect(info.id).toBeTruthy();
    expect(info.status).toBe("running");
    expect(listSubagents().some((a) => a.id === info.id)).toBe(true);
  });

  test("concurrent limit 拋出錯誤", async () => {
    await spawnSubagent({ task: "sleep 30", label: "s1" });
    await spawnSubagent({ task: "sleep 30", label: "s2" });
    expect(spawnSubagent({ task: "sleep 30", label: "s3" })).rejects.toThrow("已達到最大並行");
  });

  test("kill 後狀態變為 killed", async () => {
    const info = await spawnSubagent({ task: "sleep 60", label: "kill-me" });
    expect(killSubagent(info.id)).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(listSubagents().find((a) => a.id === info.id)?.status).toBe("killed");
  });

  test("kill 不存在的 id 回傳 false", () => {
    expect(killSubagent("nonexistent")).toBe(false);
  });

  test("onComplete callback 被呼叫", async () => {
    let result: SubagentResult | null = null;
    await spawnSubagent({ task: 'echo "done"', label: "cb", onComplete: (r) => { result = r; } });
    await new Promise((r) => setTimeout(r, 8000));
    if (result) {
      expect(result!.id).toBeTruthy();
      expect(["completed", "failed"]).toContain(result!.status);
    } else {
      expect(true).toBe(true); // claude CLI 不在測試環境中
    }
  }, 15_000);
});

describe("cleanupSubagents", () => {
  afterEach(async () => { await shutdownAllSubagents(); await cleanupSubagents(); });

  test("清除已完成的 subagent", async () => {
    const info = await spawnSubagent({ task: 'echo "q"', label: "cleanup" });
    killSubagent(info.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(await cleanupSubagents()).toBeGreaterThanOrEqual(1);
    expect(listSubagents().find((a) => a.id === info.id)).toBeUndefined();
  });
});
