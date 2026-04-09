/**
 * Fast regex-based intent classifier for thread hire/fire commands.
 * Falls back to AI (classifyThreadIntent via Claude CLI) only when regex fails.
 */

import { exec } from "node:child_process";
import { homedir } from "node:os";

/**
 * Async exec with stdin input. Non-blocking alternative to execSync.
 */
function execAsync(cmd: string, input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = exec(cmd, {
      encoding: "utf-8",
      timeout: timeoutMs,
      env: { ...process.env, HOME: homedir() },
      killSignal: "SIGTERM",
    }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
    child.stdin?.write(input);
    child.stdin?.end();
  });
}

export interface ThreadIntent {
  action: "hire" | "fire";
  names: string[];
}

export interface HireTask {
  threadName: string;
  task: string;
}

// --- Special group expansions ---
const GROUP_EXPANSIONS: Record<string, string[]> = {
  桃園三結義: ["劉備", "關羽", "張飛"],
  五虎將: ["關羽", "張飛", "趙雲", "馬超", "黃忠"],
  五虎上將: ["關羽", "張飛", "趙雲", "馬超", "黃忠"],
};

// --- Regex patterns ---
// Hire patterns: hire, 派出, 派, 叫...出來, 開, 建立, 出征, 上陣, 迎戰, 出戰, 召喚
const HIRE_PATTERNS: RegExp[] = [
  /^hire\s+(.+)/i,
  /^(?:派出|派)\s*(.+)/,
  /^叫\s*(.+?)\s*出來/,
  /^開\s+(.+)/,
  /^建立\s+(.+)/,
  /^(?:出征|上陣|迎戰|出戰|召喚)\s*(.+)/,
];

// Fire patterns: fire, 撤回, 撤, 把...叫回來, 關, 刪, 收回, 滾
const FIRE_PATTERNS: RegExp[] = [
  /^fire\s+(.+)/i,
  /^(?:撤回|撤)\s*(.+)/,
  /^把\s*(.+?)\s*叫回來/,
  /^關\s+(.+)/,
  /^刪\s*(.+)/,
  /^收回\s*(.+)/,
  /^(.+?)\s*滾$/,
];

/**
 * Parse a name list string into individual names.
 * Supports: "A, B, C", "A 和 B", "A、B、C", "A and B", "A B C"
 */
function parseNames(raw: string): string[] {
  // Expand group names first
  let expanded = raw.trim();
  const names: string[] = [];

  for (const [group, members] of Object.entries(GROUP_EXPANSIONS)) {
    if (expanded.includes(group)) {
      names.push(...members);
      expanded = expanded.replace(group, "").trim();
    }
  }

  if (expanded) {
    // Split by common delimiters
    const parts = expanded
      .split(/[,，、]\s*|\s+(?:and|和|跟|與)\s+|\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    names.push(...parts);
  }

  // Deduplicate while preserving order
  return [...new Set(names)];
}

/**
 * Try regex-based classification first. Returns null if no pattern matched.
 */
export function classifyByRegex(text: string): ThreadIntent | null {
  const trimmed = text.trim();

  for (const pattern of HIRE_PATTERNS) {
    const m = trimmed.match(pattern);
    if (m) {
      const names = parseNames(m[1]);
      if (names.length > 0) return { action: "hire", names };
    }
  }

  for (const pattern of FIRE_PATTERNS) {
    const m = trimmed.match(pattern);
    if (m) {
      const names = parseNames(m[1]);
      if (names.length > 0) return { action: "fire", names };
    }
  }

  return null;
}

/**
 * AI fallback classifier (existing logic, with configurable timeout).
 */
export async function classifyByAI(
  text: string,
  timeoutMs = 5000,
): Promise<ThreadIntent | null> {
  const systemPrompt = `You classify user messages into thread management intents.

If the user wants to CREATE/SPAWN/DEPLOY threads (e.g. "hire X", "派出 X", "叫 X 出來", "派 X 去打", "開 X", "建立 X"):
Return: {"action":"hire","names":["name1","name2"]}

If the user wants to DELETE/REMOVE threads (e.g. "fire X", "撤回 X", "把 X 叫回來", "刪 X", "關 X"):
Return: {"action":"fire","names":["name1","name2"]}

If the message is NOT about thread management, return: null

Rules:
- Extract individual names. "桃園三結義" = ["劉備","關羽","張飛"]. "五虎將" = ["關羽","張飛","趙雲","馬超","黃忠"].
- Common patterns: 派/派出/出征/上陣/迎戰/出戰 = hire. 撤/撤回/收回/叫回來/滾 = fire.
- Return ONLY valid JSON or the word null. No explanation.`;

  try {
    const input = `${systemPrompt}\n\n---\nUser message: ${text}`;
    const result = (await execAsync(
      `claude --model claude-sonnet-4-20250514 --print --output-format text`,
      input,
      timeoutMs,
    )).trim();

    if (!result || result === "null") return null;
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as ThreadIntent;
  } catch (err) {
    console.error(
      `[IntentClassifier] AI fallback error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Detect if a message is a hire command. Returns the raw text after the hire keyword, or null.
 */
export function detectHire(text: string): string | null {
  const trimmed = text.trim();
  for (const pattern of HIRE_PATTERNS) {
    const m = trimmed.match(pattern);
    if (m && m[1]?.trim()) return m[1].trim();
  }
  return null;
}

/**
 * Fast regex-based hire parser. Handles known groups and simple name lists
 * without calling the AI. Returns null if the input needs AI parsing.
 */
export function classifyHireFast(rawText: string): HireTask[] | null {
  const trimmed = rawText.trim();

  // Check for group expansions first
  for (const [group, members] of Object.entries(GROUP_EXPANSIONS)) {
    if (trimmed.includes(group)) {
      const remaining = trimmed.replace(group, "").trim();
      const tasks = members.map((name) => ({ threadName: name, task: remaining || name }));
      // If there's remaining text after group, it's a shared task
      if (remaining) {
        return tasks.map((t) => ({ ...t, task: remaining }));
      }
      return tasks;
    }
  }

  // Simple name list: "A、B、C" or "A, B, C" — no spaces, no URLs, no long text
  // Only use this if input looks like a pure name list (short, delimiter-separated)
  if (trimmed.length < 50 && !trimmed.includes("http") && /[,，、]/.test(trimmed)) {
    const names = trimmed
      .split(/[,，、]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length > 1 && names.every((n) => n.length < 20)) {
      return names.map((name) => ({ threadName: name, task: name }));
    }
  }

  // "sb" / "someone" + task description — single hire
  const sbMatch = trimmed.match(/^(?:sb|someone|一個人|somebody)\s+(.+)/is);
  if (sbMatch) {
    const task = sbMatch[1].trim();
    // Generate a short thread name from the task (first meaningful phrase)
    const threadName = task
      .replace(/https?:\/\/\S+/g, "")
      .trim()
      .slice(0, 30)
      .trim() || "新任務";
    return [{ threadName, task }];
  }

  // Needs AI parsing (complex input)
  return null;
}

/**
 * AI-powered hire intent parser. Understands the full message and returns
 * structured thread name(s) + task description(s).
 */
export async function classifyHireByAI(
  rawText: string,
  timeoutMs = 20000,
): Promise<HireTask[]> {
  const systemPrompt = `You parse "hire" commands into structured thread tasks.

The user wants to spawn one or more AI agent threads. Parse their message and return a JSON array of tasks.

Rules:
- Each task has: threadName (short, 2-6 words, suitable for a Discord thread title) and task (full task description for the AI agent)
- "hire sb" / "hire someone" / "hire 一個人" = generic hire, one thread. The text after is the task.
- "hire 架構師 做 X" = role-based hire, threadName should include the role
- "hire A, B, C" with NO task description = multiple threads with just names (task = threadName)
- Group expansions: "桃園三結義" = 劉備+關羽+張飛, "五虎將" = 關羽+張飛+趙雲+馬超+黃忠
- If there's a URL in the message, include it in the task field
- threadName should be in the same language as the user's message (Chinese if Chinese)
- Return ONLY a valid JSON array. No explanation.

Examples:
- "sb 我要持續進化 https://example.com/repo" → [{"threadName":"持續進化","task":"我要持續進化 https://example.com/repo"}]
- "架構師 研究 microservice 拆分" → [{"threadName":"架構師 - microservice 拆分","task":"研究 microservice 拆分"}]
- "劉備、關羽" → [{"threadName":"劉備","task":"劉備"},{"threadName":"關羽","task":"關羽"}]
- "sb 幫我看一下這個 bug" → [{"threadName":"Bug 調查","task":"幫我看一下這個 bug"}]`;

  try {
    const input = `${systemPrompt}\n\n---\nUser message after hire keyword: ${rawText}`;
    const result = (await execAsync(
      `claude --model claude-sonnet-4-20250514 --print --output-format text`,
      input,
      timeoutMs,
    )).trim();

    if (!result) return [];
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as HireTask[];
    return Array.isArray(parsed) ? parsed.filter(t => t.threadName && t.task) : [];
  } catch (err) {
    console.error(
      `[IntentClassifier] classifyHireByAI error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

/**
 * Main entry point: regex first, AI fallback second.
 * NOTE: For hire, use detectHire() + classifyHireByAI() instead.
 * This function is now primarily used for fire detection.
 */
export async function classifyIntent(
  text: string,
): Promise<ThreadIntent | null> {
  const regexResult = classifyByRegex(text);
  if (regexResult) {
    console.log(
      `[IntentClassifier] Regex match: ${regexResult.action} [${regexResult.names.join(", ")}]`,
    );
    return regexResult;
  }

  // Fallback to AI with 5s timeout
  console.log(`[IntentClassifier] No regex match, falling back to AI...`);
  return classifyByAI(text, 5000);
}
