import { join, isAbsolute } from "path";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import { normalizeTimezoneName, resolveTimezoneOffsetMinutes } from "./timezone";
import { type TokenPoolEntry, type TokenStrategy, parseTokenPoolConfig, type TokenPoolConfig } from "./token-pool";
import type { CronJob } from "./cron-scheduler";
import type { ProvidersConfig } from "./providers/types";

const HEARTBEAT_DIR = join(process.cwd(), ".claude", "claudeclaw");
const SETTINGS_FILE = join(HEARTBEAT_DIR, "settings.json");
const JOBS_DIR = join(HEARTBEAT_DIR, "jobs");
const LOGS_DIR = join(HEARTBEAT_DIR, "logs");

const DEFAULT_SETTINGS: Settings = {
  model: "",
  api: "",
  auth: {
    mode: "api-key",
    oauthCredentialsPath: "~/.claude/.credentials.json",
  },
  fallback: {
    model: "",
    api: "",
  },
  tokenPool: [],
  tokenStrategy: "fallback-chain" as TokenStrategy,
  agentic: {
    enabled: false,
    defaultMode: "implementation",
    modes: [
      {
        name: "planning",
        model: "opus",
        keywords: [
          "plan", "design", "architect", "strategy", "approach",
          "research", "investigate", "analyze", "explore", "understand",
          "think", "consider", "evaluate", "assess", "review",
          "system design", "trade-off", "decision", "choose", "compare",
          "brainstorm", "ideate", "concept", "proposal",
        ],
        phrases: [
          "how to implement", "how should i", "what's the best way to",
          "should i", "which approach", "help me decide", "help me understand",
        ],
      },
      {
        name: "implementation",
        model: "sonnet",
        keywords: [
          "implement", "code", "write", "create", "build", "add",
          "fix", "debug", "refactor", "update", "modify", "change",
          "deploy", "run", "execute", "install", "configure",
          "test", "commit", "push", "merge", "release",
          "generate", "scaffold", "setup", "initialize",
        ],
      },
    ],
  },
  timezone: "UTC",
  timezoneOffsetMinutes: 0,
  heartbeat: {
    enabled: false,
    interval: 15,
    prompt: "",
    excludeWindows: [],
    forwardToTelegram: true,
  },
  telegram: { token: "", allowedUserIds: [] },
  discord: { token: "", allowedUserIds: [], listenChannels: [] },
  signal: { enabled: false, phone: "", apiUrl: "http://localhost:8080", allowedNumbers: [] },
  security: { level: "moderate", allowedTools: [], disallowedTools: [] },
  cron: [],
  web: { enabled: false, host: "127.0.0.1", port: 4632 },
  stt: { baseUrl: "", model: "", localModel: "large-v3", language: "", initialPrompt: "" },
  workspace: { path: "" },
  providers: {},
  maxConcurrent: 3,
  streaming: {
    enabled: false,
    updateIntervalMs: 2000,
    minChunkChars: 50,
  },
};

export interface HeartbeatExcludeWindow {
  days?: number[];
  start: string;
  end: string;
}

export interface HeartbeatConfig {
  enabled: boolean;
  interval: number;
  prompt: string;
  excludeWindows: HeartbeatExcludeWindow[];
  forwardToTelegram: boolean;
}

export interface TelegramConfig {
  token: string;
  allowedUserIds: number[];
}

export interface DiscordConfig {
  token: string;
  allowedUserIds: string[]; // Discord snowflake IDs exceed Number.MAX_SAFE_INTEGER
  listenChannels: string[]; // Channel IDs where bot responds to all messages (no mention needed)
}

export interface SignalConfig {
  enabled: boolean;
  phone: string;
  apiUrl: string;
  allowedNumbers: string[];
}

export type SecurityLevel =
  | "locked"
  | "strict"
  | "moderate"
  | "unrestricted";

export interface SecurityConfig {
  level: SecurityLevel;
  allowedTools: string[];
  disallowedTools: string[];
}

export type AuthMode = "api-key" | "oauth" | "auto";

export interface AuthConfig {
  mode: AuthMode;
  oauthCredentialsPath: string;
}

export interface Settings {
  model: string;
  api: string;
  auth: AuthConfig;
  fallback: ModelConfig;
  tokenPool: TokenPoolEntry[];
  tokenStrategy: TokenStrategy;
  agentic: AgenticConfig;
  timezone: string;
  timezoneOffsetMinutes: number;
  heartbeat: HeartbeatConfig;
  cron: CronJob[];
  telegram: TelegramConfig;
  discord: DiscordConfig;
  signal: SignalConfig;
  security: SecurityConfig;
  web: WebConfig;
  stt: SttConfig;
  workspace: WorkspaceConfig;
  providers: ProvidersConfig;
  maxConcurrent: number;
  streaming: StreamingConfig;
}

export type { TokenPoolEntry, TokenStrategy, TokenPoolConfig };
export type { ProvidersConfig } from "./providers/types";

export interface AgenticMode {
  name: string;
  model: string;
  keywords: string[];
  phrases?: string[];
}

export interface AgenticConfig {
  enabled: boolean;
  defaultMode: string;
  modes: AgenticMode[];
}

export interface ModelConfig {
  model: string;
  api: string;
}

export interface WebConfig {
  enabled: boolean;
  host: string;
  port: number;
}

export interface StreamingConfig {
  /** 是否啟用 streaming mode，預設 false（向後相容） */
  enabled: boolean;
  /** 訊息更新間隔（毫秒），預設 2000 */
  updateIntervalMs: number;
  /** 最小累積字元數才觸發中繼更新，預設 50 */
  minChunkChars: number;
}

export interface WorkspaceConfig {
  /** Path to a workspace directory containing shared prompt files and skills.
   *  Follows the same convention as OpenClaw workspaces:
   *  - AGENTS.md, SOUL.md, TOOLS.md, KNOWLEDGE.md at the root
   *  - skills/ directory with SKILL.md files
   *  When empty, workspace loading is disabled. */
  path: string;
}

export interface SttConfig {
  /** Base URL of an OpenAI-compatible STT API, e.g. "http://127.0.0.1:8000".
   *  When set, claudeclaw routes voice transcription through this API instead
   *  of the bundled whisper.cpp binary. */
  baseUrl: string;
  /** Model name passed to the API (default: "Systran/faster-whisper-large-v3") */
  model: string;
  /** Local whisper.cpp model name (default: "large-v3"). Used when baseUrl is empty. */
  localModel: string;
  /** Language code for transcription, e.g. "zh", "en", "ja". Passed to both API and local modes. */
  language: string;
  /** Initial prompt / context hint for better transcription accuracy. */
  initialPrompt: string;
}

// Re-export settings watcher for convenient access
export { onSettingsChange, startSettingsWatcher, stopSettingsWatcher } from "./settings-watcher";

let cached: Settings | null = null;

export async function initConfig(): Promise<void> {
  await mkdir(HEARTBEAT_DIR, { recursive: true });
  await mkdir(JOBS_DIR, { recursive: true });
  await mkdir(LOGS_DIR, { recursive: true });

  if (!existsSync(SETTINGS_FILE)) {
    await Bun.write(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2) + "\n");
  }
}

const VALID_LEVELS = new Set<SecurityLevel>([
  "locked",
  "strict",
  "moderate",
  "unrestricted",
]);

function parseAgenticMode(raw: any): AgenticMode | null {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  if (!name || !model) return null;
  const keywords = Array.isArray(raw.keywords)
    ? raw.keywords.filter((k: unknown) => typeof k === "string").map((k: string) => k.toLowerCase().trim())
    : [];
  const phrases = Array.isArray(raw.phrases)
    ? raw.phrases.filter((p: unknown) => typeof p === "string").map((p: string) => p.toLowerCase().trim())
    : undefined;
  return { name, model, keywords, ...(phrases && phrases.length > 0 ? { phrases } : {}) };
}

function parseAgenticConfig(raw: any): AgenticConfig {
  const defaults = DEFAULT_SETTINGS.agentic;
  if (!raw || typeof raw !== "object") return defaults;

  const enabled = raw.enabled ?? false;

  // Backward compat: old planningModel/implementationModel format
  if (!Array.isArray(raw.modes) && ("planningModel" in raw || "implementationModel" in raw)) {
    const planningModel = typeof raw.planningModel === "string" ? raw.planningModel.trim() : "opus";
    const implModel = typeof raw.implementationModel === "string" ? raw.implementationModel.trim() : "sonnet";
    return {
      enabled,
      defaultMode: "implementation",
      modes: [
        { ...defaults.modes[0], model: planningModel },
        { ...defaults.modes[1], model: implModel },
      ],
    };
  }

  // New modes format
  const modes: AgenticMode[] = [];
  if (Array.isArray(raw.modes)) {
    for (const m of raw.modes) {
      const parsed = parseAgenticMode(m);
      if (parsed) modes.push(parsed);
    }
  }

  return {
    enabled,
    defaultMode: typeof raw.defaultMode === "string" ? raw.defaultMode.trim() : "implementation",
    modes: modes.length > 0 ? modes : defaults.modes,
  };
}

function parseCronJobs(raw: unknown): CronJob[] {
  if (!Array.isArray(raw)) return [];
  const jobs: CronJob[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const cron = typeof entry.cron === "string" ? entry.cron.trim() : "";
    if (!name || !cron) continue;
    const prompt = typeof entry.prompt === "string" ? entry.prompt.trim() : "";
    const model = typeof entry.model === "string" ? entry.model.trim() : undefined;
    const target = (["telegram", "discord", "both"] as const).includes(entry.target)
      ? entry.target as "telegram" | "discord" | "both"
      : undefined;
    const enabled = entry.enabled !== false;
    jobs.push({ name, cron, prompt, model, target, enabled });
  }
  return jobs;
}

function parseProvidersConfig(raw: any): ProvidersConfig {
  if (!raw || typeof raw !== "object") return {};
  const result: ProvidersConfig = {};
  const str = (v: any) => typeof v === "string" ? v.trim() : "";
  if (raw.openai?.apiKey) result.openai = { apiKey: str(raw.openai.apiKey), ...(raw.openai.baseUrl ? { baseUrl: str(raw.openai.baseUrl) } : {}) };
  if (raw.anthropic?.apiKey) result.anthropic = { apiKey: str(raw.anthropic.apiKey), ...(raw.anthropic.baseUrl ? { baseUrl: str(raw.anthropic.baseUrl) } : {}) };
  if (raw.google?.apiKey) result.google = { apiKey: str(raw.google.apiKey), ...(raw.google.baseUrl ? { baseUrl: str(raw.google.baseUrl) } : {}) };
  if (raw.bedrock?.accessKeyId) result.bedrock = { region: str(raw.bedrock.region) || "us-east-1", accessKeyId: str(raw.bedrock.accessKeyId), secretAccessKey: str(raw.bedrock.secretAccessKey) };
  if (raw.ollama) result.ollama = { ...(raw.ollama.baseUrl ? { baseUrl: str(raw.ollama.baseUrl) } : {}) };
  if (raw["workers-ai"]?.apiToken) result["workers-ai"] = { accountId: str(raw["workers-ai"].accountId), apiToken: str(raw["workers-ai"].apiToken) };
  if (raw.groq?.apiKey) result.groq = { apiKey: str(raw.groq.apiKey), ...(raw.groq.baseUrl ? { baseUrl: str(raw.groq.baseUrl) } : {}) };
  if (raw.deepseek?.apiKey) result.deepseek = { apiKey: str(raw.deepseek.apiKey), ...(raw.deepseek.baseUrl ? { baseUrl: str(raw.deepseek.baseUrl) } : {}) };
  if (raw.copilot?.apiKey) result.copilot = { apiKey: str(raw.copilot.apiKey), ...(raw.copilot.baseUrl ? { baseUrl: str(raw.copilot.baseUrl) } : {}) };
  return result;
}

function parseSettings(raw: Record<string, any>, discordUserIdOverrides?: string[]): Settings {
  const rawLevel = raw.security?.level;
  const level: SecurityLevel =
    typeof rawLevel === "string" && VALID_LEVELS.has(rawLevel as SecurityLevel)
      ? (rawLevel as SecurityLevel)
      : "moderate";

  const parsedTimezone = parseTimezone(raw.timezone);

  return {
    model: typeof raw.model === "string" ? raw.model.trim() : "",
    api: typeof raw.api === "string" ? raw.api.trim() : "",
    auth: {
      mode: (["api-key", "oauth", "auto"] as const).includes(raw.auth?.mode)
        ? raw.auth.mode
        : "api-key",
      oauthCredentialsPath:
        typeof raw.auth?.oauthCredentialsPath === "string" && raw.auth.oauthCredentialsPath.trim()
          ? raw.auth.oauthCredentialsPath.trim()
          : "~/.claude/.credentials.json",
    },
    fallback: {
      model: typeof raw.fallback?.model === "string" ? raw.fallback.model.trim() : "",
      api: typeof raw.fallback?.api === "string" ? raw.fallback.api.trim() : "",
    },
    tokenPool: (() => {
      const parsed = parseTokenPoolConfig(raw);
      return parsed ? parsed.pool : [];
    })(),
    tokenStrategy: (() => {
      const parsed = parseTokenPoolConfig(raw);
      return parsed ? parsed.strategy : "fallback-chain" as TokenStrategy;
    })(),
    agentic: parseAgenticConfig(raw.agentic),
    timezone: parsedTimezone,
    timezoneOffsetMinutes: parseTimezoneOffsetMinutes(raw.timezoneOffsetMinutes, parsedTimezone),
    heartbeat: {
      enabled: raw.heartbeat?.enabled ?? false,
      interval: raw.heartbeat?.interval ?? 15,
      prompt: raw.heartbeat?.prompt ?? "",
      excludeWindows: parseExcludeWindows(raw.heartbeat?.excludeWindows),
      forwardToTelegram: raw.heartbeat?.forwardToTelegram ?? false,
    },
    cron: parseCronJobs(raw.cron),
    telegram: {
      token: raw.telegram?.token ?? "",
      allowedUserIds: raw.telegram?.allowedUserIds ?? [],
    },
    discord: {
      token: typeof raw.discord?.token === "string" ? raw.discord.token.trim() : "",
      allowedUserIds: discordUserIdOverrides && discordUserIdOverrides.length > 0
          ? discordUserIdOverrides
          : Array.isArray(raw.discord?.allowedUserIds)
            ? raw.discord.allowedUserIds.map(String)
            : [],
      listenChannels: Array.isArray(raw.discord?.listenChannels)
        ? raw.discord.listenChannels.map(String)
        : [],
    },
    signal: {
      enabled: raw.signal?.enabled ?? false,
      phone: typeof raw.signal?.phone === "string" ? raw.signal.phone.trim() : "",
      apiUrl: typeof raw.signal?.apiUrl === "string" ? raw.signal.apiUrl.trim() : "http://localhost:8080",
      allowedNumbers: Array.isArray(raw.signal?.allowedNumbers)
        ? raw.signal.allowedNumbers.map(String)
        : [],
    },
    security: {
      level,
      allowedTools: Array.isArray(raw.security?.allowedTools)
        ? raw.security.allowedTools
        : [],
      disallowedTools: Array.isArray(raw.security?.disallowedTools)
        ? raw.security.disallowedTools
        : [],
    },
    web: {
      enabled: raw.web?.enabled ?? false,
      host: raw.web?.host ?? "127.0.0.1",
      port: Number.isFinite(raw.web?.port) ? Number(raw.web.port) : 4632,
    },
    stt: {
      baseUrl: typeof raw.stt?.baseUrl === "string" ? raw.stt.baseUrl.trim() : "",
      model: typeof raw.stt?.model === "string" ? raw.stt.model.trim() : "",
      localModel: typeof raw.stt?.localModel === "string" && raw.stt.localModel.trim() ? raw.stt.localModel.trim() : "large-v3",
      language: typeof raw.stt?.language === "string" ? raw.stt.language.trim() : "",
      initialPrompt: typeof raw.stt?.initialPrompt === "string" ? raw.stt.initialPrompt.trim() : "",
    },
    workspace: {
      path: typeof raw.workspace?.path === "string" ? raw.workspace.path.trim() : "",
    },
    providers: parseProvidersConfig(raw.providers),
    maxConcurrent: typeof raw.maxConcurrent === "number" && raw.maxConcurrent >= 1 ? raw.maxConcurrent : 3,
    streaming: {
      enabled: raw.streaming?.enabled === true,
      updateIntervalMs: typeof raw.streaming?.updateIntervalMs === "number" && raw.streaming.updateIntervalMs >= 500
        ? raw.streaming.updateIntervalMs : 2000,
      minChunkChars: typeof raw.streaming?.minChunkChars === "number" && raw.streaming.minChunkChars >= 0
        ? raw.streaming.minChunkChars : 50,
    },
  };
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function parseTimezone(value: unknown): string {
  return normalizeTimezoneName(value);
}

function parseExcludeWindows(value: unknown): HeartbeatExcludeWindow[] {
  if (!Array.isArray(value)) return [];
  const out: HeartbeatExcludeWindow[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const start = typeof (entry as any).start === "string" ? (entry as any).start.trim() : "";
    const end = typeof (entry as any).end === "string" ? (entry as any).end.trim() : "";
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) continue;

    const rawDays = Array.isArray((entry as any).days) ? (entry as any).days : [];
    const parsedDays = rawDays
      .map((d: unknown) => Number(d))
      .filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6);
    const uniqueDays = Array.from(new Set<number>(parsedDays)).sort((a: number, b: number) => a - b);

    out.push({
      start,
      end,
      days: uniqueDays.length > 0 ? uniqueDays : [...ALL_DAYS],
    });
  }
  return out;
}

function parseTimezoneOffsetMinutes(value: unknown, timezoneFallback?: string): number {
  return resolveTimezoneOffsetMinutes(value, timezoneFallback);
}

/**
 * Extract discord.allowedUserIds as raw strings from the JSON text.
 * JSON.parse destroys precision on large numeric snowflakes (>2^53),
 * so we regex them out of the raw text first.
 */
function extractDiscordUserIds(rawText: string): string[] {
  // Match the "discord" object's "allowedUserIds" array values
  const discordBlock = rawText.match(/"discord"\s*:\s*\{[\s\S]*?\}/);
  if (!discordBlock) return [];
  const arrayMatch = discordBlock[0].match(/"allowedUserIds"\s*:\s*\[([\s\S]*?)\]/);
  if (!arrayMatch) return [];
  const items: string[] = [];
  // Match both quoted strings and bare numbers
  for (const m of arrayMatch[1].matchAll(/("(\d+)"|(\d+))/g)) {
    items.push(m[2] ?? m[3]);
  }
  return items;
}

export async function loadSettings(): Promise<Settings> {
  if (cached) return cached;
  const rawText = await Bun.file(SETTINGS_FILE).text();
  const raw = JSON.parse(rawText);
  cached = parseSettings(raw, extractDiscordUserIds(rawText));
  return cached;
}

/** Re-read settings from disk, bypassing cache. */
export async function reloadSettings(): Promise<Settings> {
  const rawText = await Bun.file(SETTINGS_FILE).text();
  const raw = JSON.parse(rawText);
  cached = parseSettings(raw, extractDiscordUserIds(rawText));
  return cached;
}

export function getSettings(): Settings {
  if (!cached) throw new Error("Settings not loaded. Call loadSettings() first.");
  return cached;
}

const PROMPT_EXTENSIONS = [".md", ".txt", ".prompt"];

/**
 * If the prompt string looks like a file path (ends with .md, .txt, or .prompt),
 * read and return the file contents. Otherwise return the string as-is.
 * Relative paths are resolved from the project root (cwd).
 */
export async function resolvePrompt(prompt: string): Promise<string> {
  const trimmed = prompt.trim();
  if (!trimmed) return trimmed;

  const isPath = PROMPT_EXTENSIONS.some((ext) => trimmed.endsWith(ext));
  if (!isPath) return trimmed;

  const resolved = isAbsolute(trimmed) ? trimmed : join(process.cwd(), trimmed);
  try {
    const content = await Bun.file(resolved).text();
    return content.trim();
  } catch {
    console.warn(`[config] Prompt path "${trimmed}" not found, using as literal string`);
    return trimmed;
  }
}

/**
 * Load shared prompt files from a claw-config repository.
 * Always loads: AGENTS.md, SOUL.md
 * Optionally loads: TOOLS.md, KNOWLEDGE.md (if they exist)
 * Returns concatenated content, or empty string if workspace is not configured.
 */
export async function loadClawConfigPrompts(): Promise<string> {
  const settings = getSettings();
  const { path: configPath } = settings.workspace;
  if (!configPath) return "";

  const sharedDir = join(configPath, "shared");
  // Layer 1 (always load) + Layer 3 (load if exists)
  const files = ["AGENTS.md", "SOUL.md", "TOOLS.md", "KNOWLEDGE.md"];
  const parts: string[] = [];

  for (const file of files) {
    const filePath = join(sharedDir, file);
    try {
      const content = await Bun.file(filePath).text();
      if (content.trim()) {
        parts.push(`<!-- claw-config: ${file} -->\n${content.trim()}`);
      }
    } catch {
      // File doesn't exist — skip silently for optional files (TOOLS, KNOWLEDGE)
      if (file === "AGENTS.md" || file === "SOUL.md") {
        console.warn(`[claw-config] Required file not found: ${filePath}`);
      }
    }
  }

  return parts.join("\n\n");
}

/**
 * List available skills from claw-config's skills/ directory.
 * Returns an XML block similar to OpenClaw's <available_skills> format,
 * suitable for appending to the system prompt so Claude can self-select.
 */
export async function loadClawConfigSkills(): Promise<string> {
  const settings = getSettings();
  const { path: configPath } = settings.workspace;
  if (!configPath) return "";

  const skillsDir = join(configPath, "skills");
  const indexPath = join(skillsDir, "INDEX.md");

  // Parse INDEX.md for skill metadata
  try {
    const indexContent = await Bun.file(indexPath).text();
    if (!indexContent.trim()) return "";

    const skills: { name: string; trigger: string; file: string; description: string }[] = [];

    // Parse table rows: | name | trigger | file | description |
    for (const line of indexContent.split("\n")) {
      const match = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
      if (!match) continue;
      const [, name, trigger, file, description] = match;
      if (name.startsWith("---") || name.toLowerCase() === "name") continue;
      skills.push({
        name: name.trim(),
        trigger: trigger.trim(),
        file: file.trim(),
        description: description.trim(),
      });
    }

    if (skills.length === 0) return "";

    // Build OpenClaw-style <available_skills> XML
    const lines = ["<available_skills>"];
    for (const skill of skills) {
      const skillFilePath = join(skillsDir, skill.file);
      lines.push("  <skill>");
      lines.push(`    <name>${skill.name}</name>`);
      lines.push(`    <description>${skill.description}</description>`);
      lines.push(`    <location>${skillFilePath}</location>`);
      lines.push("  </skill>");
    }
    lines.push("</available_skills>");

    return [
      "## Available Skills (from claw-config)",
      "Before replying: scan <available_skills> descriptions.",
      "- If a skill clearly applies: read its file, then follow it.",
      "- If none apply: proceed without reading any skill file.",
      "",
      lines.join("\n"),
    ].join("\n");
  } catch {
    // INDEX.md doesn't exist or not readable
    return "";
  }
}

/**
 * Load workspace prompt files following the OpenClaw workspace convention.
 * Always loads: AGENTS.md, SOUL.md
 * Optionally loads: TOOLS.md, KNOWLEDGE.md, IDENTITY.md, USER.md (if they exist)
 * Returns concatenated content, or empty string if workspace is not configured.
 */
export async function loadWorkspacePrompts(): Promise<string> {
  const settings = getSettings();
  const { path: wsPath } = settings.workspace;
  if (!wsPath) return "";

  // OpenClaw convention: files live at the workspace root
  const files = ["AGENTS.md", "SOUL.md", "TOOLS.md", "KNOWLEDGE.md", "IDENTITY.md", "USER.md"];
  const parts: string[] = [];

  for (const file of files) {
    const filePath = join(wsPath, file);
    try {
      const content = await Bun.file(filePath).text();
      if (content.trim()) {
        parts.push(`<!-- workspace: ${file} -->\n${content.trim()}`);
      }
    } catch {
      // File doesn't exist — skip silently
    }
  }

  if (parts.length > 0) {
    console.log(`[workspace] Loaded ${parts.length} prompt file(s) from ${wsPath}`);
  }

  return parts.join("\n\n");
}

/**
 * Scan workspace skills/ directory following the OpenClaw convention.
 * Looks for skills/{name}/SKILL.md (directory-based) and skills/*.md (single-file).
 * Returns an XML block in OpenClaw's <available_skills> format.
 */
export async function loadWorkspaceSkills(): Promise<string> {
  const settings = getSettings();
  const { path: wsPath } = settings.workspace;
  if (!wsPath) return "";

  const skillsDir = join(wsPath, "skills");
  const skills: { name: string; description: string; location: string }[] = [];

  try {
    const { readdir: rd } = await import("node:fs/promises");
    const entries = await rd(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // OpenClaw convention: skills/{name}/SKILL.md
        const skillPath = join(skillsDir, entry.name, "SKILL.md");
        try {
          const content = await Bun.file(skillPath).text();
          if (content.trim()) {
            skills.push({
              name: entry.name,
              description: extractSkillDescription(content),
              location: skillPath,
            });
          }
        } catch { /* skip */ }
      } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "INDEX.md") {
        // Single-file skill: skills/xxx.md
        const skillPath = join(skillsDir, entry.name);
        try {
          const content = await Bun.file(skillPath).text();
          if (content.trim()) {
            skills.push({
              name: entry.name.replace(/\.md$/, ""),
              description: extractSkillDescription(content),
              location: skillPath,
            });
          }
        } catch { /* skip */ }
      }
    }
  } catch {
    // skills/ directory doesn't exist
    return "";
  }

  if (skills.length === 0) return "";

  console.log(`[workspace] Found ${skills.length} skill(s) in ${skillsDir}`);

  const lines = ["<available_skills>"];
  for (const skill of skills) {
    lines.push("  <skill>");
    lines.push(`    <name>${skill.name}</name>`);
    lines.push(`    <description>${skill.description}</description>`);
    lines.push(`    <location>${skill.location}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");

  return [
    "## Available Skills",
    "Before replying: scan <available_skills> descriptions.",
    "- If a skill clearly applies: read its file, then follow it.",
    "- If none apply: proceed without reading any skill file.",
    "",
    lines.join("\n"),
  ].join("\n");
}

function extractSkillDescription(content: string): string {
  // Try first non-heading, non-empty line
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---") || trimmed.startsWith(">")) continue;
    return trimmed.slice(0, 256);
  }
  return "Skill";
}
