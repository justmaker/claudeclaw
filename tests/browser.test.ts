import { describe, test, expect, beforeEach } from "bun:test";
import {
  BrowserManager,
  parseBrowserConfig,
  DEFAULT_BROWSER_CONFIG,
  type BrowserConfig,
} from "../src/browser";

describe("parseBrowserConfig", () => {
  test("回傳預設值（無輸入）", () => {
    expect(parseBrowserConfig(undefined)).toEqual(DEFAULT_BROWSER_CONFIG);
  });

  test("回傳預設值（空物件）", () => {
    expect(parseBrowserConfig({})).toEqual(DEFAULT_BROWSER_CONFIG);
  });

  test("正確解析完整設定", () => {
    const raw = {
      enabled: false,
      headless: false,
      executablePath: "/usr/bin/chromium",
      noSandbox: false,
      extraArgs: ["--disable-dev-shm-usage"],
    };
    const cfg = parseBrowserConfig(raw);
    expect(cfg.enabled).toBe(false);
    expect(cfg.headless).toBe(false);
    expect(cfg.executablePath).toBe("/usr/bin/chromium");
    expect(cfg.noSandbox).toBe(false);
    expect(cfg.extraArgs).toEqual(["--disable-dev-shm-usage"]);
  });

  test("過濾非字串的 extraArgs", () => {
    const cfg = parseBrowserConfig({ extraArgs: ["--flag", 123, null, "--ok"] });
    expect(cfg.extraArgs).toEqual(["--flag", "--ok"]);
  });

  test("空 executablePath 回退到預設", () => {
    const cfg = parseBrowserConfig({ executablePath: "  " });
    expect(cfg.executablePath).toBe(DEFAULT_BROWSER_CONFIG.executablePath);
  });
});

describe("BrowserManager singleton", () => {
  beforeEach(() => {
    BrowserManager.resetInstance();
  });

  test("getInstance 回傳同一個 instance", () => {
    const a = BrowserManager.getInstance();
    const b = BrowserManager.getInstance();
    expect(a).toBe(b);
  });

  test("resetInstance 後回傳新 instance", () => {
    const a = BrowserManager.getInstance();
    BrowserManager.resetInstance();
    const b = BrowserManager.getInstance();
    expect(a).not.toBe(b);
  });

  test("初始狀態 isRunning 為 false", () => {
    const mgr = BrowserManager.getInstance();
    expect(mgr.isRunning).toBe(false);
  });

  test("初始狀態 currentUrl 為空字串", () => {
    const mgr = BrowserManager.getInstance();
    expect(mgr.currentUrl).toBe("");
  });

  test("close 在未啟動時不拋錯", async () => {
    const mgr = BrowserManager.getInstance();
    await mgr.close(); // should not throw
    expect(mgr.isRunning).toBe(false);
  });
});
