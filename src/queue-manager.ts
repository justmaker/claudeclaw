/**
 * Queue Manager — 多 session 並行處理
 *
 * 每個 thread/channel 有自己的 FIFO queue，確保同一 thread 內訊息按序處理。
 * 所有 thread 共享 maxConcurrent 限制，控制全域並行數。
 */

interface QueuedTask<T = unknown> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export class QueueManager {
  private maxConcurrent: number;
  private running = 0;
  private threadQueues = new Map<string, QueuedTask[]>();
  private activeThreads = new Set<string>();
  private pendingThreads: string[] = []; // round-robin fairness

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  /**
   * Enqueue a task for a specific thread. Tasks within the same thread
   * execute in order. Tasks across threads execute concurrently up to maxConcurrent.
   */
  enqueue<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let queue = this.threadQueues.get(threadId);
      if (!queue) {
        queue = [];
        this.threadQueues.set(threadId, queue);
      }
      queue.push({ fn, resolve, reject } as QueuedTask);

      if (!this.activeThreads.has(threadId) && !this.pendingThreads.includes(threadId)) {
        this.pendingThreads.push(threadId);
      }

      this.drain();
    });
  }

  private drain(): void {
    while (this.running < this.maxConcurrent && this.pendingThreads.length > 0) {
      const threadId = this.pendingThreads.shift()!;
      const queue = this.threadQueues.get(threadId);
      if (!queue || queue.length === 0) {
        this.threadQueues.delete(threadId);
        continue;
      }

      const task = queue.shift()!;
      this.running++;
      this.activeThreads.add(threadId);

      task
        .fn()
        .then((result) => task.resolve(result))
        .catch((err) => task.reject(err))
        .finally(() => {
          this.running--;
          this.activeThreads.delete(threadId);

          // If this thread still has queued tasks, re-add to pending
          const remaining = this.threadQueues.get(threadId);
          if (remaining && remaining.length > 0) {
            this.pendingThreads.push(threadId);
          } else {
            this.threadQueues.delete(threadId);
          }

          this.drain();
        });
    }
  }

  /** Current number of running tasks */
  get runningCount(): number {
    return this.running;
  }

  /** Total number of queued (waiting) tasks across all threads */
  get queuedCount(): number {
    let total = 0;
    for (const queue of this.threadQueues.values()) {
      total += queue.length;
    }
    return total;
  }

  /** Update maxConcurrent at runtime */
  setMaxConcurrent(n: number): void {
    this.maxConcurrent = Math.max(1, n);
    this.drain();
  }
}

// Singleton instance
let instance: QueueManager | null = null;

export function getQueueManager(maxConcurrent?: number): QueueManager {
  if (!instance) {
    instance = new QueueManager(maxConcurrent);
  } else if (maxConcurrent !== undefined) {
    instance.setMaxConcurrent(maxConcurrent);
  }
  return instance;
}
