import { describe, test, expect, beforeEach } from "bun:test";
import {
  registerChildProcess,
  unregisterChildProcess,
  getTrackedProcesses,
  shutdownAll,
} from "../src/process-manager";
import { spawn } from "child_process";

// Helper: reset tracked state between tests
function clearTracked() {
  for (const p of getTrackedProcesses()) {
    unregisterChildProcess(p.pid);
  }
}

describe("process-manager", () => {
  beforeEach(() => clearTracked());

  test("register and unregister", () => {
    registerChildProcess(99999, "test-proc");
    expect(getTrackedProcesses()).toHaveLength(1);
    expect(getTrackedProcesses()[0].name).toBe("test-proc");

    unregisterChildProcess(99999);
    expect(getTrackedProcesses()).toHaveLength(0);
  });

  test("unregister non-existent pid is no-op", () => {
    unregisterChildProcess(12345);
    expect(getTrackedProcesses()).toHaveLength(0);
  });

  test("shutdownAll with no processes", async () => {
    const result = await shutdownAll(100);
    expect(result.terminated).toHaveLength(0);
    expect(result.killed).toHaveLength(0);
  });

  test("graceful shutdown terminates a real process", async () => {
    // spawn a sleep process that responds to SIGTERM
    const child = spawn("sleep", ["60"]);
    registerChildProcess(child.pid!, "sleep-graceful");

    const result = await shutdownAll(3000);
    // sleep responds to SIGTERM, should be in terminated
    expect(result.terminated).toContain("sleep-graceful");
    expect(result.killed).not.toContain("sleep-graceful");
    expect(getTrackedProcesses()).toHaveLength(0);
  });

  test("force kill after timeout for unresponsive process", async () => {
    // spawn a process that traps SIGTERM (ignores it)
    // Use setsid-like isolation: detach stdio so child doesn't get parent signals
    const child = spawn("bash", ["-c", "trap '' TERM INT; while true; do sleep 1; done"], {
      detached: false,
      stdio: "ignore",
    });
    // Give bash time to set up the trap
    await new Promise((r) => setTimeout(r, 200));
    registerChildProcess(child.pid!, "stubborn-proc");

    const result = await shutdownAll(500); // short timeout
    // Should have been force killed
    expect(result.killed).toContain("stubborn-proc");
    expect(getTrackedProcesses()).toHaveLength(0);
  });
});
