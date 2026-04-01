/**
 * acp.ts — Agent Communication Protocol 整合
 *
 * 讓 ClaudeClaw 能 spawn 和管理外部 coding agent（Claude Code、Codex、Gemini、OpenCode 等）。
 * 每個 agent 透過 CLI 啟動，統一管理生命週期、timeout、並行上限。
 */

import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { registerChildProcess, unregisterChildProcess } from "./process-manager";
import { getSettings } from "./config";

// ── Types ──────────────────────────────────────────────

export interface ACPAgentConfig {
  command: string;
  args: string[];
  /** 是否需要 PTY（如 codex、opencode） */
  needsPty?: boolean;
}

export interface ACPConfig {
  enabled: boolean;
  agents: Record<string, ACPAgentConfig>;
  defaultAgent: string;
  maxConcurrent: number;
  timeoutMs: number;
}

export interface ACPResult {
  agentId: string;
  sessionId: string;
  status: "completed" | "failed" | "timeout" | "killed";
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface ACPSessionInfo {
  sessionId: string;
  agentId: string;
  status: "running" | "completed" | "failed" | "timeout" | "killed";
  pid: number | null;
  startedAt: string;
  runtimeMs: number;
  task: string;
}

export interface SpawnAgentOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  onProgress?: (chunk: string) => void;
  onComplete?: (result: ACPResult) => void;
}

interface TrackedSession {
  sessionId: string;
  agentId: string;
  task: string;
  status: "running" | "completed" | "failed" | "timeout" | "killed";
  pid: number | null;
  proc: ReturnType<typeof Bun.spawn> | null;
  startedAt: number;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  onProgress?: (chunk: string) => void;
  onComplete?: (result: ACPResult) => void;
}

// ── Default config ─────────────────────────────────────

const DEFAULT_ACP_CONFIG: ACPConfig = {
  enabled: true,
  agents: {
    claude: { command: "claude", args: ["--print", "--output-format", "text"] },
    codex: { command: "codex", args: [], needsPty: true },
    gemini: { command: "gemini", args: [], needsPty: true },
    opencode: { command: "opencode", args: [], needsPty: true },
  },
  defaultAgent: "claude",
  maxConcurrent: 3,
  timeoutMs: 600000,
};

// ── State ──────────────────────────────────────────────

const sessions = new Map<string, TrackedSession>();
export const acpEvents = new EventEmitter();

// ── Config helpers ─────────────────────────────────────

export function getACPConfig(): ACPConfig {
  const settings = getSettings();
  const raw = (settings as any).acp;
  if (!raw) return DEFAULT_ACP_CONFIG;

  return {
    enabled: raw.enabled ?? DEFAULT_ACP_CONFIG.enabled,
    agents: { ...DEFAULT_ACP_CONFIG.agents, ...raw.agents },
    defaultAgent: raw.defaultAgent ?? DEFAULT_ACP_CONFIG.defaultAgent,
    maxConcurrent: raw.maxConcurrent ?? DEFAULT_ACP_CONFIG.maxConcurrent,
    timeoutMs: raw.timeoutMs ?? DEFAULT_ACP_CONFIG.timeoutMs,
  };
}

// ── Agent discovery ────────────────────────────────────

/**
 * 檢查指定 agent CLI 是否存在於 PATH 中
 */
export async function isAgentAvailable(agentId: string): Promise<boolean> {
  const config = getACPConfig();
  const agentCfg = config.agents[agentId];
  if (!agentCfg) return false;

  try {
    const proc = Bun.spawn(["which", agentCfg.command], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * 列出所有已設定的 agent（含可用性資訊）
 */
export async function listAgents(): Promise<
  Array<{ id: string; command: string; available: boolean }>
> {
  const config = getACPConfig();
  const results = await Promise.all(
    Object.entries(config.agents).map(async ([id, cfg]) => ({
      id,
      command: cfg.command,
      available: await isAgentAvailable(id),
    })),
  );
  return results;
}

// ── Core: spawn agent ──────────────────────────────────

/**
 * 用指定的 agent 執行任務
 */
export async function spawnAgent(
  agentId: string,
  task: string,
  options: SpawnAgentOptions = {},
): Promise<ACPResult> {
  const config = getACPConfig();

  if (!config.enabled) {
    throw new Error("ACP 未啟用。請在 settings.json 中設定 acp.enabled = true");
  }

  const agentCfg = config.agents[agentId];
  if (!agentCfg) {
    throw new Error(
      `未知的 agent: ${agentId}。可用的 agent: ${Object.keys(config.agents).join(", ")}`,
    );
  }

  const runningCount = [...sessions.values()].filter((s) => s.status === "running").length;
  if (runningCount >= config.maxConcurrent) {
    throw new Error(
      `已達到最大並行 agent 數量 (${config.maxConcurrent})。請等待現有 session 完成。`,
    );
  }

  const sessionId = randomUUID().slice(0, 8);
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;

  // 組裝命令列
  const cmdArgs = buildCommandArgs(agentId, agentCfg, task);

  const proc = Bun.spawn(cmdArgs, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
  });

  registerChildProcess(proc.pid, `acp-${agentId}-${sessionId}`);

  const session: TrackedSession = {
    sessionId,
    agentId,
    task,
    status: "running",
    pid: proc.pid,
    proc,
    startedAt: Date.now(),
    onProgress: options.onProgress,
    onComplete: options.onComplete,
  };

  // Timeout 處理
  session.timeoutTimer = setTimeout(() => {
    if (session.status === "running") {
      session.status = "timeout";
      try {
        process.kill(proc.pid, "SIGKILL");
      } catch {
        /* already dead */
      }
    }
  }, timeoutMs);

  sessions.set(sessionId, session);

  // 等待完成
  return processSession(session, proc);
}

/**
 * 根據 agent 類型組裝 CLI 命令
 */
function buildCommandArgs(
  agentId: string,
  agentCfg: ACPAgentConfig,
  task: string,
): string[] {
  switch (agentId) {
    case "claude":
      // claude --print --output-format text -p "task"
      return [agentCfg.command, ...agentCfg.args, "-p", task];
    case "codex":
      // codex --prompt "task"
      return [agentCfg.command, ...agentCfg.args, "--prompt", task];
    case "gemini":
      // gemini --prompt "task"
      return [agentCfg.command, ...agentCfg.args, "--prompt", task];
    case "opencode":
      // opencode --prompt "task"
      return [agentCfg.command, ...agentCfg.args, "--prompt", task];
    default:
      // 通用：將 task 作為最後一個參數
      return [agentCfg.command, ...agentCfg.args, task];
  }
}

/**
 * 非同步讀取 agent 輸出，等待結束
 */
async function processSession(
  session: TrackedSession,
  proc: ReturnType<typeof Bun.spawn>,
): Promise<ACPResult> {
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
        if (isStdout && session.onProgress) session.onProgress(text);
      }
    } catch {
      /* stream closed */
    }
  };

  await Promise.all([
    proc.stdout ? readStream(proc.stdout as ReadableStream<Uint8Array>, stdoutChunks, true) : Promise.resolve(),
    proc.stderr ? readStream(proc.stderr as ReadableStream<Uint8Array>, stderrChunks, false) : Promise.resolve(),
  ]);

  const exitCode = await proc.exited;
  if (session.timeoutTimer) clearTimeout(session.timeoutTimer);

  const durationMs = Date.now() - session.startedAt;

  if (session.status === "running") {
    session.status = exitCode === 0 ? "completed" : "failed";
  }
  session.pid = null;
  session.proc = null;

  try {
    unregisterChildProcess(proc.pid);
  } catch {
    /* ok */
  }

  const result: ACPResult = {
    agentId: session.agentId,
    sessionId: session.sessionId,
    status: session.status as ACPResult["status"],
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    exitCode,
    durationMs,
  };

  if (session.onComplete) {
    try {
      session.onComplete(result);
    } catch (err) {
      console.error(`[acp:${session.agentId}] onComplete 錯誤:`, err);
    }
  }

  acpEvents.emit("complete", result);
  return result;
}

// ── Session management ─────────────────────────────────

/**
 * 列出所有 ACP session
 */
export function listSessions(): ACPSessionInfo[] {
  return [...sessions.values()].map((s) => ({
    sessionId: s.sessionId,
    agentId: s.agentId,
    status: s.status,
    pid: s.pid,
    startedAt: new Date(s.startedAt).toISOString(),
    runtimeMs: s.status === "running" ? Date.now() - s.startedAt : 0,
    task: s.task,
  }));
}

/**
 * 終止指定 session
 */
export function killSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.status !== "running") return false;

  session.status = "killed";
  if (session.timeoutTimer) clearTimeout(session.timeoutTimer);

  if (session.pid) {
    try {
      process.kill(session.pid, "SIGKILL");
    } catch {
      /* already dead */
    }
  }
  return true;
}

/**
 * 清除已完成的 session 記錄
 */
export function clearCompletedSessions(): number {
  let cleared = 0;
  for (const [id, session] of sessions) {
    if (session.status !== "running") {
      sessions.delete(id);
      cleared++;
    }
  }
  return cleared;
}
