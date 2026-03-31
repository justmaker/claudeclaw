import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { recordMetrics, getMetricsSummary, type MetricRecord } from "../src/metrics";
import { unlink, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const METRICS_FILE = join(homedir(), ".claude", "claudeclaw", "metrics.jsonl");
const BACKUP_FILE = METRICS_FILE + ".test-backup";

let hadExisting = false;

beforeEach(async () => {
  // Backup existing metrics file
  try {
    const content = await readFile(METRICS_FILE, "utf8");
    const { writeFile } = await import("fs/promises");
    await writeFile(BACKUP_FILE, content);
    hadExisting = true;
  } catch {
    hadExisting = false;
  }
  // Remove for clean test
  try { await unlink(METRICS_FILE); } catch {}
});

afterEach(async () => {
  // Restore backup
  try { await unlink(METRICS_FILE); } catch {}
  if (hadExisting) {
    const { writeFile } = await import("fs/promises");
    const content = await readFile(BACKUP_FILE, "utf8");
    await writeFile(METRICS_FILE, content);
    try { await unlink(BACKUP_FILE); } catch {}
  }
});

function makeRecord(overrides: Partial<MetricRecord> = {}): MetricRecord {
  return {
    timestamp: new Date().toISOString(),
    source: "discord",
    model: "claude-sonnet-4-20250514",
    token_usage: { input: 1000, output: 500 },
    duration_ms: 3000,
    exit_code: 0,
    session_id: "test-session-123",
    thread_id: null,
    ...overrides,
  };
}

describe("metrics", () => {
  it("should record and retrieve metrics", async () => {
    await recordMetrics(makeRecord());
    await recordMetrics(makeRecord({ source: "telegram", exit_code: 1 }));

    const summary = await getMetricsSummary(1);
    expect(summary.total_sessions).toBe(2);
    expect(summary.success_count).toBe(1);
    expect(summary.failure_count).toBe(1);
    expect(summary.success_rate).toBe("50.0%");
    expect(summary.total_input_tokens).toBe(2000);
    expect(summary.total_output_tokens).toBe(1000);
    expect(summary.by_source["discord"]).toBe(1);
    expect(summary.by_source["telegram"]).toBe(1);
  });

  it("should return empty summary when no file exists", async () => {
    const summary = await getMetricsSummary(7);
    expect(summary.total_sessions).toBe(0);
    expect(summary.success_rate).toBe("0.0%");
  });

  it("should filter by time window", async () => {
    // Record with old timestamp
    const old = makeRecord({ timestamp: new Date(Date.now() - 10 * 86400_000).toISOString() });
    const recent = makeRecord();
    await recordMetrics(old);
    await recordMetrics(recent);

    const summary = await getMetricsSummary(7);
    expect(summary.total_sessions).toBe(1);
  });

  it("should track by_model correctly", async () => {
    await recordMetrics(makeRecord({ model: "claude-sonnet-4-20250514" }));
    await recordMetrics(makeRecord({ model: "claude-sonnet-4-20250514" }));
    await recordMetrics(makeRecord({ model: "glm" }));

    const summary = await getMetricsSummary(1);
    expect(summary.by_model["claude-sonnet-4-20250514"]).toBe(2);
    expect(summary.by_model["glm"]).toBe(1);
  });

  it("should write NDJSON format", async () => {
    await recordMetrics(makeRecord());
    await recordMetrics(makeRecord());

    const raw = await readFile(METRICS_FILE, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(() => JSON.parse(lines[0])).not.toThrow();
    expect(() => JSON.parse(lines[1])).not.toThrow();
  });
});
