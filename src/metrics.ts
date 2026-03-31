import { mkdir, readFile, appendFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const METRICS_DIR = join(homedir(), ".claude", "claudeclaw");
const METRICS_FILE = join(METRICS_DIR, "metrics.jsonl");

export interface MetricRecord {
  timestamp: string;
  source: string;
  model: string;
  token_usage: { input: number; output: number };
  duration_ms: number;
  exit_code: number;
  session_id: string;
  thread_id: string | null;
}

export interface MetricsSummary {
  period_days: number;
  total_sessions: number;
  total_input_tokens: number;
  total_output_tokens: number;
  success_count: number;
  failure_count: number;
  success_rate: string;
  avg_duration_ms: number;
  by_source: Record<string, number>;
  by_model: Record<string, number>;
}

export async function recordMetrics(record: MetricRecord): Promise<void> {
  await mkdir(METRICS_DIR, { recursive: true });
  await appendFile(METRICS_FILE, JSON.stringify(record) + "\n", "utf8");
}

export async function getMetricsSummary(sinceDays: number = 7): Promise<MetricsSummary> {
  const cutoff = Date.now() - sinceDays * 86400_000;
  let lines: string[];

  try {
    const raw = await readFile(METRICS_FILE, "utf8");
    lines = raw.trim().split("\n").filter(Boolean);
  } catch {
    return emptySummary(sinceDays);
  }

  const records: MetricRecord[] = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line) as MetricRecord;
      if (new Date(r.timestamp).getTime() >= cutoff) records.push(r);
    } catch {}
  }

  if (records.length === 0) return emptySummary(sinceDays);

  let totalInput = 0, totalOutput = 0, totalDuration = 0, success = 0, failure = 0;
  const bySource: Record<string, number> = {};
  const byModel: Record<string, number> = {};

  for (const r of records) {
    totalInput += r.token_usage.input;
    totalOutput += r.token_usage.output;
    totalDuration += r.duration_ms;
    if (r.exit_code === 0) success++; else failure++;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    const modelKey = r.model || "default";
    byModel[modelKey] = (byModel[modelKey] ?? 0) + 1;
  }

  return {
    period_days: sinceDays,
    total_sessions: records.length,
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    success_count: success,
    failure_count: failure,
    success_rate: ((success / records.length) * 100).toFixed(1) + "%",
    avg_duration_ms: Math.round(totalDuration / records.length),
    by_source: bySource,
    by_model: byModel,
  };
}

function emptySummary(days: number): MetricsSummary {
  return {
    period_days: days,
    total_sessions: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    success_count: 0,
    failure_count: 0,
    success_rate: "0.0%",
    avg_duration_ms: 0,
    by_source: {},
    by_model: {},
  };
}
