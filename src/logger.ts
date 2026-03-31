import { appendFileSync, writeFileSync } from "fs";

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  source: string;
  message: string;
  meta?: Record<string, unknown>;
}

export type LogLevel = LogEntry["level"];
export type LogSource =
  | "discord"
  | "telegram"
  | "heartbeat"
  | "runner"
  | "whisper"
  | "config"
  | "preflight"
  | "web"
  | "daemon"
  | "jobs"
  | "session"
  | "general";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
};

const STRUCTURED_LOG_PATH = "/tmp/claudeclaw-structured.log";

let minLevel: LogLevel = "info";
let structuredEnabled = true;

/**
 * 設定最低 log level
 */
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

/**
 * 啟用/停用 structured JSON log 檔案輸出
 */
export function setStructuredLogging(enabled: boolean): void {
  structuredEnabled = enabled;
}

/**
 * 取得目前設定的最低 log level
 */
export function getLogLevel(): LogLevel {
  return minLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function formatHuman(entry: LogEntry): string {
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const src = entry.source ? `[${entry.source}]` : "";
  const metaStr =
    entry.meta && Object.keys(entry.meta).length > 0
      ? ` ${JSON.stringify(entry.meta)}`
      : "";
  return `[${time}] ${LEVEL_LABEL[entry.level]} ${src} ${entry.message}${metaStr}`;
}

function formatJSON(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function writeStructured(json: string): void {
  if (!structuredEnabled) return;
  try {
    appendFileSync(STRUCTURED_LOG_PATH, json + "\n");
  } catch {
    // 寫入失敗不阻塞主流程
  }
}

function emit(entry: LogEntry): void {
  // stdout human-readable
  const human = formatHuman(entry);
  if (entry.level === "error") {
    console.error(human);
  } else if (entry.level === "warn") {
    console.warn(human);
  } else {
    console.log(human);
  }

  // structured JSON log file
  writeStructured(formatJSON(entry));
}

function createEntry(
  level: LogLevel,
  source: string,
  message: string,
  meta?: Record<string, unknown>,
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
    ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
  };
}

/**
 * 建立針對特定 source 的 logger instance
 */
export function createLogger(source: string) {
  return {
    debug(message: string, meta?: Record<string, unknown>): void {
      if (!shouldLog("debug")) return;
      emit(createEntry("debug", source, message, meta));
    },
    info(message: string, meta?: Record<string, unknown>): void {
      if (!shouldLog("info")) return;
      emit(createEntry("info", source, message, meta));
    },
    warn(message: string, meta?: Record<string, unknown>): void {
      if (!shouldLog("warn")) return;
      emit(createEntry("warn", source, message, meta));
    },
    error(message: string, meta?: Record<string, unknown>): void {
      if (!shouldLog("error")) return;
      emit(createEntry("error", source, message, meta));
    },
  };
}

/**
 * 直接 log 一筆（不綁 source）
 */
export function log(
  level: LogLevel,
  source: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (!shouldLog(level)) return;
  emit(createEntry(level, source, message, meta));
}

/**
 * 清空 structured log 檔案（測試用）
 */
export function resetStructuredLog(): void {
  try {
    writeFileSync(STRUCTURED_LOG_PATH, "");
  } catch {
    // ignore
  }
}

export const STRUCTURED_LOG_FILE = STRUCTURED_LOG_PATH;
