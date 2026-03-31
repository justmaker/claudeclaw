/**
 * process-manager.ts — 追蹤並優雅關閉所有子程式
 *
 * 用於 Claude CLI subprocess、MCP servers、plugin workers 等。
 * SIGTERM → 等待 graceful timeout → SIGKILL
 */

interface TrackedProcess {
  pid: number;
  name: string;
  registeredAt: number;
}

const tracked = new Map<number, TrackedProcess>();

/** 註冊子程式供 shutdown 時追蹤 */
export function registerChildProcess(pid: number, name: string): void {
  tracked.set(pid, { pid, name, registeredAt: Date.now() });
}

/** 取消註冊（子程式已自行結束時呼叫） */
export function unregisterChildProcess(pid: number): void {
  tracked.delete(pid);
}

/** 取得目前追蹤中的子程式列表 */
export function getTrackedProcesses(): TrackedProcess[] {
  return [...tracked.values()];
}

/** 檢查 PID 是否還活著 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 優雅關閉所有追蹤中的子程式
 * 1. 先送 SIGTERM
 * 2. 等待 timeoutMs（預設 5000）
 * 3. 仍存活的送 SIGKILL
 */
export async function shutdownAll(timeoutMs = 5000): Promise<{ terminated: string[]; killed: string[] }> {
  const terminated: string[] = [];
  const killed: string[] = [];
  const entries = [...tracked.entries()];

  if (entries.length === 0) return { terminated, killed };

  // Phase 1: SIGTERM all
  for (const [pid, info] of entries) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already dead
      terminated.push(info.name);
      tracked.delete(pid);
    }
  }

  // Phase 2: wait for graceful exit
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let allDead = true;
    for (const [pid, info] of [...tracked.entries()]) {
      if (!isAlive(pid)) {
        terminated.push(info.name);
        tracked.delete(pid);
      } else {
        allDead = false;
      }
    }
    if (allDead) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Phase 3: SIGKILL survivors
  for (const [pid, info] of [...tracked.entries()]) {
    if (isAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // ignore
      }
      killed.push(info.name);
    } else {
      terminated.push(info.name);
    }
    tracked.delete(pid);
  }

  return { terminated, killed };
}
