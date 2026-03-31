import { describe, it, expect, beforeEach } from "bun:test";
import {
  ProgressReporter,
  extractLatestToolCall,
  extractLatestSnippet,
  type ProgressUpdate,
} from "../src/progress-reporter";

describe("extractLatestToolCall", () => {
  it("extracts tool name from JSON tool_use format", () => {
    const buffer = '{"type":"tool_use","name":"Read","input":{}}\n{"type":"tool_use","name":"Bash","input":{}}';
    expect(extractLatestToolCall(buffer)).toBe("Bash");
  });

  it("extracts tool name from tool_name field", () => {
    const buffer = '{"tool_name":"Write","content":"hello"}';
    expect(extractLatestToolCall(buffer)).toBe("Write");
  });

  it("extracts tool name from plain text", () => {
    const buffer = "Processing...\nUsing tool: Grep\nSearching files...";
    expect(extractLatestToolCall(buffer)).toBe("Grep");
  });

  it("returns null for empty buffer", () => {
    expect(extractLatestToolCall("")).toBeNull();
  });

  it("returns null when no tool pattern found", () => {
    expect(extractLatestToolCall("just some random output")).toBeNull();
  });
});

describe("extractLatestSnippet", () => {
  it("extracts last non-empty line", () => {
    expect(extractLatestSnippet("line1\nline2\nline3")).toBe("line3");
  });

  it("truncates long lines", () => {
    const long = "a".repeat(100);
    const result = extractLatestSnippet(long, 60);
    expect(result!.length).toBe(60);
    expect(result!.endsWith("...")).toBe(true);
  });

  it("extracts content from JSON line", () => {
    const buffer = '{"content":"Hello world"}';
    expect(extractLatestSnippet(buffer)).toBe("Hello world");
  });

  it("returns null for empty buffer", () => {
    expect(extractLatestSnippet("")).toBeNull();
  });
});

describe("ProgressReporter", () => {
  let updates: ProgressUpdate[];

  beforeEach(() => {
    updates = [];
  });

  it("fires callback on check with tool data", async () => {
    const reporter = new ProgressReporter({
      intervalMs: 50,
      onProgress: (u) => updates.push(u),
    });

    reporter.feed('{"type":"tool_use","name":"Read","input":{}}');
    reporter.start();

    await new Promise((r) => setTimeout(r, 120));
    reporter.stop();

    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[0].message).toContain("讀取檔案");
    expect(updates[0].toolName).toBe("Read");
    expect(updates[0].elapsedSec).toBeGreaterThanOrEqual(0);
  });

  it("does not fire when buffer is empty", async () => {
    const reporter = new ProgressReporter({
      intervalMs: 50,
      onProgress: (u) => updates.push(u),
    });

    reporter.start();
    await new Promise((r) => setTimeout(r, 120));
    reporter.stop();

    expect(updates.length).toBe(0);
  });

  it("stop prevents further callbacks", async () => {
    const reporter = new ProgressReporter({
      intervalMs: 50,
      onProgress: (u) => updates.push(u),
    });

    reporter.feed("some output");
    reporter.start();
    await new Promise((r) => setTimeout(r, 70));
    reporter.stop();
    const count = updates.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(updates.length).toBe(count);
  });

  it("getBuffer returns accumulated data", () => {
    const reporter = new ProgressReporter({
      intervalMs: 1000,
      onProgress: () => {},
    });
    reporter.feed("chunk1");
    reporter.feed("chunk2");
    expect(reporter.getBuffer()).toBe("chunk1chunk2");
    reporter.stop();
  });
});
