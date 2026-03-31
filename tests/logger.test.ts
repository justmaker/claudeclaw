import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  createLogger,
  log,
  setLogLevel,
  setStructuredLogging,
  resetStructuredLog,
  getLogLevel,
  STRUCTURED_LOG_FILE,
  type LogEntry,
} from "../src/logger";
import { readFileSync, existsSync } from "fs";

describe("logger", () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    setLogLevel("debug");
    setStructuredLogging(true);
    resetStructuredLog();
    consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    setLogLevel("info");
  });

  describe("createLogger", () => {
    it("應輸出各 level 的 log", () => {
      const logger = createLogger("discord");
      logger.debug("debug msg");
      logger.info("info msg");
      logger.warn("warn msg");
      logger.error("error msg");

      expect(consoleSpy).toHaveBeenCalledTimes(2); // debug + info
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it("應在 human-readable 輸出中包含 source tag", () => {
      const logger = createLogger("telegram");
      logger.info("test message");

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain("[telegram]");
      expect(output).toContain("test message");
      expect(output).toContain("INFO");
    });

    it("應支援 meta 資料", () => {
      const logger = createLogger("runner");
      logger.info("session started", { session_id: "abc123", user: "rex" });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain("session_id");
      expect(output).toContain("abc123");
    });
  });

  describe("structured JSON log", () => {
    it("應寫入合法 JSON 到檔案", () => {
      const logger = createLogger("heartbeat");
      logger.info("heartbeat ok", { duration_ms: 42 });

      const content = readFileSync(STRUCTURED_LOG_FILE, "utf-8").trim();
      const entry: LogEntry = JSON.parse(content);

      expect(entry.level).toBe("info");
      expect(entry.source).toBe("heartbeat");
      expect(entry.message).toBe("heartbeat ok");
      expect(entry.meta?.duration_ms).toBe(42);
    });

    it("timestamp 應為 ISO 8601 格式", () => {
      const logger = createLogger("discord");
      logger.info("test");

      const content = readFileSync(STRUCTURED_LOG_FILE, "utf-8").trim();
      const entry: LogEntry = JSON.parse(content);

      // ISO 8601: 2024-01-01T00:00:00.000Z
      expect(entry.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it("多行 JSON 應可逐行被 jq 解析", () => {
      const logger = createLogger("whisper");
      logger.info("msg1");
      logger.warn("msg2");
      logger.error("msg3");

      const lines = readFileSync(STRUCTURED_LOG_FILE, "utf-8")
        .trim()
        .split("\n");
      expect(lines.length).toBe(3);

      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed).toHaveProperty("timestamp");
        expect(parsed).toHaveProperty("level");
        expect(parsed).toHaveProperty("source");
        expect(parsed).toHaveProperty("message");
      }
    });

    it("沒有 meta 時不應包含 meta 欄位", () => {
      const logger = createLogger("runner");
      logger.info("simple msg");

      const content = readFileSync(STRUCTURED_LOG_FILE, "utf-8").trim();
      const entry = JSON.parse(content);

      expect(entry).not.toHaveProperty("meta");
    });
  });

  describe("log level filtering", () => {
    it("設定 warn 時應過濾 debug 和 info", () => {
      setLogLevel("warn");
      const logger = createLogger("discord");
      logger.debug("should not appear");
      logger.info("should not appear");
      logger.warn("should appear");
      logger.error("should appear");

      expect(consoleSpy).toHaveBeenCalledTimes(0);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it("設定 error 時只有 error 會輸出", () => {
      setLogLevel("error");
      const logger = createLogger("telegram");
      logger.debug("no");
      logger.info("no");
      logger.warn("no");
      logger.error("yes");

      expect(consoleSpy).toHaveBeenCalledTimes(0);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(0);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("log() 直接呼叫", () => {
    it("應正確輸出", () => {
      log("info", "general", "direct call", { key: "value" });

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain("[general]");
      expect(output).toContain("direct call");
    });
  });

  describe("structured logging toggle", () => {
    it("停用時不應寫檔", () => {
      setStructuredLogging(false);
      resetStructuredLog();

      const logger = createLogger("discord");
      logger.info("should not be in file");

      const content = existsSync(STRUCTURED_LOG_FILE)
        ? readFileSync(STRUCTURED_LOG_FILE, "utf-8").trim()
        : "";
      expect(content).toBe("");

      setStructuredLogging(true);
    });
  });
});
