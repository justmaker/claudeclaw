/**
 * Settings file watcher — monitors ~/.claude/claudeclaw/settings.json
 * for changes and triggers hot-reload with debounce.
 */
import { watch, type FSWatcher } from "fs";
import { join } from "path";
import { reloadSettings, type Settings } from "./config";

const HEARTBEAT_DIR = join(process.cwd(), ".claude", "claudeclaw");
const SETTINGS_FILE = join(HEARTBEAT_DIR, "settings.json");
const DEBOUNCE_MS = 500;

export type SettingsChangeCallback = (newSettings: Settings, oldSettings: Settings) => void;

const listeners: SettingsChangeCallback[] = [];
let watcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let previousSettings: Settings | null = null;

/**
 * Register a callback to be invoked when settings change.
 * Returns an unsubscribe function.
 */
export function onSettingsChange(cb: SettingsChangeCallback): () => void {
  listeners.push(cb);
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/** Notify all registered listeners. */
function notifyListeners(newSettings: Settings, oldSettings: Settings): void {
  for (const cb of listeners) {
    try {
      cb(newSettings, oldSettings);
    } catch (err) {
      console.error("[settings-watcher] Listener error:", err);
    }
  }
}

/** Handle a detected file change (with debounce). */
function handleFileChange(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    debounceTimer = null;
    try {
      const oldSettings = previousSettings;
      const newSettings = await reloadSettings();
      if (!oldSettings) {
        previousSettings = newSettings;
        return;
      }
      // Quick equality check — compare serialized form
      const changed = JSON.stringify(newSettings) !== JSON.stringify(oldSettings);
      if (changed) {
        const ts = new Date().toISOString().slice(11, 19);
        console.log(`[${ts}] [settings-watcher] Settings changed, notifying ${listeners.length} listener(s)`);
        previousSettings = newSettings;
        notifyListeners(newSettings, oldSettings);
      }
    } catch (err) {
      console.error("[settings-watcher] Reload error:", err);
    }
  }, DEBOUNCE_MS);
}

/**
 * Start watching settings.json for changes.
 * Call once at daemon startup after loadSettings().
 */
export function startSettingsWatcher(initialSettings: Settings): void {
  if (watcher) return; // already watching
  previousSettings = initialSettings;

  try {
    watcher = watch(SETTINGS_FILE, (_eventType) => {
      handleFileChange();
    });
    watcher.on("error", (err) => {
      console.error("[settings-watcher] Watch error:", err);
    });
    console.log("[settings-watcher] Watching", SETTINGS_FILE);
  } catch (err) {
    console.error("[settings-watcher] Failed to start:", err);
  }
}

/**
 * Stop watching. Safe to call multiple times.
 */
export function stopSettingsWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  previousSettings = null;
}

/** Get current listener count (for testing). */
export function getListenerCount(): number {
  return listeners.length;
}

/** Clear all listeners (for testing). */
export function clearListeners(): void {
  listeners.length = 0;
}

// Re-export for convenience
export { SETTINGS_FILE as WATCHED_FILE, DEBOUNCE_MS };
