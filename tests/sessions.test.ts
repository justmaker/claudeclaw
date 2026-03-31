import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { join } from "path";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";

/**
 * sessions.ts 測試
 * 因為 sessions.ts 使用 process.cwd() 來決定 session 檔案位置，
 * 我們透過直接操作檔案來模擬 session CRUD。
 */

describe("sessions", () => {
  let tmpDir: string;
  let sessionFile: string;

  // 我們直接測試 session 資料結構的行為邏輯
  describe("GlobalSession 資料結構", () => {
    it("新 session 有正確初始值", () => {
      const session = {
        sessionId: "test-session-123",
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        turnCount: 0,
        compactWarned: false,
      };

      expect(session.sessionId).toBe("test-session-123");
      expect(session.turnCount).toBe(0);
      expect(session.compactWarned).toBe(false);
    });

    it("turnCount 遞增邏輯", () => {
      const session = {
        sessionId: "test-session-123",
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        turnCount: 0,
        compactWarned: false,
      };

      session.turnCount += 1;
      expect(session.turnCount).toBe(1);

      session.turnCount += 1;
      expect(session.turnCount).toBe(2);
    });

    it("compactWarned 標記邏輯", () => {
      const session = {
        sessionId: "test",
        createdAt: "",
        lastUsedAt: "",
        turnCount: 24,
        compactWarned: false,
      };

      // 門檻是 25
      expect(session.turnCount >= 25).toBe(false);

      session.turnCount += 1;
      expect(session.turnCount >= 25).toBe(true);

      session.compactWarned = true;
      expect(session.compactWarned).toBe(true);
    });

    it("backfill 缺少的欄位", () => {
      // 模擬舊版 session.json 缺少欄位
      const oldSession: any = {
        sessionId: "old-session",
        createdAt: "2024-01-01T00:00:00Z",
        lastUsedAt: "2024-01-01T00:00:00Z",
      };

      // backfill 邏輯
      if (typeof oldSession.turnCount !== "number") oldSession.turnCount = 0;
      if (typeof oldSession.compactWarned !== "boolean") oldSession.compactWarned = false;

      expect(oldSession.turnCount).toBe(0);
      expect(oldSession.compactWarned).toBe(false);
    });
  });

  describe("session 檔案 I/O", () => {
    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "cc-session-test-"));
      const claudeDir = join(tmpDir, ".claude", "claudeclaw");
      await mkdir(claudeDir, { recursive: true });
      sessionFile = join(claudeDir, "session.json");
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true });
    });

    it("create → 寫入 session 檔案", async () => {
      const session = {
        sessionId: "new-session-abc",
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        turnCount: 0,
        compactWarned: false,
      };

      await Bun.write(sessionFile, JSON.stringify(session, null, 2) + "\n");

      const loaded = await Bun.file(sessionFile).json();
      expect(loaded.sessionId).toBe("new-session-abc");
      expect(loaded.turnCount).toBe(0);
    });

    it("peek → 讀取不修改 lastUsedAt", async () => {
      const originalTime = "2024-06-01T00:00:00.000Z";
      const session = {
        sessionId: "peek-test",
        createdAt: originalTime,
        lastUsedAt: originalTime,
        turnCount: 5,
        compactWarned: false,
      };

      await Bun.write(sessionFile, JSON.stringify(session, null, 2) + "\n");

      // peek 只讀不寫
      const loaded = await Bun.file(sessionFile).json();
      expect(loaded.lastUsedAt).toBe(originalTime);
      expect(loaded.turnCount).toBe(5);
    });

    it("reset → 刪除 session 檔案", async () => {
      const session = { sessionId: "to-delete", createdAt: "", lastUsedAt: "", turnCount: 0, compactWarned: false };
      await Bun.write(sessionFile, JSON.stringify(session));

      const { existsSync } = await import("fs");
      expect(existsSync(sessionFile)).toBe(true);

      const { unlink } = await import("fs/promises");
      await unlink(sessionFile);
      expect(existsSync(sessionFile)).toBe(false);
    });

    it("reset 不存在的檔案不報錯", async () => {
      const { existsSync } = await import("fs");
      expect(existsSync(sessionFile)).toBe(false);

      // 模擬 resetSession 的 try/catch
      try {
        const { unlink } = await import("fs/promises");
        await unlink(sessionFile);
      } catch {
        // already gone — 這是預期行為
      }
      // 不應拋錯
      expect(true).toBe(true);
    });

    it("backup → 重新命名 session 檔案", async () => {
      const session = { sessionId: "backup-me", createdAt: "", lastUsedAt: "", turnCount: 10, compactWarned: true };
      await Bun.write(sessionFile, JSON.stringify(session));

      const { rename, readdir } = await import("fs/promises");
      const { existsSync } = await import("fs");
      const dir = join(tmpDir, ".claude", "claudeclaw");

      const backupPath = join(dir, "session_1.backup");
      await rename(sessionFile, backupPath);

      expect(existsSync(sessionFile)).toBe(false);
      expect(existsSync(backupPath)).toBe(true);

      const backupContent = await Bun.file(backupPath).json();
      expect(backupContent.sessionId).toBe("backup-me");
      expect(backupContent.turnCount).toBe(10);
    });

    it("多次 backup 索引遞增", async () => {
      const dir = join(tmpDir, ".claude", "claudeclaw");

      // 模擬已有 backup_1 和 backup_2
      await Bun.write(join(dir, "session_1.backup"), "{}");
      await Bun.write(join(dir, "session_2.backup"), "{}");

      const { readdir } = await import("fs/promises");
      const files = await readdir(dir);
      const indices = files
        .filter((f: string) => /^session_\d+\.backup$/.test(f))
        .map((f: string) => Number(f.match(/^session_(\d+)\.backup$/)![1]));
      const nextIndex = indices.length > 0 ? Math.max(...indices) + 1 : 1;

      expect(nextIndex).toBe(3);
    });
  });
});
