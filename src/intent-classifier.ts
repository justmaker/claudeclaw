/**
 * Fast regex-based intent classifier for thread hire/fire commands.
 * Falls back to AI (classifyThreadIntent via Claude CLI) only when regex fails.
 */

import { execSync } from "node:child_process";
import { homedir } from "node:os";

export interface ThreadIntent {
  action: "hire" | "fire";
  names: string[];
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
    const result = execSync(
      `claude --model claude-sonnet-4-20250514 --print --output-format text`,
      {
        input,
        encoding: "utf-8",
        timeout: timeoutMs,
        env: { ...process.env, HOME: homedir() },
      },
    ).trim();

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
 * Main entry point: regex first, AI fallback second.
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
