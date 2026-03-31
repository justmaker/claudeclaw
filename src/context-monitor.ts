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
 * Claude Code stores session data at ~/.claude/projects/-/{sessionId}.jsonl
 */
function getSessionJsonlPath(sessionId: string): string {
  return join(homedir(), ".claude", "projects", "-", `${sessionId}.jsonl`);
}

/**
 * Read the last assistant message with usage data from a session JSONL.
 * Reads the file in reverse to find the most recent usage entry efficiently.
 */
export async function getContextUsage(sessionId: string): Promise<ContextUsage | null> {
  const jsonlPath = getSessionJsonlPath(sessionId);
  if (!existsSync(jsonlPath)) return null;

  try {
    const content = await readFile(jsonlPath, "utf8");
    const lines = content.trim().split("\n");

    // Scan from the end to find the last line with real usage data
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        const usage = entry?.message?.usage;
        if (!usage) continue;

        const inputTokens = usage.input_tokens ?? 0;
        const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
        const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
        const outputTokens = usage.output_tokens ?? 0;

        // Skip synthetic/empty entries
        const totalTokens = inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens;
        if (totalTokens === 0) continue;

        const usagePercent = totalTokens / MAX_CONTEXT_TOKENS;

        return {
          inputTokens,
          cacheCreationTokens,
          cacheReadTokens,
          outputTokens,
          totalTokens,
          usagePercent,
        };
      } catch {
        // Skip unparseable lines
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Determine whether auto-compact should run for a session.
 */
export async function shouldAutoCompact(
  sessionId: string,
  threshold: number = DEFAULT_THRESHOLD
): Promise<boolean> {
  const usage = await getContextUsage(sessionId);
  if (!usage) return false;
  return usage.usagePercent >= threshold;
}

export { MAX_CONTEXT_TOKENS, DEFAULT_THRESHOLD };
