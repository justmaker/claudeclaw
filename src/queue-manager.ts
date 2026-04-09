/**
 * Queue Manager — 多 session 並行處理
 *
 * 每個 thread/channel 有自己的 FIFO queue，確保同一 thread 內訊息按序處理。
 * 所有 thread 共享 maxConcurrent 限制，控制全域並行數。
 * 主頻道（priority）訊息有預留 slot，不會被 subagent thread 擠掉。
 */

interface QueuedTask<T = unknown> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  priority?: boolean;
}

export class QueueManager {
  private maxConcurrent: number;
  private reservedSlots: number; // slots reserved for priority tasks
  private running = 0;
  private runningPriority = 0;
  private threadQueues = new Map<string, QueuedTask[]>();
  private activeThreads = new Set<string>();
  private pendingThreads: string[] = []; // round-robin fairness
  private priorityThreadIds = new Set<string>(); // threads marked as priority

  constructor(maxConcurrent = 10, reservedSlots = 2) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.reservedSlots = Math.max(0, reservedSlots);
  }

  /**
   * Enqueue a task for a specific thread. Tasks within the same thread
   * execute in order. Tasks across threads execute concurrently up to maxConcurrent.
   */
  enqueue<T>(threadId: string, fn: () => Promise<T>, priority = false): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let queue = this.threadQueues.get(threadId);
      if (!queue) {
        queue = [];
        this.threadQueues.set(threadId, queue);
      }
      queue.push({ fn, resolve, reject, priority } as QueuedTask);

      if (priority) {
        this.priorityThreadIds.add(threadId);
      }

      if (!this.activeThreads.has(threadId) && !this.pendingThreads.includes(threadId)) {
        if (priority) {
          // Priority tasks go to the front of the pending queue
          this.pendingThreads.unshift(threadId);
        } else {
          this.pendingThreads.push(threadId);
        }
      }

      this.drain();
    });
  }

  private drain(): void {
    while (this.running < this.maxConcurrent && this.pendingThreads.length > 0) {
      // Find the next thread to run, respecting reserved slots
      let picked = -1;
      for (let i = 0; i < this.pendingThreads.length; i++) {
        const tid = this.pendingThreads[i];
        const isPriority = this.priorityThreadIds.has(tid);

        if (isPriority) {
          // Priority tasks always get to run (they use any slot)
          picked = i;
          break;
        }

        // Non-priority: check if running would eat into reserved slots
        const nonPriorityRunning = this.running - this.runningPriority;
        const availableForNonPriority = this.maxConcurrent - this.reservedSlots;
        if (nonPriorityRunning < availableForNonPriority) {
          picked = i;
          break;
        }
        // else: skip this non-priority thread, reserved slots are protecting priority
      }

      if (picked === -1) break;

      const threadId = this.pendingThreads.splice(picked, 1)[0];
      const queue = this.threadQueues.get(threadId);
      if (!queue || queue.length === 0) {
        this.threadQueues.delete(threadId);
        continue;
      }

      const task = queue.shift()!;
      const isPriority = task.priority || this.priorityThreadIds.has(threadId);
      this.running++;
      if (isPriority) this.runningPriority++;
      this.activeThreads.add(threadId);

      task
        .fn()
        .then((result) => task.resolve(result))
        .catch((err) => task.reject(err))
        .finally(() => {
          this.running--;
          if (isPriority) this.runningPriority--;
          this.activeThreads.delete(threadId);

          // If this thread still has queued tasks, re-add to pending
          const remaining = this.threadQueues.get(threadId);
          if (remaining && remaining.length > 0) {
            if (this.priorityThreadIds.has(threadId)) {
              this.pendingThreads.unshift(threadId);
            } else {
              this.pendingThreads.push(threadId);
            }
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
