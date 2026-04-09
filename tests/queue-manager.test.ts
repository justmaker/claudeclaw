import { describe, it, expect } from "bun:test";
import { QueueManager } from "../src/queue-manager";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("QueueManager", () => {
  // reservedSlots=0 for basic tests (no priority logic)
  it("respects maxConcurrent limit", async () => {
    const qm = new QueueManager(2, 0);
    let peak = 0;
    let current = 0;

    const task = async () => {
      current++;
      if (current > peak) peak = current;
      await delay(50);
      current--;
    };

    const promises = [
      qm.enqueue("a", task),
      qm.enqueue("b", task),
      qm.enqueue("c", task),
      qm.enqueue("d", task),
    ];

    await Promise.all(promises);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("processes same-thread tasks in order", async () => {
    const qm = new QueueManager(3, 0);
    const order: number[] = [];

    const makeTask = (n: number) => async () => {
      await delay(10);
      order.push(n);
      return n;
    };

    await Promise.all([
      qm.enqueue("t1", makeTask(1)),
      qm.enqueue("t1", makeTask(2)),
      qm.enqueue("t1", makeTask(3)),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  it("allows different threads to run concurrently", async () => {
    const qm = new QueueManager(3, 0);
    const startTimes: Record<string, number> = {};
    const start = Date.now();

    const makeTask = (id: string) => async () => {
      startTimes[id] = Date.now() - start;
      await delay(50);
    };

    await Promise.all([
      qm.enqueue("a", makeTask("a")),
      qm.enqueue("b", makeTask("b")),
      qm.enqueue("c", makeTask("c")),
    ]);

    // All three should start nearly simultaneously (within 20ms)
    expect(startTimes["a"]).toBeLessThan(20);
    expect(startTimes["b"]).toBeLessThan(20);
    expect(startTimes["c"]).toBeLessThan(20);
  });

  it("propagates errors without blocking queue", async () => {
    const qm = new QueueManager(2, 0);

    const failTask = async () => {
      throw new Error("boom");
    };
    const okTask = async () => "ok";

    const results = await Promise.allSettled([
      qm.enqueue("a", failTask),
      qm.enqueue("b", okTask),
    ]);

    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
    expect((results[1] as PromiseFulfilledResult<string>).value).toBe("ok");

    // Queue should still work after error
    const after = await qm.enqueue("a", okTask);
    expect(after).toBe("ok");
  });

  it("tracks running and queued counts", async () => {
    const qm = new QueueManager(1, 0);
    let resolveFirst!: () => void;
    const blocker = new Promise<void>((r) => { resolveFirst = r; });

    const p1 = qm.enqueue("a", () => blocker);
    const p2 = qm.enqueue("b", async () => "done");

    // Give microtasks time to settle
    await delay(5);
    expect(qm.runningCount).toBe(1);
    expect(qm.queuedCount).toBe(1);

    resolveFirst();
    await Promise.all([p1, p2]);
    await delay(10);

    expect(qm.runningCount).toBe(0);
    expect(qm.queuedCount).toBe(0);
  });

  it("setMaxConcurrent drains waiting tasks", async () => {
    const qm = new QueueManager(1, 0);
    let running = 0;
    let peak = 0;

    const task = async () => {
      running++;
      if (running > peak) peak = running;
      await delay(50);
      running--;
    };

    // Start 3 tasks with concurrency 1
    const p1 = qm.enqueue("a", task);
    const p2 = qm.enqueue("b", task);
    const p3 = qm.enqueue("c", task);

    await delay(10);
    // Bump concurrency — should allow more to start
    qm.setMaxConcurrent(3);

    await Promise.all([p1, p2, p3]);
    // After bumping, peak should be > 1
    expect(peak).toBeGreaterThan(1);
  });

  it("priority tasks bypass reserved slots", async () => {
    // maxConcurrent=3, reservedSlots=2: non-priority can only use 1 slot
    const qm = new QueueManager(3, 2);
    let resolvers: (() => void)[] = [];
    const makeBlocker = () => new Promise<void>((r) => { resolvers.push(r); });

    // Fill 1 non-priority slot (max for non-priority = 3-2 = 1)
    const p1 = qm.enqueue("a", () => makeBlocker());
    await delay(5);
    expect(qm.runningCount).toBe(1);

    // Second non-priority should be queued (slot full for non-priority)
    const p2 = qm.enqueue("b", async () => "b-done");
    await delay(5);
    expect(qm.runningCount).toBe(1);
    expect(qm.queuedCount).toBe(1);

    // Priority task should run immediately (uses reserved slots)
    let priorityStarted = false;
    const p3 = qm.enqueue("c", async () => { priorityStarted = true; await delay(50); return "c-done"; }, true);
    await delay(10);
    expect(priorityStarted).toBe(true);
    expect(qm.runningCount).toBe(2);

    // Cleanup
    resolvers.forEach((r) => r());
    await Promise.all([p1, p2, p3]);
  });
});
