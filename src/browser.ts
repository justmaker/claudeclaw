/**
 * BrowserManager — 瀏覽器原生控制（基於 playwright-core）
 *
 * Singleton pattern，整個 ClaudeClaw 共用一個 browser instance。
 * 使用系統安裝的 Chromium，不依賴 Claude Code 的 dev-browser plugin。
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

export interface BrowserConfig {
  enabled: boolean;
  headless: boolean;
  executablePath: string;
  noSandbox: boolean;
  extraArgs: string[];
}

export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  enabled: true,
  headless: true,
  executablePath: "/usr/bin/chromium-browser",
  noSandbox: true,
  extraArgs: ["--disable-gpu"],
};

export function parseBrowserConfig(raw: Record<string, any> | undefined): BrowserConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BROWSER_CONFIG };
  return {
    enabled: raw.enabled !== false,
    headless: raw.headless !== false,
    executablePath:
      typeof raw.executablePath === "string" && raw.executablePath.trim()
        ? raw.executablePath.trim()
        : DEFAULT_BROWSER_CONFIG.executablePath,
    noSandbox: raw.noSandbox !== false,
    extraArgs: Array.isArray(raw.extraArgs)
      ? raw.extraArgs.filter((a: unknown) => typeof a === "string")
      : DEFAULT_BROWSER_CONFIG.extraArgs,
  };
}

export class BrowserManager {
  private static instance: BrowserManager | null = null;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: BrowserConfig;

  private constructor(config: BrowserConfig) {
    this.config = config;
  }

  /** 取得或建立 singleton instance */
  static getInstance(config?: BrowserConfig): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager(config ?? DEFAULT_BROWSER_CONFIG);
    }
    return BrowserManager.instance;
  }

  /** 重設 singleton（主要用於測試） */
  static resetInstance(): void {
    BrowserManager.instance = null;
  }

  /** 啟動瀏覽器 */
  async launch(options?: Partial<BrowserConfig>): Promise<void> {
    if (this.browser?.isConnected()) return;

    const cfg = { ...this.config, ...options };
    const args = [...cfg.extraArgs];
    if (cfg.noSandbox) {
      args.push("--no-sandbox", "--disable-setuid-sandbox");
    }

    this.browser = await chromium.launch({
      headless: cfg.headless,
      executablePath: cfg.executablePath,
      args,
    });

    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
  }

  /** 確保瀏覽器已啟動 */
  private async ensurePage(): Promise<Page> {
    if (!this.page || !this.browser?.isConnected()) {
      await this.launch();
    }
    return this.page!;
  }

  /** 導航到指定 URL */
  async navigate(url: string): Promise<void> {
    const page = await this.ensurePage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }

  /** 截圖，回傳 PNG Buffer */
  async screenshot(options?: { fullPage?: boolean }): Promise<Buffer> {
    const page = await this.ensurePage();
    const buf = await page.screenshot({
      type: "png",
      fullPage: options?.fullPage ?? false,
    });
    return Buffer.from(buf);
  }

  /** 取得 accessibility tree snapshot（文字版，給 AI 看） */
  async snapshot(): Promise<string> {
    const page = await this.ensurePage();
    // playwright-core 較新版本用 page.accessibility.snapshot() 可能不存在
    // 改用 aria snapshot 或手動取得頁面結構
    try {
      const tree = await (page as any).accessibility?.snapshot();
      if (tree) return formatAccessibilityNode(tree, 0);
    } catch {}
    // Fallback: 取得頁面文字內容摘要
    const title = await page.title();
    const text = await page.innerText("body").catch(() => "");
    const truncated = text.slice(0, 4000);
    return `[page] "${title}"\n${truncated}`;
  }

  /** 點擊元素 */
  async click(selector: string): Promise<void> {
    const page = await this.ensurePage();
    await page.click(selector);
  }

  /** 輸入文字 */
  async type(selector: string, text: string): Promise<void> {
    const page = await this.ensurePage();
    await page.fill(selector, text);
  }

  /** 執行 JavaScript */
  async evaluate(js: string): Promise<unknown> {
    const page = await this.ensurePage();
    return page.evaluate(js);
  }

  /** 取得當前頁面 URL */
  get currentUrl(): string {
    return this.page?.url() ?? "";
  }

  /** 瀏覽器是否運行中 */
  get isRunning(): boolean {
    return this.browser?.isConnected() ?? false;
  }

  /** 關閉瀏覽器 */
  async close(): Promise<void> {
    try {
      await this.context?.close();
    } catch {}
    try {
      await this.browser?.close();
    } catch {}
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}

/** 將 accessibility tree node 轉成可讀文字 */
function formatAccessibilityNode(
  node: { role?: string; name?: string; children?: any[] },
  depth: number,
): string {
  const indent = "  ".repeat(depth);
  const role = node.role ?? "unknown";
  const name = node.name ? ` "${node.name}"` : "";
  let result = `${indent}[${role}]${name}\n`;

  if (node.children) {
    for (const child of node.children) {
      result += formatAccessibilityNode(child, depth + 1);
    }
  }
  return result;
}
