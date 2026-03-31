import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readCredentials, isTokenExpired, getOAuthToken, clearCache } from "../src/oauth-provider";
import { join } from "path";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";

describe("oauth-provider", () => {
  let tempDir: string;

  beforeEach(async () => {
    clearCache();
    tempDir = await mkdtemp(join(tmpdir(), "claudeclaw-oauth-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("readCredentials", () => {
    test("reads valid credentials file", async () => {
      const credPath = join(tempDir, ".credentials.json");
      await writeFile(
        credPath,
        JSON.stringify({
          accessToken: "test-access-token",
          refreshToken: "test-refresh-token",
          expiresAt: "2099-12-31T23:59:59Z",
        })
      );

      const creds = await readCredentials(credPath);
      expect(creds.accessToken).toBe("test-access-token");
      expect(creds.refreshToken).toBe("test-refresh-token");
      expect(creds.expiresAt).toBe("2099-12-31T23:59:59Z");
    });

    test("throws on missing file", async () => {
      const credPath = join(tempDir, "nonexistent.json");
      expect(readCredentials(credPath)).rejects.toThrow("not found");
    });

    test("throws on missing fields", async () => {
      const credPath = join(tempDir, ".credentials.json");
      await writeFile(credPath, JSON.stringify({ accessToken: "only-this" }));
      expect(readCredentials(credPath)).rejects.toThrow("missing required fields");
    });
  });

  describe("isTokenExpired", () => {
    test("returns false for far-future expiry", () => {
      expect(isTokenExpired("2099-12-31T23:59:59Z")).toBe(false);
    });

    test("returns true for past expiry", () => {
      expect(isTokenExpired("2020-01-01T00:00:00Z")).toBe(true);
    });

    test("returns true for expiry within 5 minutes", () => {
      const soon = new Date(Date.now() + 2 * 60_000).toISOString();
      expect(isTokenExpired(soon)).toBe(true);
    });

    test("returns false for expiry beyond 5 minutes", () => {
      const later = new Date(Date.now() + 10 * 60_000).toISOString();
      expect(isTokenExpired(later)).toBe(false);
    });
  });

  describe("getOAuthToken", () => {
    test("returns token from valid non-expired credentials", async () => {
      const credPath = join(tempDir, ".credentials.json");
      await writeFile(
        credPath,
        JSON.stringify({
          accessToken: "valid-token-123",
          refreshToken: "refresh-456",
          expiresAt: "2099-12-31T23:59:59Z",
        })
      );

      const token = await getOAuthToken(credPath);
      expect(token).toBe("valid-token-123");
    });

    test("returns cached token within TTL", async () => {
      const credPath = join(tempDir, ".credentials.json");
      await writeFile(
        credPath,
        JSON.stringify({
          accessToken: "cached-token",
          refreshToken: "refresh",
          expiresAt: "2099-12-31T23:59:59Z",
        })
      );

      const token1 = await getOAuthToken(credPath);
      await writeFile(
        credPath,
        JSON.stringify({
          accessToken: "new-token",
          refreshToken: "refresh",
          expiresAt: "2099-12-31T23:59:59Z",
        })
      );
      const token2 = await getOAuthToken(credPath);
      expect(token1).toBe("cached-token");
      expect(token2).toBe("cached-token");
    });

    test("returns null for missing file", async () => {
      const token = await getOAuthToken(join(tempDir, "nope.json"));
      expect(token).toBeNull();
    });
  });
});
