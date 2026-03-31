/**
 * Progress Reporter — periodically extracts progress from Claude Code subprocess
 * stdout buffer and reports it via callback.
 *
 * Claude Code streams JSON lines or text to stdout. This module accumulates
 * the raw output, extracts the latest tool call or text snippet every interval,
 * and fires a callback so Discord/Telegram handlers can send status updates.
 */

export interface ProgressUpdate {
  /** Human-readable status, e.g. "⏳ 正在執行 Read..." */
  message: string;
  /** Raw tool name if detected */
  toolName?: string;
  /** Elapsed seconds since start */
  elapsedSec: number;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

export interface ProgressReporterOptions {
  /** Interval in milliseconds between progress checks (default: 60000) */
  intervalMs?: number;
  /** Callback to receive progress updates */
  onProgress: ProgressCallback;
}

/** Known Claude Code tool names for display */
const TOOL_DISPLAY: Record<string, string> = {
  Read: "讀取檔案",
  Write: "寫入檔案",
  Edit: "編輯檔案",
  Bash: "執行指令",
  Grep: "搜尋內容",
  Glob: "搜尋檔案",
  WebSearch: "搜尋網頁",
  WebFetch: "擷取網頁",
  TodoRead: "讀取待辦",
  TodoWrite: "更新待辦",
};

/**
 * Extract the most recent tool call name from accumulated stdout.
 * Claude Code streams JSON lines like: {"type":"tool_use","name":"Read",...}
 * or plain text patterns like: "Using tool: Read" / "Tool: Bash"
 */
export function extractLatestToolCall(buffer: string): string | null {
  // Strategy 1: JSON lines with tool_use type (stream-json format)
  const jsonMatches = buffer.matchAll(/"type"\s*:\s*"tool_use"[^}]*"name"\s*:\s*"(\w+)"/g);
  let lastTool: string | null = null;
  for (const m of jsonMatches) {
    lastTool = m[1];
  }
  if (lastTool) return lastTool;

  // Strategy 2: tool_name field in JSON
  const toolNameMatches = buffer.matchAll(/"tool_name"\s*:\s*"(\w+)"/g);
  for (const m of toolNameMatches) {
    lastTool = m[1];
  }
  if (lastTool) return lastTool;

  // Strategy 3: Plain text patterns (Claude Code verbose output)
  const textMatches = buffer.matchAll(/(?:Using tool|Tool|Calling):\s*(\w+)/gi);
  for (const m of textMatches) {
    lastTool = m[1];
  }

  return lastTool;
}

/**
 * Extract a short text snippet from the latest output for display.
 * Returns the last meaningful non-empty line (up to 60 chars).
 */
export function extractLatestSnippet(buffer: string, maxLen = 60): string | null {
  const lines = buffer.trim().split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  // Take the last line, strip JSON wrapper if needed
  let last = lines[lines.length - 1].trim();

  // Try to extract "content" from JSON line
  try {
    const obj = JSON.parse(last);
    if (typeof obj.content === "string" && obj.content.trim()) {
      last = obj.content.trim();
    } else if (typeof obj.result === "string" && obj.result.trim()) {
      last = obj.result.trim();
    }
  } catch {
    // Not JSON, use as-is
  }

  if (last.length > maxLen) {
    return last.slice(0, maxLen - 3) + "...";
  }
  return last;
}

function formatToolName(toolName: string): string {
  return TOOL_DISPLAY[toolName] || toolName;
}

export class ProgressReporter {
  private buffer = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTime: number;
  private lastReportedTool: string | null = null;
  private lastReportedAt = 0;
  private readonly intervalMs: number;
  private readonly onProgress: ProgressCallback;
  private stopped = false;

  constructor(options: ProgressReporterOptions) {
    this.intervalMs = options.intervalMs ?? 60_000;
    this.onProgress = options.onProgress;
    this.startTime = Date.now();
  }

  /** Start periodic progress checking. */
  start(): void {
    if (this.stopped) return;
    this.startTime = Date.now();
    this.timer = setInterval(() => this.check(), this.intervalMs);
  }

  /** Append new data to the buffer (call as stdout chunks arrive). */
  feed(chunk: string): void {
    this.buffer += chunk;
  }

  /** Get the full accumulated buffer. */
  getBuffer(): string {
    return this.buffer;
  }

  /** Stop the reporter and clear the timer. */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Perform a progress check and emit update if meaningful. */
  private check(): void {
    if (this.stopped || !this.buffer) return;

    const elapsedSec = Math.round((Date.now() - this.startTime) / 1000);
    const toolName = extractLatestToolCall(this.buffer);

    // Only report if tool changed or enough time passed
    if (toolName && toolName === this.lastReportedTool) {
      // Same tool — skip unless 2+ intervals have passed
      if (Date.now() - this.lastReportedAt < this.intervalMs * 1.5) return;
    }

    let message: string;
    if (toolName) {
      message = `⏳ 正在執行 ${formatToolName(toolName)}...（已執行 ${elapsedSec} 秒）`;
    } else {
      const snippet = extractLatestSnippet(this.buffer);
      if (snippet) {
        message = `⏳ 處理中...（已執行 ${elapsedSec} 秒）`;
      } else {
        message = `⏳ 執行中...（已執行 ${elapsedSec} 秒）`;
      }
    }

    this.lastReportedTool = toolName;
    this.lastReportedAt = Date.now();

    this.onProgress({ message, toolName: toolName ?? undefined, elapsedSec });
  }
}
