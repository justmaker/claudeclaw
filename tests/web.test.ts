import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startWebUi, type WebServerHandle } from "../src/web";

let handle: WebServerHandle;
const TEST_PORT = 14632;

beforeAll(() => {
  handle = startWebUi({
    host: "127.0.0.1",
    port: TEST_PORT,
    getSnapshot: () => ({
      pid: 12345,
      startedAt: Date.now() - 60_000,
      heartbeatNextAt: Date.now() + 300_000,
      settings: {
        model: "opus",
        timezone: "Asia/Taipei",
        timezoneOffsetMinutes: -480,
        heartbeat: { enabled: true, interval: 15, prompt: "check", excludeWindows: [] },
        security: { allowedTools: [] },
        telegram: { token: "", allowedUserIds: [] },
        discord: { token: "fake", allowedUserIds: ["123"] },
        web: { enabled: true, host: "127.0.0.1", port: TEST_PORT },
      } as any,
      jobs: [],
    }),
  });
});

afterAll(() => {
  handle?.stop();
});

const base = `http://127.0.0.1:${TEST_PORT}`;

describe("Dashboard API endpoints", () => {
  it("GET /api/status returns uptime and model", async () => {
    const res = await fetch(`${base}/api/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(typeof data.uptime_ms).toBe("number");
    expect(data.pid).toBe(12345);
    expect(data.model).toBe("opus");
    expect(typeof data.heartbeat_enabled).toBe("boolean");
  });

  it("GET /api/sessions returns sessions array", async () => {
    const res = await fetch(`${base}/api/sessions`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.sessions)).toBe(true);
    expect(typeof data.total).toBe("number");
  });

  it("GET /api/metrics returns summary structure", async () => {
    const res = await fetch(`${base}/api/metrics`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(typeof data.period_days).toBe("number");
    expect(typeof data.total_sessions).toBe("number");
    expect(typeof data.success_rate).toBe("string");
  });

  it("GET /api/metrics?days=1 respects days param", async () => {
    const res = await fetch(`${base}/api/metrics?days=1`);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.period_days).toBe(1);
  });

  it("GET /api/queue returns running/queued counts", async () => {
    const res = await fetch(`${base}/api/queue`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(typeof data.running).toBe("number");
    expect(typeof data.queued).toBe("number");
  });

  it("GET /dashboard returns HTML", async () => {
    const res = await fetch(`${base}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("ClaudeClaw Dashboard");
  });
});
