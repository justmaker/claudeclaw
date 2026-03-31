/**
 * Cron Scheduler — 通用定時任務系統
 *
 * 獨立於 heartbeat，支援 cron expression 排程。
 * 每個 job 可設定 prompt、model、target（telegram/discord/both）。
 */

import { cronMatches, nextCronMatch } from "./cron";

export interface CronJob {
  name: string;
  cron: string;
  prompt: string;
  model?: string;
  target?: "telegram" | "discord" | "both";
  enabled?: boolean;
}

export interface CronJobStatus extends CronJob {
  nextAt: Date;
}

export type CronJobRunner = (job: CronJob) => Promise<void>;

export class CronScheduler {
  private jobs: CronJob[] = [];
  private timezoneOffsetMinutes: number = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private runner: CronJobRunner | null = null;

  constructor(opts?: { timezoneOffsetMinutes?: number }) {
    this.timezoneOffsetMinutes = opts?.timezoneOffsetMinutes ?? 0;
  }

  /** 載入 jobs（從 settings.cron） */
  loadJobs(jobs: CronJob[]): void {
    this.jobs = jobs.map((j) => ({ ...j, enabled: j.enabled !== false }));
  }

  /** 設定 job runner callback */
  onJobTriggered(runner: CronJobRunner): void {
    this.runner = runner;
  }

  /** 更新時區 offset */
  setTimezoneOffset(minutes: number): void {
    this.timezoneOffsetMinutes = minutes;
  }

  /** 取得所有 jobs + 下次執行時間 */
  getStatus(): CronJobStatus[] {
    const now = new Date();
    return this.jobs.map((job) => ({
      ...job,
      nextAt: job.enabled !== false
        ? nextCronMatch(job.cron, now, this.timezoneOffsetMinutes)
        : new Date(0),
    }));
  }

  /** 依名稱 enable/disable job */
  setEnabled(name: string, enabled: boolean): boolean {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) return false;
    job.enabled = enabled;
    return true;
  }

  /** 取得 job by name */
  getJob(name: string): CronJob | undefined {
    return this.jobs.find((j) => j.name === name);
  }

  /** 啟動排程（每 60 秒 tick） */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 60_000);
  }

  /** 停止排程 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 手動觸發一次 tick（主要給測試用） */
  tick(): void {
    const now = new Date();
    for (const job of this.jobs) {
      if (job.enabled === false) continue;
      if (cronMatches(job.cron, now, this.timezoneOffsetMinutes)) {
        if (this.runner) {
          this.runner(job).catch((err) => {
            console.error(`[cron-scheduler] Job "${job.name}" failed:`, err);
          });
        }
      }
    }
  }

  /** 是否正在運行 */
  get running(): boolean {
    return this.timer !== null;
  }

  /** 目前載入的 job 數量 */
  get jobCount(): number {
    return this.jobs.length;
  }

  /** 取得啟用中的 jobs */
  get enabledJobs(): CronJob[] {
    return this.jobs.filter((j) => j.enabled !== false);
  }
}

// --- Global singleton access ---
let _instance: CronScheduler | null = null;

export function setCronSchedulerInstance(scheduler: CronScheduler): void {
  _instance = scheduler;
}

export function getCronScheduler(): CronScheduler | null {
  return _instance;
}
