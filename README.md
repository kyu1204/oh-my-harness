<div align="center">

# 🐴 oh-my-harness

**Tame your AI coding agents with natural language.**

[![npm version](https://img.shields.io/npm/v/oh-my-harness.svg)](https://www.npmjs.com/package/oh-my-harness)
[![npm downloads](https://img.shields.io/npm/dm/oh-my-harness.svg)](https://www.npmjs.com/package/oh-my-harness)
[![CI](https://github.com/kyu1204/oh-my-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/kyu1204/oh-my-harness/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/kyu1204/oh-my-harness.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

> Stop hand-writing CLAUDE.md files. Describe your project, get enforced guardrails.

</div>

---

## The Problem

Every AI code agent needs configuration files. Claude Code needs `CLAUDE.md` + hooks. Cursor needs `.cursorrules`. Codex needs `AGENTS.md`. You end up:

- Copy-pasting config files between projects
- Forgetting to set up TDD enforcement hooks
- Agents committing code without running tests
- Inconsistent behavior across projects

## The Solution

```bash
oh-my-harness init "React + FastAPI fullstack, TDD enforced, lint on save"
```

That's it. oh-my-harness generates **enforced guardrails** — not just instructions, but hooks that actually **block** bad behavior:

- ❌ Commit without tests passing? **Blocked.**
- ❌ Write to `node_modules/` or `.next/`? **Blocked.**
- ❌ Run `rm -rf /`? **Blocked.**
- ✅ Auto-lint on every file save? **Done.**
- ✅ TDD workflow enforced in every plan? **Done.**

---

## Quick Start

```bash
# Zero-install: run directly with npx
npx oh-my-harness init "TypeScript Next.js frontend with Python FastAPI backend"

# Or install globally
npm install -g oh-my-harness
oh-my-harness init --preset nextjs fastapi
```

### What Gets Generated

```
your-project/
├── CLAUDE.md                          # TDD rules, coding standards, architecture guide
├── harness.yaml                       # Your harness config (editable, git-trackable)
└── .claude/
    ├── settings.json                  # Hook configs, permissions (allow/deny)
    ├── hooks/
    │   ├── base-command-guard.sh      # Blocks dangerous commands
    │   ├── base-test-before-commit.sh # Tests must pass before commit
    │   ├── nextjs-file-guard.sh       # Protects build outputs
    │   └── fastapi-lint-on-save.sh    # Auto-formats Python on save
    └── oh-my-harness.json             # Active preset tracking
```

---

## How It Works

```
                    ┌─────────────────────┐
  "React + FastAPI  │                     │
   TDD enforced"    │   claude -p (NL)    │
  ─────────────────▶│   or --preset flag  │
                    │                     │
                    └────────┬────────────┘
                             │
                             ▼
                    ┌─────────────────────┐
                    │   harness.yaml      │  ← Intermediate representation
                    │   (editable, git    │    (source of truth)
                    │    trackable)       │
                    └────────┬────────────┘
                             │
                             ▼
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────────┐
        │ CLAUDE.md│  │  Hooks   │  │ settings.json│
        │ (rules)  │  │ (enforce)│  │ (permissions)│
        └──────────┘  └──────────┘  └──────────────┘
```

### Two Modes

| Mode | Command | Speed | Requires |
|------|---------|-------|----------|
| **NL-first** | `init "description"` | ~5s | Claude CLI installed |
| **Preset** | `init --preset nextjs` | Instant | Nothing |

---

## Built-in Presets

### `_base` — Always Applied
- TDD enforcement (mandatory test-first workflow)
- Dangerous command blocking
- Pre-commit test gate
- Branch management rules
- File safety rules

### `nextjs` — Next.js + TypeScript
- App Router conventions (Server Components default)
- Component test enforcement
- ESLint auto-fix on save
- Build output protection (`.next/`, `out/`)
- pnpm permissions

### `fastapi` — FastAPI + Python
- Async-first, Pydantic v2 patterns
- pytest + real DB testing (no mocks)
- Ruff auto-format on save
- Virtual env protection
- uv/pytest permissions

### `nextjs-fastapi` — Full Stack
- Composes both presets
- Cross-cutting rules (CORS, API boundaries)
- Dual test suite enforcement (both must pass before commit)

---

## Commands

```bash
# Initialize with natural language
oh-my-harness init "your project description"

# Initialize with presets
oh-my-harness init --preset nextjs fastapi

# Add a preset to existing config
oh-my-harness add nextjs

# Remove a preset
oh-my-harness remove fastapi

# Health check
oh-my-harness doctor
```

### `doctor` Output

```
oh-my-harness: running health checks...
  ✓ .claude/oh-my-harness.json found (presets: _base, nextjs)
  ✓ CLAUDE.md exists with intact markers
  ✓ .claude/settings.json is valid
  ✓ All hook scripts are executable
oh-my-harness: all checks passed
```

---

## Enforcement in Action

### TDD Gate (Pre-commit Hook)

When Claude Code tries to `git commit`, oh-my-harness intercepts:

```bash
# Agent attempts: git commit -m "add login page"
oh-my-harness: Running tests before commit...
# pnpm test runs...
# If tests fail:
{"decision": "block", "reason": "oh-my-harness: tests failed, commit blocked"}
# Agent must fix tests before committing
```

### File Guard (Pre-write Hook)

```bash
# Agent attempts: Write to .next/cache/something.js
{"decision": "block", "reason": "oh-my-harness: protected path .next/"}
# Agent cannot write to build outputs
```

### Command Guard

```bash
# Agent attempts: rm -rf /
{"decision": "block", "reason": "oh-my-harness: dangerous command blocked"}
```

---

## The `harness.yaml` File

After init, a `harness.yaml` is saved to your project root. This is the **source of truth** — edit it directly, then re-run init to regenerate:

```yaml
version: "1.0"
project:
  description: "E-commerce platform"
  stacks:
    - name: frontend
      framework: nextjs
      language: typescript
      testRunner: vitest
      linter: eslint

rules:
  - id: tdd-rules
    title: TDD Workflow
    content: |
      ## TDD Workflow (MANDATORY)
      1. Write failing test FIRST
      2. Implement minimal code to pass
      3. Refactor while green
    priority: 10

enforcement:
  preCommit: ["test", "lint", "build"]
  blockedPaths: [".next/", "node_modules/"]
  blockedCommands: ["rm -rf", "sudo"]
  postSave:
    - pattern: "*.ts"
      command: "eslint --fix"
```

---

## Architecture

```
oh-my-harness/
├── bin/                    # CLI entry point
├── src/
│   ├── cli/commands/       # init, add, remove, doctor
│   ├── core/
│   │   ├── preset-types.ts     # Zod schemas
│   │   ├── preset-loader.ts    # YAML → typed config
│   │   ├── preset-registry.ts  # Discover & search presets
│   │   ├── config-merger.ts    # Merge multiple presets
│   │   ├── harness-schema.ts   # harness.yaml schema
│   │   ├── harness-converter.ts # harness.yaml → MergedConfig
│   │   └── generator.ts        # Orchestrates all generators
│   ├── generators/
│   │   ├── claude-md.ts    # CLAUDE.md with idempotent markers
│   │   ├── hooks.ts        # Executable hook scripts
│   │   ├── settings.ts     # .claude/settings.json
│   │   └── gitignore.ts    # .gitignore updater
│   ├── nl/
│   │   ├── parse-intent.ts     # claude -p integration
│   │   └── prompt-templates.ts # LLM prompt construction
│   └── utils/
│       ├── markdown.ts     # Marker-based section management
│       └── yaml.ts         # YAML helpers
├── presets/                # Built-in preset definitions
│   ├── _base/
│   ├── nextjs/
│   ├── fastapi/
│   └── nextjs-fastapi/
└── tests/                  # 131 tests (unit + integration)
```

---

## Adding Custom Presets

Create a directory in `presets/` with a `preset.yaml`:

```yaml
name: my-preset
displayName: "My Custom Preset"
description: "Custom rules for my team"
version: "1.0.0"
extends: ["_base"]
tags: ["custom"]

claudeMd:
  sections:
    - id: "my-rules"
      title: "My Rules"
      content: |
        ## My Team Rules
        - Always write JSDoc comments
        - Use barrel exports
      priority: 30

hooks:
  preToolUse:
    - id: "my-guard"
      matcher: "Bash"
      inline: |
        #!/bin/bash
        # Your custom enforcement logic
        exit 0
```

No code changes required. The registry auto-discovers it.

---

## Requirements

- **Node.js** >= 20
- **Claude CLI** (optional, for NL mode) — [Install guide](https://docs.anthropic.com/en/docs/claude-code)

---

## Roadmap

- [ ] Cursor (`.cursor/rules/`) emitter
- [ ] Codex (`AGENTS.md`) emitter
- [ ] GitHub Copilot emitter
- [ ] `oh-my-harness sync` — drift detection
- [ ] Community preset registry
- [ ] `npx oh-my-harness` — zero-install usage
- [ ] `oh-my-harness modify "change X"` — NL config editing

---

## License

MIT

---

<div align="center">

**Your agents are only as good as their guardrails.**

Built with frustration from hand-writing CLAUDE.md files.

</div>
