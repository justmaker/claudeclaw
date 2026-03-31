/**
 * OAuth Provider for Claude CLI credentials.
 *
 * Reads OAuth tokens from ~/.claude/.credentials.json (written by Claude CLI)
 * and provides them for API authentication, with automatic refresh support.
 */

import { homedir } from "os";
import { join } from "path";
import { spawn } from "child_process";

export interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO 8601
}

interface CachedToken {
  accessToken: string;
  fetchedAt: number;
}

const DEFAULT_CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const CACHE_TTL_MS = 30_000; // 30 seconds
const EXPIRY_BUFFER_MS = 5 * 60_000; // refresh if < 5 min remaining

let cache: CachedToken | null = null;

/**
 * Read credentials from the given path.
 */
export async function readCredentials(
  credentialsPath: string = DEFAULT_CREDENTIALS_PATH
): Promise<OAuthCredentials> {
  const file = Bun.file(credentialsPath);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`OAuth credentials file not found: ${credentialsPath}`);
  }
  const raw = await file.json();

  if (!raw.accessToken || !raw.refreshToken || !raw.expiresAt) {
    throw new Error(
      `Invalid credentials file: missing required fields (accessToken, refreshToken, expiresAt)`
    );
  }

  return {
    accessToken: raw.accessToken,
    refreshToken: raw.refreshToken,
    expiresAt: raw.expiresAt,
  };
}

/**
 * Check if a token is expired or about to expire.
 */
export function isTokenExpired(expiresAt: string): boolean {
  const expiryTime = new Date(expiresAt).getTime();
  return Date.now() + EXPIRY_BUFFER_MS >= expiryTime;
}

/**
 * Trigger a token refresh by spawning `claude` CLI.
 * The CLI internally refreshes the token and writes back to .credentials.json.
 * Returns true if the process exited successfully.
 */
async function refreshViaCli(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["-p", "hi", "--model", "haiku"], {
      stdio: "ignore",
      timeout: 30_000,
    });

    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

/**
 * Invalidate the cached token (useful for testing).
 */
export function clearCache(): void {
  cache = null;
}

/**
 * Get a valid OAuth access token.
 *
 * - Returns cached token if within TTL
 * - Reads credentials from disk
 * - If token is expired/expiring, triggers CLI refresh then re-reads
 *
 * @param credentialsPath - Override path to credentials file
 * @returns Access token string, or null if unavailable
 */
export async function getOAuthToken(
  credentialsPath: string = DEFAULT_CREDENTIALS_PATH
): Promise<string | null> {
  // Return cached if fresh
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.accessToken;
  }

  try {
    let creds = await readCredentials(credentialsPath);

    if (isTokenExpired(creds.expiresAt)) {
      console.log(
        `[oauth] Token expired/expiring (expiresAt: ${creds.expiresAt}), triggering refresh...`
      );
      const ok = await refreshViaCli();
      if (ok) {
        // Re-read refreshed credentials
        creds = await readCredentials(credentialsPath);
        if (isTokenExpired(creds.expiresAt)) {
          console.warn("[oauth] Token still expired after refresh attempt");
          return null;
        }
      } else {
        console.warn("[oauth] CLI refresh failed");
        return null;
      }
    }

    cache = {
      accessToken: creds.accessToken,
      fetchedAt: Date.now(),
    };

    return creds.accessToken;
  } catch (err) {
    console.error("[oauth] Failed to get OAuth token:", err);
    return null;
  }
}
