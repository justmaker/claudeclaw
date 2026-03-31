/**
 * subagent.ts — Subagent 系統
 *
 * 讓主 agent 可以 spawn 獨立的 Claude CLI 子 agent，真正並行處理任務。
 * 每個 subagent 有獨立 session、獨立 context，完成後透過 result 檔案回報。
 */

import { join } from "path";
import { mkdir, unlink, readFile, writeFile } from "fs/promises";
import { existsSync, watch, type FSWatcher } from "fs";
import { randomUUID } from "crypto";
import { registerChildProcess, unregisterChildProcess } from "./process-manager";
import { getSettings } from "./config";
import { EventEmitter } from "events";

export interface SubagentOptions {
  task: string;
  model?: string;
  label?: string;
  threadId?: string;
  onComplete?: (result: SubagentResult) => void;
  onProgress?: (chunk: string) => void;
  timeoutMs?: number;
}

export interface SubagentResult {
  id: string;
  label: string;
  status: "completed" | "failed" | "timeout" | "killed";
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  completedAt: string;
}

export interface SubagentInfo {
  id: string;
  label: string;
  status: "running" | "completed" | "failed" | "timeout" | "killed";
  pid: number | null;
  startedAt: string;
  runtimeMs: number;
  threadId?: string;
}

interface TrackedSubagent {
  id: string;
  label: string;
  pid: number | null;
  proc: ReturnType<typeof Bun.spawn> | null;
  status: "running" | "completed" | "failed" | "timeout" | "killed";
  startedAt: number;
  threadId?: string;
  onComplete?: (result: SubagentResult) => void;
  onProgress?: (chunk: string) => void;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

const SUBAGENTS_DIR = join(
  process.env.HOME || process.env.USERPROFILE || ".",
  ".claude", "claudeclaw", "subagents",
);

const agents = new Map<string, TrackedSubagent>();
let resultWatcher: FSWatcher | null = null;
export const subagentEvents = new EventEmitter();

async function ensureSubagentsDir(): Promise<void> {
  if (!existsSync(SUBAGENTS_DIR)) {
    await mkdir(SUBAGENTS_DIR, { recursive: true });
  }
}

function getSubagentSettings() {
  const settings = getSettings() as any;
  const cfg = settings?.subagents ?? {};
  return {
    maxConcurrent: cfg.maxConcurrent ?? 5,
    defaultModel: cfg.defaultModel ?? "sonnet",
    timeoutMs: cfg.timeoutMs ?? 600_000,
  };
}

/**
 * Spawn 一個獨立的 subagent
 */
export async function spawnSubagent(options: SubagentOptions): Promise<SubagentInfo> {
  await ensureSubagentsDir();
  const config = getSubagentSettings();
  const runningCount = [...agents.values()].filter((a) => a.status === "running").length;

  if (runningCount >= config.maxConcurrent) {
    throw new Error(
      `已達到最大並行 subagent 數量 (${config.maxConcurrent})。請等待現有 subagent 完成或使用 killSubagent() 終止。`,
    );
  }

  const id = randomUUID().slice(0, 8);
  const label = options.label || `subagent-${id}`;
  const model = options.model || config.defaultModel;
  const timeoutMs = options.timeoutMs || config.timeoutMs;

  const proc = Bun.spawn(
    ["claude", "-p", options.task, "--output-format", "text", "--model", model,
     "--allowedTools", "Edit,Read,Write,Bash,computer,mcp__*"],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env } },
  );

  registerChildProcess(proc.pid, `subagent-${label}`);

  const agent: TrackedSubagent = {
    id, label, pid: proc.pid, proc, status: "running",
    startedAt: Date.now(), threadId: options.threadId,
    onComplete: options.onComplete, onProgress: options.onProgress,
  };

  agent.timeoutTimer = setTimeout(() => {
    if (agent.status === "running") {
      agent.status = "timeout";
      try { process.kill(proc.pid, "SIGKILL"); } catch { /* dead */ }
    }
  }, timeoutMs);

  agents.set(id, agent);
  processSubagent(agent, proc).catch((err) =>
    console.error(`[subagent:${label}] 處理錯誤:`, err));

  return {
    id, label, status: "running", pid: proc.pid,
    startedAt: new Date(agent.startedAt).toISOString(),
    runtimeMs: 0, threadId: options.threadId,
  };
}

/**
 * 非同步處理 subagent 的輸出並寫入 result 檔案
 */
async function processSubagent(
  agent: TrackedSubagent,
  proc: ReturnType<typeof Bun.spawn>,
): Promise<void> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const readStream = async (
    stream: ReadableStream<Uint8Array>,
    chunks: string[],
    isStdout: boolean,
  ) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        chunks.push(text);
        if (isStdout && agent.onProgress) agent.onProgress(text);
      }
    } catch { /* stream closed */ }
  };

  await Promise.all([
    readStream(proc.stdout, stdoutChunks, true),
    readStream(proc.stderr, stderrChunks, false),
  ]);

  const exitCode = await proc.exited;
  if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
  unregisterChildProcess(proc.pid!);

  if (agent.status === "running") {
    agent.status = exitCode === 0 ? "completed" : "failed";
  }

  const result: SubagentResult = {
    id: agent.id, label: agent.label,
    status: agent.status as SubagentResult["status"],
    stdout: stdoutChunks.join(""), stderr: stderrChunks.join(""),
    exitCode, durationMs: Date.now() - agent.startedAt,
    completedAt: new Date().toISOString(),
  };

  // 寫入 result 檔案（IPC 機制）
  try {
    await ensureSubagentsDir();
    await writeFile(
      join(SUBAGENTS_DIR, `${agent.id}.result.json`),
      JSON.stringify(result, null, 2),
    );
  } catch (err) {
    console.error(`[subagent:${agent.label}] 無法寫入 result:`, err);
  }

  if (agent.onComplete) {
    try { agent.onComplete(result); }
    catch (err) { console.error(`[subagent:${agent.label}] onComplete 錯誤:`, err); }
  }

  subagentEvents.emit("complete", result);
}

/**
 * 列出所有 subagent
 */
export function listSubagents(): SubagentInfo[] {
  const now = Date.now();
  return [...agents.values()].map((a) => ({
    id: a.id, label: a.label, status: a.status, pid: a.pid,
    startedAt: new Date(a.startedAt).toISOString(),
    runtimeMs: now - a.startedAt, threadId: a.threadId,
  }));
}

/**
 * 終止指定 subagent
 */
export function killSubagent(id: string): boolean {
  const agent = agents.get(id);
  if (!agent || agent.status !== "running") return false;
  agent.status = "killed";
  if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
  if (agent.pid) {
    try { process.kill(agent.pid, "SIGKILL"); } catch { /* dead */ }
    unregisterChildProcess(agent.pid);
  }
  return true;
}

/**
 * 對執行中的 subagent 注入新指令（寫入 steer 檔案）
 */
export async function steerSubagent(id: string, message: string): Promise<boolean> {
  const agent = agents.get(id);
  if (!agent || agent.status !== "running") return false;
  try {
    await writeFile(
      join(SUBAGENTS_DIR, `${id}.steer.json`),
      JSON.stringify({ message, timestamp: new Date().toISOString() }),
    );
    return true;
  } catch { return false; }
}

/**
 * 啟動 result 檔案的 file watcher（IPC 機制）
 */
export async function startResultWatcher(
  onResult: (result: SubagentResult) => void,
): Promise<void> {
  await ensureSubagentsDir();
  if (resultWatcher) return;
  resultWatcher = watch(SUBAGENTS_DIR, async (_eventType, filename) => {
    if (!filename?.endsWith(".result.json")) return;
    try {
      const content = await readFile(join(SUBAGENTS_DIR, filename), "utf-8");
      onResult(JSON.parse(content) as SubagentResult);
    } catch { /* not fully written yet */ }
  });
}

export function stopResultWatcher(): void {
  if (resultWatcher) { resultWatcher.close(); resultWatcher = null; }
}

/**
 * 清除已完成的 subagent 記錄和 result 檔案
 */
export async function cleanupSubagents(): Promise<number> {
  let cleaned = 0;
  for (const [id, agent] of agents) {
    if (agent.status !== "running") {
      agents.delete(id);
      try {
        const r = join(SUBAGENTS_DIR, `${id}.result.json`);
        const s = join(SUBAGENTS_DIR, `${id}.steer.json`);
        if (existsSync(r)) await unlink(r);
        if (existsSync(s)) await unlink(s);
        cleaned++;
      } catch { /* ignore */ }
    }
  }
  return cleaned;
}

/**
 * 解析 [spawn:label]prompt[/spawn] 語法
 */
export function parseSpawnSyntax(
  text: string,
): Array<{ label: string; prompt: string }> {
  const results: Array<{ label: string; prompt: string }> = [];
  const regex = /\[spawn:([^\]]+)\]([\s\S]*?)\[\/spawn\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({ label: match[1].trim(), prompt: match[2].trim() });
  }
  return results;
}

/**
 * 關閉所有 running subagent（graceful shutdown 用）
 */
export async function shutdownAllSubagents(): Promise<void> {
  for (const [id] of agents) killSubagent(id);
  stopResultWatcher();
}
