import { describe, it, expect, beforeEach } from "bun:test";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  splitChunks,
  cosineSimilarity,
  TfIdfEngine,
  MemoryStore,
  resetMemoryStore,
  handleMemoryCommand,
} from "../src/memory";

// ─── chunk splitting ─────────────────────────────────────────────────────────

describe("splitChunks", () => {
  it("回傳單一 chunk 當文字很短", () => {
    const result = splitChunks("Hello world", 500);
    expect(result.length).toBe(1);
    expect(result[0].lineStart).toBe(1);
    expect(result[0].text).toBe("Hello world");
  });

  it("正確拆分多個 chunks", () => {
    const line = "a".repeat(100);
    const text = Array(10).fill(line).join("\n"); // 10 行，每行 100 字
    const chunks = splitChunks(text, 300);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("lineStart/lineEnd 正確連續", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join("\n");
    const chunks = splitChunks(text, 50);
    expect(chunks[0].lineStart).toBe(1);
    // Last chunk ends at the last line
    const last = chunks[chunks.length - 1];
    expect(last.lineEnd).toBe(20);
  });

  it("空字串回傳空陣列", () => {
    expect(splitChunks("", 500).length).toBe(0);
  });
});

// ─── cosine similarity ───────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("相同向量回傳 1", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("正交向量回傳 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("長度不同回傳 0", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("零向量回傳 0", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("部分相似向量介於 0 和 1 之間", () => {
    const a = [1, 1, 0];
    const b = [1, 0, 1];
    const score = cosineSimilarity(a, b);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

// ─── TF-IDF ──────────────────────────────────────────────────────────────────

describe("TfIdfEngine", () => {
  it("fit + embed 產生非零向量", () => {
    const engine = new TfIdfEngine();
    const docs = ["hello world", "foo bar baz", "hello foo"];
    engine.fit(docs);
    const vec = engine.embed("hello");
    expect(vec.length).toBeGreaterThan(0);
    const nonZero = vec.some(v => v > 0);
    expect(nonZero).toBe(true);
  });

  it("相關文件的相似度高於無關文件", () => {
    const engine = new TfIdfEngine();
    const docs = [
      "typescript programming language",
      "javascript web development",
      "cooking recipe pasta",
    ];
    engine.fit(docs);

    const qVec = engine.embed("typescript language");
    const v0 = engine.embed(docs[0]);
    const v1 = engine.embed(docs[2]);

    const s0 = cosineSimilarity(qVec, v0);
    const s1 = cosineSimilarity(qVec, v1);
    expect(s0).toBeGreaterThan(s1);
  });

  it("未 fit 時回傳空向量", () => {
    const engine = new TfIdfEngine();
    expect(engine.embed("hello").length).toBe(0);
  });
});

// ─── MemoryStore (TF-IDF, 無需 Ollama) ──────────────────────────────────────

describe("MemoryStore", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetMemoryStore();
    tmpDir = await (async () => {
      const d = join(tmpdir(), `mem-test-${Date.now()}`);
      await mkdir(d, { recursive: true });
      return d;
    })();
  });

  const cleanup = async () => {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
  };

  it("index 單一 .md 檔案", async () => {
    const file = join(tmpDir, "test.md");
    await writeFile(file, "# Hello\n\nThis is a test memory file.\n");
    const store = new MemoryStore({ embeddingProvider: "tfidf" });
    const count = await store.index(file);
    expect(count).toBeGreaterThan(0);
    expect(store.getIndexData().chunks.some(c => c.path === file)).toBe(true);
    await cleanup();
  });

  it("indexAll 掃描目錄並建立 chunks", async () => {
    await writeFile(join(tmpDir, "a.md"), "Apple banana cherry\n".repeat(10));
    await writeFile(join(tmpDir, "b.md"), "Dog elephant fox\n".repeat(10));
    const store = new MemoryStore({ embeddingProvider: "tfidf" });
    const count = await store.indexAll(tmpDir);
    expect(count).toBeGreaterThan(0);
    await cleanup();
  });

  it("search 回傳相關結果", async () => {
    await writeFile(join(tmpDir, "lang.md"),
      "TypeScript is a typed superset of JavaScript.\n".repeat(20));
    await writeFile(join(tmpDir, "cook.md"),
      "Pasta recipe with tomato sauce and basil.\n".repeat(20));

    const store = new MemoryStore({ embeddingProvider: "tfidf" });
    await store.indexAll(tmpDir);
    const results = await store.search("typescript javascript", 3);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("lang.md");
    await cleanup();
  });

  it("search 回傳 MemoryResult 正確欄位", async () => {
    await writeFile(join(tmpDir, "c.md"), "Cats are independent animals.\n".repeat(10));
    const store = new MemoryStore({ embeddingProvider: "tfidf" });
    await store.indexAll(tmpDir);
    const results = await store.search("cats independent", 1);
    expect(results[0]).toHaveProperty("path");
    expect(results[0]).toHaveProperty("lineStart");
    expect(results[0]).toHaveProperty("lineEnd");
    expect(results[0]).toHaveProperty("score");
    expect(results[0]).toHaveProperty("snippet");
    await cleanup();
  });

  it("index 同一檔案兩次不重複 chunks", async () => {
    const file = join(tmpDir, "dup.md");
    await writeFile(file, "Duplicate test.\n".repeat(5));
    const store = new MemoryStore({ embeddingProvider: "tfidf" });
    // 先 fit（模擬已有詞彙）
    (store as any).usingTfIdf = true;
    (store as any).tfidf.fit(["Duplicate test"]);
    await store.index(file);
    const before = store.getIndexData().chunks.filter(c => c.path === file).length;
    await store.index(file);
    const after = store.getIndexData().chunks.filter(c => c.path === file).length;
    expect(after).toBe(before);
    await cleanup();
  });

  it("status 回傳正確欄位", () => {
    const store = new MemoryStore({ embeddingProvider: "tfidf" });
    const s = store.status();
    expect(s).toHaveProperty("chunkCount");
    expect(s).toHaveProperty("lastIndexedAt");
    expect(s).toHaveProperty("provider");
  });
});

// ─── Index file I/O ──────────────────────────────────────────────────────────

describe("MemoryStore index I/O", () => {
  it("saveIndex + loadIndex 正確保存並讀取", async () => {
    const store = new MemoryStore({ embeddingProvider: "tfidf" });
    store.setIndexData({
      chunks: [{ path: "/tmp/x.md", lineStart: 1, lineEnd: 5, text: "hello world", embedding: [0.1, 0.2] }],
      lastIndexedAt: "2026-04-01T00:00:00.000Z",
    });

    await store.saveIndex();

    const store2 = new MemoryStore({ embeddingProvider: "tfidf" });
    await store2.loadIndex();
    const data = store2.getIndexData();
    expect(data.chunks.length).toBe(1);
    expect(data.chunks[0].path).toBe("/tmp/x.md");
    expect(data.lastIndexedAt).toBe("2026-04-01T00:00:00.000Z");

    // cleanup
    try { await rm(join(process.env.HOME || "", ".claude", "claudeclaw", "memory-index.json"), { force: true }); } catch {}
  });
});

// ─── Slash command handler ───────────────────────────────────────────────────

describe("handleMemoryCommand", () => {
  beforeEach(() => resetMemoryStore());

  it("/memory status 回傳狀態", async () => {
    const reply = await handleMemoryCommand("status");
    expect(reply).toContain("Chunks");
  });

  it("/memory search 無索引時回傳空", async () => {
    const reply = await handleMemoryCommand("search typescript");
    expect(reply).toContain("沒有找到");
  });

  it("無效子命令回傳用法提示", async () => {
    const reply = await handleMemoryCommand("unknown");
    expect(reply).toContain("用法");
  });

  it("/memory search 無查詢時回傳用法", async () => {
    const reply = await handleMemoryCommand("search");
    expect(reply).toContain("用法");
  });
});
