import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";

/** Claude Code's max context window (tokens). */
const MAX_CONTEXT_TOKENS = 200_000;

/** Default threshold (fraction) at which auto-compact triggers. */
const DEFAULT_THRESHOLD = 0.8;

export interface ContextUsage {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
  usagePercent: number;
}

/**
 * Resolve the JSONL path for a Claude Code session.
 */
function getSessionJsonlPath(sessionId: string): string {
  return join(homedir(), ".claude", "projects", "-", `${sessionId}.jsonl`);
}

/**
 * Read the last assistant message with usage data from a session JSONL.
 */
export async function getContextUsage(sessionId: string): Promise<ContextUsage | null> {
  const jsonlPath = getSessionJsonlPath(sessionId);
  if (!existsSync(jsonlPath)) return null;

  try {
    const content = await readFile(jsonlPath, "utf-8");
    const lines = content.trim().split("\n").reverse();

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "assistant" && entry.usage) {
          const u = entry.usage;
          const inputTokens = u.input_tokens ?? 0;
          const cacheCreation = u.cache_creation_input_tokens ?? 0;
          const cacheRead = u.cache_read_input_tokens ?? 0;
          const outputTokens = u.output_tokens ?? 0;
          const totalTokens = inputTokens + cacheCreation + cacheRead + outputTokens;
          return {
            inputTokens,
            cacheCreationTokens: cacheCreation,
            cacheReadTokens: cacheRead,
            outputTokens,
            totalTokens,
            usagePercent: (totalTokens / MAX_CONTEXT_TOKENS) * 100,
          };
        }
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Check if context usage exceeds the auto-compact threshold.
 */
export async function shouldAutoCompact(
  sessionId: string,
  threshold = DEFAULT_THRESHOLD
): Promise<boolean> {
  const usage = await getContextUsage(sessionId);
  if (!usage) return false;
  return usage.usagePercent >= threshold * 100;
}

export { MAX_CONTEXT_TOKENS, DEFAULT_THRESHOLD };
