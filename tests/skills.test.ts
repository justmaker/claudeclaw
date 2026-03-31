import { describe, it, expect } from "vitest";
import { parseSkillMetadata, matchSkills, formatSkillsList } from "../src/skills";
import type { SkillMetadata } from "../src/skills";

describe("parseSkillMetadata", () => {
  it("should parse full frontmatter", () => {
    const content = `---
name: test-skill
description: A test skill for unit testing
keywords:
  - test
  - unit
  - demo
examples:
  - "run test"
  - "do testing"
priority: 50
---

# Test Skill

Body content here.
`;
    const meta = parseSkillMetadata("fallback-name", content);
    expect(meta.name).toBe("test-skill");
    expect(meta.description).toBe("A test skill for unit testing");
    expect(meta.keywords).toEqual(["test", "unit", "demo"]);
    expect(meta.examples).toEqual(["run test", "do testing"]);
    expect(meta.priority).toBe(50);
  });

  it("should use fallback name when frontmatter has no name", () => {
    const content = `---
description: Simple skill
---

# Simple
`;
    const meta = parseSkillMetadata("my-fallback", content);
    expect(meta.name).toBe("my-fallback");
    expect(meta.description).toBe("Simple skill");
    expect(meta.priority).toBe(100);
    expect(meta.keywords).toEqual([]);
  });

  it("should extract description from body when no frontmatter", () => {
    const content = `# My Skill

This is a body description line.
`;
    const meta = parseSkillMetadata("body-skill", content);
    expect(meta.description).toBe("This is a body description line.");
  });

  it("should parse inline keywords", () => {
    const content = `---
name: inline
description: Inline keywords test
keywords: [alpha, beta, gamma]
---
`;
    const meta = parseSkillMetadata("inline", content);
    expect(meta.keywords).toEqual(["alpha", "beta", "gamma"]);
  });

  it("should default priority to 100", () => {
    const content = `---
name: no-priority
description: No priority set
---
`;
    const meta = parseSkillMetadata("no-priority", content);
    expect(meta.priority).toBe(100);
  });
});

describe("matchSkills", () => {
  const skills: SkillMetadata[] = [
    {
      name: "deploy",
      description: "Deploy application to production",
      keywords: ["deploy", "release", "ship"],
      examples: ["deploy to prod", "ship it"],
      priority: 10,
    },
    {
      name: "test-runner",
      description: "Run unit tests and integration tests",
      keywords: ["test", "unittest", "check"],
      examples: ["run tests", "check tests"],
      priority: 50,
    },
    {
      name: "create-skill",
      description: "Create new skills for Claude Code",
      keywords: ["skill", "create", "new", "command"],
      examples: ["create a skill", "new skill", "add a skill"],
      priority: 100,
    },
  ];

  it("should match exact command name with highest score", () => {
    const matches = matchSkills("deploy", skills);
    expect(matches[0].skill.name).toBe("deploy");
    expect(matches[0].score).toBe(100);
    expect(matches[0].matchedOn).toBe("command");
  });

  it("should match with leading slash", () => {
    const matches = matchSkills("/deploy", skills);
    expect(matches[0].skill.name).toBe("deploy");
    expect(matches[0].score).toBe(100);
  });

  it("should match by keyword", () => {
    const matches = matchSkills("ship the release", skills);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].skill.name).toBe("deploy");
  });

  it("should match by example", () => {
    const matches = matchSkills("run tests", skills);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].skill.name).toBe("test-runner");
  });

  it("should return empty for no match", () => {
    const matches = matchSkills("weather forecast", skills);
    expect(matches).toEqual([]);
  });

  it("should sort by score desc then priority asc", () => {
    // Both "deploy" and "create-skill" have "create" as keyword, but test-runner doesn't
    const matches = matchSkills("create a skill", skills);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].skill.name).toBe("create-skill");
  });

  it("should handle empty input", () => {
    expect(matchSkills("", skills)).toEqual([]);
    expect(matchSkills("  ", skills)).toEqual([]);
  });
});

describe("formatSkillsList", () => {
  it("should format skills with metadata", () => {
    const skills: SkillMetadata[] = [
      {
        name: "deploy",
        description: "Deploy to production",
        keywords: ["deploy", "release"],
        examples: ["deploy to prod"],
        priority: 10,
      },
    ];
    const output = formatSkillsList(skills);
    expect(output).toContain("📚 **Available Skills**");
    expect(output).toContain("/deploy");
    expect(output).toContain("Deploy to production");
    expect(output).toContain("deploy, release");
    expect(output).toContain("`deploy to prod`");
    expect(output).toContain("1 skill(s) available");
  });

  it("should handle empty skills list", () => {
    expect(formatSkillsList([])).toBe("No skills found.");
  });

  it("should hide keywords if none", () => {
    const skills: SkillMetadata[] = [
      { name: "simple", description: "A simple skill", keywords: [], examples: [], priority: 100 },
    ];
    const output = formatSkillsList(skills);
    expect(output).not.toContain("[]");
    expect(output).toContain("/simple");
  });
});

describe("priority ordering", () => {
  it("should prefer higher priority (lower number) when scores are equal", () => {
    const skills: SkillMetadata[] = [
      { name: "low-pri", description: "test skill", keywords: ["test"], examples: [], priority: 200 },
      { name: "high-pri", description: "test skill", keywords: ["test"], examples: [], priority: 10 },
      { name: "med-pri", description: "test skill", keywords: ["test"], examples: [], priority: 100 },
    ];
    const matches = matchSkills("test something", skills);
    expect(matches.length).toBe(3);
    // All have same keyword score, so priority determines order
    expect(matches[0].skill.name).toBe("high-pri");
    expect(matches[1].skill.name).toBe("med-pri");
    expect(matches[2].skill.name).toBe("low-pri");
  });
});
