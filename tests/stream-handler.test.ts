import { describe, it, expect } from "bun:test";
import { StreamHandler } from "../src/stream-handler";

describe("StreamHandler", () => {
  describe("chunk 合併邏輯", () => {
    it("push 的 chunks 應合併為完整文字", async () => {
      const updates: string[] = [];
      const handler = new StreamHandler({
        updateIntervalMs: 100,
        minChunkChars: 0,
        onUpdate: (text: string) => { updates.push(text); },
      });
      handler.push("Hello ");
      handler.push("World");
      handler.push("!");
      const result = await handler.finish();
      expect(result).toBe("Hello World!");
      expect(updates.length).toBeGreaterThanOrEqual(1);
      expect(updates[updates.length - 1]).toBe("Hello World!");
    });

    it("getText() 應返回目前累積的完整文字", () => {
      const handler = new StreamHandler({ onUpdate: () => {} });
      handler.push("foo");
      handler.push("bar");
      expect(handler.getText()).toBe("foobar");
    });
  });

  describe("debounce / throttle", () => {
    it("低於 minChunkChars 不應觸發 onUpdate（finish 前）", async () => {
      const updates: string[] = [];
      const handler = new StreamHandler({
        updateIntervalMs: 50,
        minChunkChars: 100,
        onUpdate: (text: string) => { updates.push(text); },
      });
      handler.start();
      handler.push("short");
      await new Promise((r) => setTimeout(r, 120));
      expect(updates.length).toBe(0);
      await handler.finish();
      expect(updates.length).toBe(1);
      expect(updates[0]).toBe("short");
    });

    it("超過 minChunkChars 的累積應在 interval 後觸發 onUpdate", async () => {
      const updates: string[] = [];
      const handler = new StreamHandler({
        updateIntervalMs: 50,
        minChunkChars: 5,
        onUpdate: (text: string) => { updates.push(text); },
      });
      handler.start();
      handler.push("Hello World - this is a longer text");
      await new Promise((r) => setTimeout(r, 120));
      expect(updates.length).toBeGreaterThanOrEqual(1);
      await handler.finish();
    });
  });

  describe("finish 最終訊息", () => {
    it("finish 後不再接受 push", async () => {
      const handler = new StreamHandler({ onUpdate: () => {} });
      handler.push("before");
      await handler.finish();
      handler.push("after");
      expect(handler.getText()).toBe("before");
      expect(handler.finished).toBe(true);
    });

    it("空文字的 handler finish 不應出錯", async () => {
      const updates: string[] = [];
      const handler = new StreamHandler({ onUpdate: (text: string) => { updates.push(text); } });
      const result = await handler.finish();
      expect(result).toBe("");
      expect(updates.length).toBe(0);
    });

    it("finish 應返回完整文字", async () => {
      const handler = new StreamHandler({ onUpdate: () => {} });
      handler.push("chunk1");
      handler.push("chunk2");
      handler.push("chunk3");
      const result = await handler.finish();
      expect(result).toBe("chunk1chunk2chunk3");
    });
  });

  describe("start/stop lifecycle", () => {
    it("多次 start 不應建立多個 timer", async () => {
      const handler = new StreamHandler({ updateIntervalMs: 100, onUpdate: () => {} });
      handler.start();
      handler.start();
      handler.start();
      await handler.finish();
    });
  });
});
