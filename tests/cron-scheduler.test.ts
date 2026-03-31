import { describe, test, expect, beforeEach } from "bun:test";
import { CronScheduler, type CronJob } from "../src/cron-scheduler";

const sampleJobs: CronJob[] = [
  {
    name: "morning-report",
    cron: "0 9 * * 1-5",
    prompt: "查看今天的 JIRA 待辦事項",
    model: "sonnet",
    target: "telegram",
  },
  {
    name: "weekly-metrics",
    cron: "0 18 * * 5",
    prompt: "產出本週使用指標報告",
    target: "discord",
  },
  {
    name: "disabled-job",
    cron: "*/5 * * * *",
    prompt: "this should not run",
    enabled: false,
  },
];

describe("CronScheduler", () => {
  let scheduler: CronScheduler;

  beforeEach(() => {
    scheduler = new CronScheduler({ timezoneOffsetMinutes: 0 });
    scheduler.loadJobs(sampleJobs);
  });

  describe("loadJobs", () => {
    test("載入所有 jobs", () => {
      expect(scheduler.jobCount).toBe(3);
    });

    test("enabled 預設為 true", () => {
      const job = scheduler.getJob("morning-report");
      expect(job?.enabled).toBe(true);
    });

    test("明確設定 enabled: false 保留", () => {
      const job = scheduler.getJob("disabled-job");
      expect(job?.enabled).toBe(false);
    });
  });

  describe("enabledJobs", () => {
    test("過濾掉 disabled jobs", () => {
      const enabled = scheduler.enabledJobs;
      expect(enabled.length).toBe(2);
      expect(enabled.map((j) => j.name)).toEqual(["morning-report", "weekly-metrics"]);
    });
  });

  describe("setEnabled", () => {
    test("disable 一個 job", () => {
      const ok = scheduler.setEnabled("morning-report", false);
      expect(ok).toBe(true);
      expect(scheduler.getJob("morning-report")?.enabled).toBe(false);
      expect(scheduler.enabledJobs.length).toBe(1);
    });

    test("enable 一個 disabled job", () => {
      const ok = scheduler.setEnabled("disabled-job", true);
      expect(ok).toBe(true);
      expect(scheduler.getJob("disabled-job")?.enabled).toBe(true);
    });

    test("不存在的 job 回傳 false", () => {
      const ok = scheduler.setEnabled("nonexistent", true);
      expect(ok).toBe(false);
    });
  });

  describe("getStatus", () => {
    test("每個 job 都有 nextAt", () => {
      const statuses = scheduler.getStatus();
      expect(statuses.length).toBe(3);
      for (const s of statuses) {
        expect(s.nextAt).toBeInstanceOf(Date);
      }
    });

    test("disabled job 的 nextAt 是 epoch 0", () => {
      const statuses = scheduler.getStatus();
      const disabled = statuses.find((s) => s.name === "disabled-job");
      expect(disabled?.nextAt.getTime()).toBe(0);
    });

    test("enabled job 的 nextAt 在未來", () => {
      const statuses = scheduler.getStatus();
      const enabled = statuses.find((s) => s.name === "morning-report");
      expect(enabled!.nextAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });
  });

  describe("tick", () => {
    test("觸發匹配的 job runner", async () => {
      const triggered: string[] = [];
      scheduler.loadJobs([
        { name: "every-minute", cron: "* * * * *", prompt: "test" },
      ]);
      scheduler.onJobTriggered(async (job) => {
        triggered.push(job.name);
      });

      scheduler.tick();
      await Bun.sleep(50);
      expect(triggered).toContain("every-minute");
    });

    test("不觸發 disabled job", async () => {
      const triggered: string[] = [];
      scheduler.loadJobs([
        { name: "disabled", cron: "* * * * *", prompt: "test", enabled: false },
      ]);
      scheduler.onJobTriggered(async (job) => {
        triggered.push(job.name);
      });

      scheduler.tick();
      await Bun.sleep(50);
      expect(triggered).toEqual([]);
    });

    test("不匹配的 cron 不觸發", async () => {
      const triggered: string[] = [];
      scheduler.loadJobs([
        { name: "never", cron: "0 0 30 2 *", prompt: "test" },
      ]);
      scheduler.onJobTriggered(async (job) => {
        triggered.push(job.name);
      });

      scheduler.tick();
      await Bun.sleep(50);
      expect(triggered).toEqual([]);
    });
  });

  describe("start / stop", () => {
    test("start 後 running 為 true", () => {
      scheduler.start();
      expect(scheduler.running).toBe(true);
      scheduler.stop();
    });

    test("stop 後 running 為 false", () => {
      scheduler.start();
      scheduler.stop();
      expect(scheduler.running).toBe(false);
    });

    test("重複 start 不會建立多個 timer", () => {
      scheduler.start();
      scheduler.start();
      expect(scheduler.running).toBe(true);
      scheduler.stop();
    });
  });

  describe("setTimezoneOffset", () => {
    test("更新 timezone offset", () => {
      scheduler.setTimezoneOffset(480);
      const statuses = scheduler.getStatus();
      expect(statuses.length).toBeGreaterThan(0);
    });
  });
});
