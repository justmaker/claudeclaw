/**
 * Token Pool — 多帳號 token 輪轉與自動切換
 *
 * 支援三種策略：
 * - fallback-chain: 按 priority 順序，rate limit 時換下一個
 * - round-robin: 每次請求輪流使用
 * - least-used: 追蹤使用次數，挑最少的
 */

export interface TokenPoolEntry {
  name: string;
  model: string;
  api: string;
  priority: number;
}

export type TokenStrategy = "fallback-chain" | "round-robin" | "least-used";

export interface TokenPoolConfig {
  pool: TokenPoolEntry[];
  strategy: TokenStrategy;
}

// 使用次數追蹤（least-used 策略用）
const usageCounts = new Map<string, number>();

// round-robin 索引
let roundRobinIndex = 0;

/** 重設內部狀態（測試用） */
export function resetTokenPoolState(): void {
  usageCounts.clear();
  roundRobinIndex = 0;
}

/** 記錄某個 token entry 被使用了一次 */
export function recordUsage(entry: TokenPoolEntry): void {
  const key = entry.name || entry.api;
  usageCounts.set(key, (usageCounts.get(key) ?? 0) + 1);
}

/** 取得使用次數 */
export function getUsageCount(entry: TokenPoolEntry): number {
  const key = entry.name || entry.api;
  return usageCounts.get(key) ?? 0;
}

/**
 * 根據策略選出下一個要用的 token entry。
 * @param config pool 設定
 * @param excludeNames 已經 rate limited 要排除的 entry names
 * @returns 選中的 entry，或 null（全部用完）
 */
export function selectToken(
  config: TokenPoolConfig,
  excludeNames: Set<string> = new Set()
): TokenPoolEntry | null {
  const available = config.pool.filter((e) => !excludeNames.has(e.name || e.api));
  if (available.length === 0) return null;

  switch (config.strategy) {
    case "fallback-chain":
      return selectFallbackChain(available);
    case "round-robin":
      return selectRoundRobin(available);
    case "least-used":
      return selectLeastUsed(available);
    default:
      return selectFallbackChain(available);
  }
}

function selectFallbackChain(entries: TokenPoolEntry[]): TokenPoolEntry {
  const sorted = [...entries].sort((a, b) => a.priority - b.priority);
  return sorted[0];
}

function selectRoundRobin(entries: TokenPoolEntry[]): TokenPoolEntry {
  const idx = roundRobinIndex % entries.length;
  roundRobinIndex++;
  return entries[idx];
}

function selectLeastUsed(entries: TokenPoolEntry[]): TokenPoolEntry {
  let min = Infinity;
  let pick = entries[0];
  for (const entry of entries) {
    const count = getUsageCount(entry);
    if (count < min) {
      min = count;
      pick = entry;
    }
  }
  return pick;
}

const RATE_LIMIT_PATTERN = /you.ve hit your limit|out of extra usage/i;

/** 檢查 stderr/stdout 是否包含 rate limit 訊息 */
export function isRateLimited(stdout: string, stderr: string): boolean {
  return RATE_LIMIT_PATTERN.test(stdout) || RATE_LIMIT_PATTERN.test(stderr);
}

/** 解析 settings 中的 tokenPool 和 tokenStrategy */
export function parseTokenPoolConfig(raw: any): TokenPoolConfig | null {
  if (!raw || !Array.isArray(raw.tokenPool) || raw.tokenPool.length === 0) {
    return null;
  }

  const pool: TokenPoolEntry[] = [];
  for (const entry of raw.tokenPool) {
    if (!entry || typeof entry !== "object") continue;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const model = typeof entry.model === "string" ? entry.model.trim() : "";
    const api = typeof entry.api === "string" ? entry.api.trim() : "";
    const priority = typeof entry.priority === "number" ? entry.priority : 99;
    if (!api) continue; // api 是必填
    pool.push({ name, model, api, priority });
  }

  if (pool.length === 0) return null;

  const validStrategies: TokenStrategy[] = ["fallback-chain", "round-robin", "least-used"];
  const strategy: TokenStrategy = validStrategies.includes(raw.tokenStrategy)
    ? raw.tokenStrategy
    : "fallback-chain";

  return { pool, strategy };
}
