---
name: my-skill-name
description: >
  Short description of what this skill does and when to trigger it.
  Include trigger phrases so Claude knows when to activate it.
keywords:
  - keyword1
  - keyword2
  - related-term
examples:
  - "create a widget"
  - "build something"
  - "make a new thing"
priority: 100
---

# Skill Title

Brief overview of what this skill does.

## When to Use

- User asks to do X
- User mentions Y
- Triggered by `/my-skill-name` command

## Instructions

Step-by-step instructions for what Claude should do when this skill is triggered.

1. First, do this
2. Then, do that
3. Finally, wrap up

## Arguments

Use `$ARGUMENTS` to access user-provided arguments after the command.

Example: `/my-skill-name some argument here` → `$ARGUMENTS` = `some argument here`

## Notes

- Additional context or constraints
- Edge cases to handle
- Related skills: `/other-skill`
