/**
 * Memory Semantic Search — 用本機 embedding 或 TF-IDF 做語義搜尋
 */
import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import { join, resolve, relative } from "path";
import { existsSync } from "fs";
import { homedir } from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MemorySettings {
  enabled: boolean;
  dirs: string[];
  embeddingProvider: "ollama" | "tfidf";
  embeddingModel: string;
  ollamaUrl: string;
  autoIndex: boolean;
  indexIntervalMs: number;
}

export interface MemoryChunk {
  path: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  embedding: number[];
}

export interface MemoryIndex {
  chunks: MemoryChunk[];
  lastIndexedAt?: string;
}

export interface MemoryResult {
  path: string;
  lineStart: number;
  lineEnd: number;
  score: number;
  snippet: string;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  dirs: ["~/.claude/claudeclaw/workspace"],
  embeddingProvider: "ollama",
  embeddingModel: "nomic-embed-text",
  ollamaUrl: "http://localhost:11434",
  autoIndex: true,
  indexIntervalMs: 3600000,
};

const INDEX_PATH = join(homedir(), ".claude", "claudeclaw", "memory-index.json");

// ─── Utilities ───────────────────────────────────────────────────────────────

function expandPath(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : resolve(p);
}

/** 將 markdown 文字拆成 ~500 字的 chunks，保留行號 */
export function splitChunks(text: string, chunkSize = 500): { text: string; lineStart: number; lineEnd: number }[] {
  if (!text) return [];
  const lines = text.split("\n");
  const chunks: { text: string; lineStart: number; lineEnd: number }[] = [];
  let buf: string[] = [];
  let bufStart = 1;
  let charCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    buf.push(line);
    charCount += line.length + 1;

    if (charCount >= chunkSize) {
      chunks.push({ text: buf.join("\n"), lineStart: bufStart, lineEnd: i + 1 });
      buf = [];
      bufStart = i + 2;
      charCount = 0;
    }
  }
  if (buf.length > 0) {
    chunks.push({ text: buf.join("\n"), lineStart: bufStart, lineEnd: lines.length });
  }
  return chunks;
}

/** Cosine similarity */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── TF-IDF / BM25 Fallback ─────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(t => t.length > 1);
}

/** 建立簡易 TF-IDF embedding（稀疏 → 稠密投影） */
export class TfIdfEngine {
  private vocabulary: Map<string, number> = new Map();
  private idf: Map<string, number> = new Map();
  private docCount = 0;
  private docFreq: Map<string, number> = new Map();

  /** 從語料庫建立 IDF */
  fit(documents: string[]): void {
    this.docCount = documents.length;
    this.docFreq.clear();
    this.vocabulary.clear();

    for (const doc of documents) {
      const seen = new Set(tokenize(doc));
      for (const token of seen) {
        this.docFreq.set(token, (this.docFreq.get(token) || 0) + 1);
        if (!this.vocabulary.has(token)) {
          this.vocabulary.set(token, this.vocabulary.size);
        }
      }
    }

    this.idf.clear();
    for (const [token, df] of this.docFreq) {
      this.idf.set(token, Math.log((this.docCount + 1) / (df + 1)) + 1);
    }
  }

  /** 將文字轉為固定長度的 TF-IDF 向量 */
  embed(text: string): number[] {
    const tokens = tokenize(text);
    const tf: Map<string, number> = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);

    const dim = this.vocabulary.size;
    if (dim === 0) return [];
    const vec = new Array(dim).fill(0);

    for (const [token, count] of tf) {
      const idx = this.vocabulary.get(token);
      if (idx !== undefined) {
        vec[idx] = (count / tokens.length) * (this.idf.get(token) || 1);
      }
    }
    return vec;
  }
}

// ─── Ollama Embedding ────────────────────────────────────────────────────────

async function ollamaEmbed(text: string, model: string, baseUrl: string): Promise<number[]> {
  const resp = await fetch(`${baseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
  });
  if (!resp.ok) throw new Error(`Ollama embedding failed: ${resp.status} ${resp.statusText}`);
  const data = (await resp.json()) as { embedding: number[] };
  return data.embedding;
}

async function isOllamaAvailable(baseUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── MemoryStore ─────────────────────────────────────────────────────────────

export class MemoryStore {
  private settings: MemorySettings;
  private indexData: MemoryIndex = { chunks: [] };
  private tfidf: TfIdfEngine = new TfIdfEngine();
  private usingTfIdf = false;
  private autoIndexTimer: ReturnType<typeof setInterval> | null = null;

  constructor(settings?: Partial<MemorySettings>) {
    this.settings = { ...DEFAULT_MEMORY_SETTINGS, ...settings };
  }

  getSettings(): MemorySettings { return this.settings; }

  /** 載入已有索引 */
  async loadIndex(): Promise<void> {
    try {
      if (existsSync(INDEX_PATH)) {
        const raw = await readFile(INDEX_PATH, "utf-8");
        this.indexData = JSON.parse(raw);
      }
    } catch {
      this.indexData = { chunks: [] };
    }
  }

  /** 儲存索引到磁碟 */
  async saveIndex(): Promise<void> {
    const dir = join(homedir(), ".claude", "claudeclaw");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(INDEX_PATH, JSON.stringify(this.indexData), "utf-8");
  }

  /** 決定 embedding backend */
  private async resolveProvider(): Promise<"ollama" | "tfidf"> {
    if (this.settings.embeddingProvider === "tfidf") return "tfidf";
    const available = await isOllamaAvailable(this.settings.ollamaUrl);
    if (available) return "ollama";
    console.log("[Memory] Ollama 不可用，fallback 到 TF-IDF");
    return "tfidf";
  }

  /** 生成 embedding（Ollama 或 TF-IDF） */
  private async embed(text: string): Promise<number[]> {
    if (this.usingTfIdf) return this.tfidf.embed(text);
    return ollamaEmbed(text, this.settings.embeddingModel, this.settings.ollamaUrl);
  }

  /** 索引單一檔案 */
  async index(filePath: string): Promise<number> {
    const absPath = expandPath(filePath);
    const content = await readFile(absPath, "utf-8");
    const chunks = splitChunks(content);

    // 如果尚未決定 provider，先決定
    if (!this.usingTfIdf) {
      const provider = await this.resolveProvider();
      this.usingTfIdf = provider === "tfidf";
      if (this.usingTfIdf) {
        this.tfidf.fit([content]);
      }
    }

    // 移除該檔案的舊 chunks
    this.indexData.chunks = this.indexData.chunks.filter(c => c.path !== absPath);

    for (const chunk of chunks) {
      const embedding = await this.embed(chunk.text);
      this.indexData.chunks.push({
        path: absPath,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        text: chunk.text,
        embedding,
      });
    }
    return chunks.length;
  }

  /** 掃描整個目錄的 .md 檔 */
  async indexAll(dir: string): Promise<number> {
    const absDir = expandPath(dir);
    const provider = await this.resolveProvider();
    this.usingTfIdf = provider === "tfidf";

    // 掃描所有 .md 檔案
    const files = await this.walkMd(absDir);

    // TF-IDF 需要先 fit
    if (this.usingTfIdf) {
      const allTexts: string[] = [];
      const allChunks: { path: string; text: string; lineStart: number; lineEnd: number }[] = [];
      for (const f of files) {
        const content = await readFile(f, "utf-8");
        const chunks = splitChunks(content);
        for (const c of chunks) {
          allTexts.push(c.text);
          allChunks.push({ path: f, ...c });
        }
      }
      this.tfidf.fit(allTexts);

      // 清除目錄下的舊 chunks
      const dirPrefix = absDir.endsWith("/") ? absDir : absDir + "/";
      this.indexData.chunks = this.indexData.chunks.filter(c => !c.path.startsWith(dirPrefix) && c.path !== absDir);

      for (const c of allChunks) {
        this.indexData.chunks.push({
          path: c.path,
          lineStart: c.lineStart,
          lineEnd: c.lineEnd,
          text: c.text,
          embedding: this.tfidf.embed(c.text),
        });
      }
      this.indexData.lastIndexedAt = new Date().toISOString();
      return allChunks.length;
    }

    // Ollama: 逐檔索引
    let total = 0;
    for (const f of files) {
      total += await this.index(f);
    }
    this.indexData.lastIndexedAt = new Date().toISOString();
    return total;
  }

  /** 重建所有索引 */
  async reindex(): Promise<number> {
    this.indexData = { chunks: [] };
    let total = 0;
    for (const dir of this.settings.dirs) {
      total += await this.indexAll(dir);
    }
    await this.saveIndex();
    return total;
  }

  /** 語義搜尋 */
  async search(query: string, topK = 5): Promise<MemoryResult[]> {
    if (this.indexData.chunks.length === 0) return [];

    const provider = await this.resolveProvider();
    this.usingTfIdf = provider === "tfidf";

    // TF-IDF 搜尋時需要先 fit（如果還沒 fit 的話）
    if (this.usingTfIdf && this.tfidf["vocabulary"].size === 0) {
      this.tfidf.fit(this.indexData.chunks.map(c => c.text));
      // 重新計算所有 embeddings
      for (const chunk of this.indexData.chunks) {
        chunk.embedding = this.tfidf.embed(chunk.text);
      }
    }

    const queryEmbedding = await this.embed(query);
    if (queryEmbedding.length === 0) return [];

    const scored = this.indexData.chunks
      .map(chunk => ({
        path: chunk.path,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
        snippet: chunk.text.slice(0, 200),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  /** 取得狀態 */
  status(): { chunkCount: number; lastIndexedAt: string | null; provider: string } {
    return {
      chunkCount: this.indexData.chunks.length,
      lastIndexedAt: this.indexData.lastIndexedAt || null,
      provider: this.usingTfIdf ? "tfidf" : "ollama",
    };
  }

  /** 啟動自動索引 */
  startAutoIndex(): void {
    if (!this.settings.autoIndex || this.autoIndexTimer) return;
    this.autoIndexTimer = setInterval(async () => {
      try {
        await this.reindex();
        console.log(`[Memory] 自動重建索引完成，${this.indexData.chunks.length} chunks`);
      } catch (err) {
        console.error("[Memory] 自動索引失敗:", err);
      }
    }, this.settings.indexIntervalMs);
  }

  stopAutoIndex(): void {
    if (this.autoIndexTimer) {
      clearInterval(this.autoIndexTimer);
      this.autoIndexTimer = null;
    }
  }

  /** 遞迴掃描 .md 檔案 */
  private async walkMd(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const full = join(dir, entry);
        const s = await stat(full);
        if (s.isDirectory()) {
          results.push(...await this.walkMd(full));
        } else if (entry.endsWith(".md")) {
          results.push(full);
        }
      }
    } catch { /* skip inaccessible dirs */ }
    return results;
  }

  // For testing: expose index data
  getIndexData(): MemoryIndex { return this.indexData; }
  setIndexData(data: MemoryIndex): void { this.indexData = data; }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _store: MemoryStore | null = null;

export function getMemoryStore(settings?: Partial<MemorySettings>): MemoryStore {
  if (!_store) _store = new MemoryStore(settings);
  return _store;
}

export function resetMemoryStore(): void {
  if (_store) _store.stopAutoIndex();
  _store = null;
}

// ─── Slash Command Handler ───────────────────────────────────────────────────

export async function handleMemoryCommand(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const store = getMemoryStore();
  await store.loadIndex();

  if (sub === "search") {
    const query = parts.slice(1).join(" ");
    if (!query) return "用法：`/memory search <查詢>`";
    const results = await store.search(query);
    if (results.length === 0) return "沒有找到相關記憶。";
    return results.map((r, i) =>
      `**${i + 1}.** \`${r.path}\` (L${r.lineStart}-${r.lineEnd}) — score: ${r.score.toFixed(3)}\n> ${r.snippet.replace(/\n/g, "\n> ")}`
    ).join("\n\n");
  }

  if (sub === "reindex") {
    const count = await store.reindex();
    return `✅ 索引重建完成，共 ${count} 個 chunks。`;
  }

  if (sub === "status") {
    const s = store.status();
    return [
      `📊 **Memory 索引狀態**`,
      `- Chunks: ${s.chunkCount}`,
      `- 最後索引: ${s.lastIndexedAt || "尚未索引"}`,
      `- Provider: ${s.provider}`,
    ].join("\n");
  }

  return "用法：`/memory search|reindex|status`";
}

// ─── Context Injection（AI 回答前呼叫） ──────────────────────────────────────

export async function getMemoryContext(query: string, topK = 3): Promise<string | null> {
  try {
    const store = getMemoryStore();
    await store.loadIndex();
    if (store.getIndexData().chunks.length === 0) return null;

    const results = await store.search(query, topK);
    if (results.length === 0 || results[0].score < 0.1) return null;

    const ctx = results
      .filter(r => r.score >= 0.1)
      .map(r => `[${r.path} L${r.lineStart}-${r.lineEnd}]\n${r.snippet}`)
      .join("\n---\n");

    return `<memory-context>\n${ctx}\n</memory-context>`;
  } catch {
    return null;
  }
}
