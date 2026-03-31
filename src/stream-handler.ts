/**
 * StreamHandler — 收集 streaming chunks，debounce 合併後透過 callback 更新訊息。
 */

export interface StreamHandlerOptions {
  updateIntervalMs?: number;
  minChunkChars?: number;
  onUpdate: (text: string) => void | Promise<void>;
}

export class StreamHandler {
  private buffer: string = "";
  private fullText: string = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFlushTime: number = 0;
  private readonly updateIntervalMs: number;
  private readonly minChunkChars: number;
  private readonly onUpdate: (text: string) => void | Promise<void>;
  private _finished: boolean = false;

  constructor(options: StreamHandlerOptions) {
    this.updateIntervalMs = options.updateIntervalMs ?? 2000;
    this.minChunkChars = options.minChunkChars ?? 50;
    this.onUpdate = options.onUpdate;
  }

  start(): void {
    if (this.timer) return;
    this.lastFlushTime = Date.now();
    this.timer = setInterval(() => this.flush(), this.updateIntervalMs);
  }

  push(chunk: string): void {
    if (this._finished) return;
    this.buffer += chunk;
    this.fullText += chunk;
  }

  getText(): string {
    return this.fullText;
  }

  private flush(): void {
    if (this._finished) return;
    if (this.buffer.length < this.minChunkChars) return;
    const now = Date.now();
    if (now - this.lastFlushTime < this.updateIntervalMs) return;
    this.lastFlushTime = now;
    this.buffer = "";
    try { this.onUpdate(this.fullText); } catch {}
  }

  async finish(): Promise<string> {
    this._finished = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.fullText.length > 0) {
      try { await this.onUpdate(this.fullText); } catch {}
    }
    return this.fullText;
  }

  get finished(): boolean {
    return this._finished;
  }
}
