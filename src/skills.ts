import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

async function isDirOrSymlinkToDir(dir: string, entry: any): Promise<boolean> {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink?.()) {
    try { return (await stat(join(dir, entry.name))).isDirectory(); } catch { return false; }
  }
  return false;
}

export interface SkillMetadata {
  name: string;
  description: string;
  keywords: string[];
  examples: string[];
  priority: number; // lower = higher priority, default 100
}

export interface SkillInfo {
  name: string;
  description: string;
}

export interface SkillMatch {
  skill: SkillMetadata;
  score: number;
  matchedOn: "command" | "keyword" | "description";
}

// Parse YAML frontmatter from SKILL.md content
export function parseSkillMetadata(name: string, content: string): SkillMetadata {
  const meta: SkillMetadata = {
    name,
    description: "",
    keywords: [],
    examples: [],
    priority: 100,
  };

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];

    // name override
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    if (nameMatch) meta.name = nameMatch[1].trim().replace(/^["']|["']$/g, "");

    // description
    const descMulti = fm.match(/^description:\s*>?\s*\n?([\s\S]*?)(?=\n\w|\n---|\n$)/m);
    if (descMulti) {
      const raw = descMulti[1].replace(/\n\s*/g, " ").trim();
      if (raw) meta.description = raw.slice(0, 256);
    }
    if (!meta.description) {
      const descSingle = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);
      if (descSingle) meta.description = descSingle[1].trim().slice(0, 256);
    }

    // keywords (YAML list)
    const kwMatch = fm.match(/^keywords:\s*\n((?:\s*-\s*.+\n?)*)/m);
    if (kwMatch) {
      meta.keywords = kwMatch[1]
        .split("\n")
        .map((l) => l.replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      // inline: keywords: [a, b, c]
      const kwInline = fm.match(/^keywords:\s*\[([^\]]*)\]/m);
      if (kwInline) {
        meta.keywords = kwInline[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      }
    }

    // examples (YAML list)
    const exMatch = fm.match(/^examples:\s*\n((?:\s*-\s*.+\n?)*)/m);
    if (exMatch) {
      meta.examples = exMatch[1]
        .split("\n")
        .map((l) => l.replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }

    // priority
    const priMatch = fm.match(/^priority:\s*(\d+)/m);
    if (priMatch) meta.priority = parseInt(priMatch[1], 10);
  }

  // Fallback description from body
  if (!meta.description) {
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---")) continue;
      meta.description = trimmed.slice(0, 256);
      break;
    }
  }
  if (!meta.description) meta.description = "Claude Code skill";

  return meta;
}

// List all available skills with full metadata.
export async function listSkillsWithMetadata(): Promise<SkillMetadata[]> {
  const home = homedir();
  const projectSkillsDir = join(process.cwd(), ".claude", "skills");
  const globalSkillsDir = join(home, ".claude", "skills");
  const pluginsDir = join(home, ".claude", "plugins");
  const seen = new Set<string>();
  const skills: SkillMetadata[] = [];

  await collectSkillsMetaFromDir(projectSkillsDir, null, seen, skills);
  await collectSkillsMetaFromDir(globalSkillsDir, null, seen, skills);

  const cachePath = join(pluginsDir, "cache");
  if (existsSync(cachePath)) {
    try {
      const pluginDirs = await readdir(cachePath, { withFileTypes: true });
      for (const pd of pluginDirs) {
        if (!pd.isDirectory()) continue;
        const pluginCacheDir = join(cachePath, pd.name);
        const subDirs = await readdir(pluginCacheDir, { withFileTypes: true }).catch(() => []);
        for (const sub of subDirs) {
          if (!sub.isDirectory()) continue;
          const innerDir = join(pluginCacheDir, sub.name);
          const verDirs = await readdir(innerDir, { withFileTypes: true }).catch(() => []);
          for (const ver of verDirs) {
            if (!ver.isDirectory()) continue;
            await collectSkillsMetaFromDir(join(innerDir, ver.name, "skills"), pd.name, seen, skills);
          }
          await collectSkillsMetaFromDir(join(innerDir, "skills"), pd.name, seen, skills);
        }
      }
    } catch {
      // cache dir not readable
    }
  }

  // Sort by priority (lower = higher priority)
  skills.sort((a, b) => a.priority - b.priority);
  return skills;
}

// Backward-compatible: list skills with name + description only
export async function listSkills(): Promise<SkillInfo[]> {
  const full = await listSkillsWithMetadata();
  return full.map(({ name, description }) => ({ name, description }));
}

// Smart matching: find best skill for a given input text
export function matchSkills(input: string, skills: SkillMetadata[]): SkillMatch[] {
  const lower = input.toLowerCase().trim();
  if (!lower) return [];

  const matches: SkillMatch[] = [];

  for (const skill of skills) {
    // 1. Exact command name match (highest score)
    const skillCmd = skill.name.toLowerCase();
    if (lower === skillCmd || lower === `/${skillCmd}`) {
      matches.push({ skill, score: 100, matchedOn: "command" });
      continue;
    }

    // 2. Keyword matching
    let keywordScore = 0;
    for (const kw of skill.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        keywordScore += 10;
      }
    }

    // 3. Example matching
    for (const ex of skill.examples) {
      if (lower.includes(ex.toLowerCase()) || ex.toLowerCase().includes(lower)) {
        keywordScore += 15;
      }
    }

    // 4. Description word matching
    let descScore = 0;
    const descWords = skill.description.toLowerCase().split(/\s+/);
    const inputWords = lower.split(/\s+/);
    for (const iw of inputWords) {
      if (iw.length < 3) continue;
      if (descWords.includes(iw)) descScore += 2;
    }

    const totalScore = keywordScore + descScore;
    if (totalScore > 0) {
      matches.push({
        skill,
        score: totalScore,
        matchedOn: keywordScore > descScore ? "keyword" : "description",
      });
    }
  }

  // Sort by score desc, then priority asc
  matches.sort((a, b) => b.score - a.score || a.skill.priority - b.skill.priority);
  return matches;
}

// Format skills list for display (used by /skills command)
export function formatSkillsList(skills: SkillMetadata[]): string {
  if (skills.length === 0) return "No skills found.";

  const lines: string[] = ["📚 **Available Skills**\n"];
  for (const s of skills) {
    const keywords = s.keywords.length > 0 ? ` [${s.keywords.join(", ")}]` : "";
    lines.push(`• **/${s.name}** — ${s.description}${keywords}`);
    if (s.examples.length > 0) {
      lines.push(`  _Triggers:_ ${s.examples.slice(0, 3).map((e) => `\`${e}\``).join(", ")}`);
    }
  }
  lines.push(`\n_${skills.length} skill(s) available_`);
  return lines.join("\n");
}

async function collectSkillsMetaFromDir(
  dir: string,
  pluginName: string | null,
  seen: Set<string>,
  skills: SkillMetadata[],
): Promise<void> {
  if (!existsSync(dir)) return;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!(await isDirOrSymlinkToDir(dir, entry))) continue;
      const skillPath = join(dir, entry.name, "SKILL.md");
      if (!existsSync(skillPath)) continue;

      let content: string;
      try {
        content = await readFile(skillPath, "utf8");
      } catch {
        continue;
      }
      if (!content.trim()) continue;

      const name = pluginName ? `${pluginName}_${entry.name}` : entry.name;
      if (seen.has(name)) continue;
      seen.add(name);

      skills.push(parseSkillMetadata(name, content));
    }
  } catch {
    // dir not readable
  }
}

function extractDescription(content: string): string {
  return parseSkillMetadata("", content).description;
}

// Resolve a slash command name to a Claude Code skill prompt.
// Search order:
// 1. Project skills: {cwd}/.claude/skills/{name}/SKILL.md
// 2. Global skills: ~/.claude/skills/{name}/SKILL.md
// 3. Plugin skills: ~/.claude/plugins/*/skills/{name}/SKILL.md
// Returns the SKILL.md content if found, or null.
export async function resolveSkillPrompt(command: string): Promise<string | null> {
  // Strip leading "/" if present
  const name = command.startsWith("/") ? command.slice(1) : command;
  if (!name) return null;

  // Handle "plugin:skill" format
  const colonIdx = name.indexOf(":");
  const pluginHint = colonIdx > 0 ? name.slice(0, colonIdx) : null;
  const skillName = colonIdx > 0 ? name.slice(colonIdx + 1) : name;

  const home = homedir();
  const projectSkillsDir = join(process.cwd(), ".claude", "skills");
  const globalSkillsDir = join(home, ".claude", "skills");
  const pluginsDir = join(home, ".claude", "plugins");

  // 1. Project-level skills (exact name match)
  if (!pluginHint) {
    const projectPath = join(projectSkillsDir, skillName, "SKILL.md");
    const content = await tryReadFile(projectPath);
    if (content) return content;
  }

  // 2. Global skills (exact name match)
  if (!pluginHint) {
    const globalPath = join(globalSkillsDir, skillName, "SKILL.md");
    const content = await tryReadFile(globalPath);
    if (content) return content;
  }

  // 3. Plugin skills
  const pluginContent = await searchPluginSkills(pluginsDir, skillName, pluginHint);
  if (pluginContent) return pluginContent;

  return null;
}

async function tryReadFile(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  try {
    const content = await readFile(path, "utf8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

async function searchPluginSkills(
  pluginsDir: string,
  skillName: string,
  pluginHint: string | null,
): Promise<string | null> {
  if (!existsSync(pluginsDir)) return null;

  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!(await isDirOrSymlinkToDir(dir, entry))) continue;
      if (pluginHint && entry.name !== pluginHint) continue;

      const skillPath = join(pluginsDir, entry.name, "skills", skillName, "SKILL.md");
      const content = await tryReadFile(skillPath);
      if (content) return content;

      const cachePath = join(pluginsDir, "cache", entry.name);
      if (existsSync(cachePath)) {
        const cacheContent = await searchCacheDir(cachePath, skillName);
        if (cacheContent) return cacheContent;
      }
    }

    if (!pluginHint) {
      const cachePath = join(pluginsDir, "cache");
      if (existsSync(cachePath)) {
        const cacheEntries = await readdir(cachePath, { withFileTypes: true });
        for (const ce of cacheEntries) {
          if (!ce.isDirectory()) continue;
          const cacheContent = await searchCacheDir(join(cachePath, ce.name), skillName);
          if (cacheContent) return cacheContent;
        }
      }
    } else {
      const cachePath = join(pluginsDir, "cache", pluginHint);
      if (existsSync(cachePath)) {
        const cacheContent = await searchCacheDir(cachePath, skillName);
        if (cacheContent) return cacheContent;
      }
    }
  } catch {
    // Plugin directory not readable
  }

  return null;
}

async function searchCacheDir(cachePluginDir: string, skillName: string): Promise<string | null> {
  try {
    const subEntries = await readdir(cachePluginDir, { withFileTypes: true });
    for (const sub of subEntries) {
      if (!sub.isDirectory()) continue;
      const innerDir = join(cachePluginDir, sub.name);
      const versionEntries = await readdir(innerDir, { withFileTypes: true });
      for (const ver of versionEntries) {
        if (!ver.isDirectory()) continue;
        const skillPath = join(innerDir, ver.name, "skills", skillName, "SKILL.md");
        const content = await tryReadFile(skillPath);
        if (content) return content;
      }
      const directPath = join(innerDir, "skills", skillName, "SKILL.md");
      const content = await tryReadFile(directPath);
      if (content) return content;
    }
  } catch {
    // Not readable
  }
  return null;
}
