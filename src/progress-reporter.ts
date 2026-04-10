/**
 * Progress Reporter — periodically extracts progress from Claude Code subprocess
 * stdout buffer and reports it via callback.
 *
 * Claude Code streams JSON lines or text to stdout. This module accumulates
 * the raw output, extracts the latest tool call or text snippet every interval,
 * and fires a callback so Discord/Telegram handlers can send status updates.
 */

export interface ProgressUpdate {
  /** Human-readable status with tool details */
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
  Task: "子任務",
  TaskOutput: "子任務輸出",
  Skill: "技能",
};

/** Truncate a string to maxLen, appending "..." if truncated */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

/** Extract basename from a file path */
function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

interface ToolEvent {
  name: string;
  detail: string; // human-readable detail
  raw: any;       // original input object
}

/**
 * Parse all tool_use events from the accumulated buffer.
 * Returns them in order so the last one is the most recent.
 */
export function extractToolEvents(buffer: string): ToolEvent[] {
  const events: ToolEvent[] = [];
  for (const line of buffer.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      // assistant message with tool_use in content
      if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
        for (const block of obj.message.content) {
          if (block.type === "tool_use" && block.name) {
            const detail = formatToolDetail(block.name, block.input);
            events.push({ name: block.name, detail, raw: block.input });
          }
        }
      }
      // content_block_start with tool_use
      if (obj.type === "content_block_start" && obj.content_block?.type === "tool_use") {
        const cb = obj.content_block;
        const detail = formatToolDetail(cb.name, cb.input);
        events.push({ name: cb.name, detail, raw: cb.input });
      }
    } catch {
      // Not JSON — try plain text patterns
      const textMatch = trimmed.match(/(?:Using tool|Tool|Calling):\s*(\w+)/i);
      if (textMatch) {
        events.push({ name: textMatch[1], detail: "", raw: {} });
      }
    }
  }
  return events;
}

/**
 * Format a human-readable detail string from tool input.
 */
function formatToolDetail(toolName: string, input: any): string {
  if (!input || typeof input !== "object") return "";

  switch (toolName) {
    case "Bash":
      if (input.command) return truncate(input.command, 80);
      if (input.description) return truncate(input.description, 80);
      return "";
    case "Read":
      if (input.file_path) return basename(input.file_path);
      return "";
    case "Write":
      if (input.file_path) return basename(input.file_path);
      return "";
    case "Edit":
      if (input.file_path) return basename(input.file_path);
      return "";
    case "Grep":
      if (input.pattern) return `"${truncate(input.pattern, 40)}"`;
      return "";
    case "Glob":
      if (input.pattern) return truncate(input.pattern, 60);
      return "";
    case "WebSearch":
      if (input.query) return `"${truncate(input.query, 60)}"`;
      return "";
    case "WebFetch":
      if (input.url) return truncate(input.url, 80);
      return "";
    case "Task":
      if (input.description) return truncate(input.description, 60);
      return "";
    case "Skill":
      if (input.skill) return input.skill;
      return "";
    default:
      // MCP tools: try to extract something useful
      if (toolName.startsWith("mcp__")) {
        const shortName = toolName.split("__").pop() || toolName;
        const firstVal = Object.values(input).find(v => typeof v === "string" && v.length > 0);
        return firstVal ? `${shortName}: ${truncate(String(firstVal), 50)}` : shortName;
      }
      return "";
  }
}

/**
 * Extract the most recent tool call name from accumulated stdout.
 * (Kept for backward compatibility)
 */
export function extractLatestToolCall(buffer: string): string | null {
  const events = extractToolEvents(buffer);
  return events.length > 0 ? events[events.length - 1].name : null;
}

/**
 * Extract a short text snippet from the latest output for display.
 * Returns the last meaningful non-empty line (up to 60 chars).
 */
export function extractLatestSnippet(buffer: string, maxLen = 60): string | null {
  const lines = buffer.trim().split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  let last = lines[lines.length - 1].trim();

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
  private lastReportedDetail: string | null = null;
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
    const events = extractToolEvents(this.buffer);
    const latest = events.length > 0 ? events[events.length - 1] : null;
    const toolName = latest?.name ?? null;
    const detail = latest?.detail ?? null;

    // Skip if nothing changed and not enough time passed
    if (toolName === this.lastReportedTool && detail === this.lastReportedDetail) {
      if (Date.now() - this.lastReportedAt < this.intervalMs * 1.5) return;
    }

    // Build multi-line status showing recent activity
    const lines: string[] = [];

    if (latest) {
      const displayName = formatToolName(latest.name);
      if (detail) {
        lines.push(`⏳ ${displayName}: \`${detail}\``);
      } else {
        lines.push(`⏳ ${displayName}...`);
      }
    } else {
      lines.push(`⏳ 思考中...`);
    }

    // Show last 2-3 distinct tool calls for context
    if (events.length > 1) {
      const recentUnique: ToolEvent[] = [];
      const seen = new Set<string>();
      for (let i = events.length - 2; i >= 0 && recentUnique.length < 2; i--) {
        const key = `${events[i].name}:${events[i].detail}`;
        if (!seen.has(key)) {
          seen.add(key);
          recentUnique.unshift(events[i]);
        }
      }
      for (const evt of recentUnique) {
        const dn = formatToolName(evt.name);
        lines.push(evt.detail ? `  ✅ ${dn}: \`${truncate(evt.detail, 60)}\`` : `  ✅ ${dn}`);
      }
    }

    lines.push(`（已執行 ${elapsedSec} 秒）`);

    const message = lines.join("\n");

    this.lastReportedTool = toolName;
    this.lastReportedDetail = detail;
    this.lastReportedAt = Date.now();

    this.onProgress({ message, toolName: toolName ?? undefined, elapsedSec });
  }
}
