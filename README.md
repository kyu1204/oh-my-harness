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

## 😤 The Problem

Every AI code agent needs configuration files. Claude Code needs `CLAUDE.md` + hooks. Cursor needs `.cursorrules`. Codex needs `AGENTS.md`. You end up:

- 📋 Copy-pasting config files between projects
- 🔓 Forgetting to set up TDD enforcement hooks
- 💥 Agents committing code without running tests
- 🎲 Inconsistent behavior across projects

## ✨ The Solution

```bash
oh-my-harness init "React + FastAPI fullstack, TDD enforced, lint on save"
```

That's it. oh-my-harness generates **enforced guardrails** — not just instructions, but hooks that actually **block** bad behavior:

- ❌ Commit without tests passing? **Blocked.**
- ❌ Edit source without updating tests first? **Blocked.** _(TDD Guard)_
- ❌ Write to `node_modules/` or `.next/`? **Blocked.**
- ❌ Run `rm -rf /`? **Blocked.**
- ❌ Commit on a merged branch? **Blocked.**
- ✅ Auto-lint on every file save? **Done.**
- ✅ Auto-create PR after push? **Done.**
- 📊 Track all hook events for analytics? **Done.**

---

## 🚀 Quick Start

```bash
# Zero-install: run directly with npx
npx oh-my-harness init "TypeScript Next.js frontend with Python FastAPI backend"

# Or install globally
npm install -g oh-my-harness
oh-my-harness init "React app with TDD"

# Short alias works too
omh init "Android Kotlin app with Hilt, JUnit, Gradle"
omh catalog list
omh test          # Dry-run verify your harness
omh stats         # TUI analytics dashboard
omh diff          # Preview what `omh sync` would change
omh sync --check  # Fail (exit 1) if generated files are out of date — CI gate
```

### 🔄 Keeping generated files in sync

`harness.yaml` is the source of truth, so the committed `CLAUDE.md`, hooks, and
runtime configs can drift if someone edits `harness.yaml` without re-running
`omh sync`. Three commands keep them honest:

| Command | Use |
|---------|-----|
| `omh sync --check` | CI gate — exits non-zero (and lists the files) when generated output is stale, writes nothing |
| `omh diff` | Human preview of exactly what `omh sync` would change |
| `omh doctor --strict` | Health check that also fails on drift (plain `omh doctor` warns) |

```yaml
# .github/workflows/ci.yml
- run: npx oh-my-harness sync --check   # fails the build if the harness is out of date
```

The hook manifest records the oh-my-harness version that generated it, so an
upgrade that changes output is surfaced as a "re-run `omh sync`" hint.

### 📁 What Gets Generated

```text
~/.omh/
└── config.json                        # AI provider config (global, not per-project)

your-project/
├── CLAUDE.md                          # Claude Code instructions (TDD rules, standards)
├── AGENTS.md                          # Codex CLI instructions (same managed sections)
├── harness.yaml                       # Your harness config (source of truth)
├── .omh/                              # Single source of truth — hooks + state
│   ├── hooks/
│   │   ├── catalog-branch-guard.sh    # Blocks commits on merged branches
│   │   ├── catalog-tdd-guard.sh       # Enforces test-first workflow
│   │   ├── catalog-commit-test-gate.sh # Tests must pass before commit
│   │   ├── catalog-path-guard.sh      # Protects build outputs
│   │   ├── catalog-command-guard.sh   # Blocks dangerous commands
│   │   ├── catalog-lint-on-save.sh    # Auto-lint on save
│   │   └── catalog-auto-pr.sh         # Auto-create PR after push
│   ├── loop/
│   │   └── run.sh                     # Autonomous loop runner (see Loop Engine)
│   ├── state/                         # gitignored — log/runtime data
│   │   ├── events.jsonl               # Unified hook event log (powers omh stats)
│   │   ├── loop-events.jsonl          # Loop runner event stream
│   │   └── tdd-edits.json             # TDD guard working state
│   └── manifest.json                  # Generated-files manifest
├── .claude/
│   ├── settings.json                  # Claude permissions + hooks → .omh/hooks/*.sh
│   ├── skills/omh-loop/SKILL.md       # "run this as a loop" skill
│   └── oh-my-harness.json             # Harness init/sync state
└── .codex/
    ├── config.toml                    # [features] hooks = true, goals = true
    └── hooks.json                     # Codex hooks → .omh/hooks/*.sh (same scripts)
```

---

## ⚙️ How It Works

```text
  ~/.omh/config.json   ┌─────────────────────┐
  ┌────────────────┐   │                     │
  │ • Claude CLI   │──▶│   NL Processing     │◀── "React + FastAPI
  │ • Claude API   │   │   (describe your    │     TDD enforced"
  │ • OpenAI API   │   │                     │
  │ • Gemini API   │   │                     │
  │ • Codex OAuth  │   │                     │
  │ • Codex OAuth  │   │                     │
  │   API          │   └────────┬────────────┘
  └────────────────┘            │
   (global AI config)   ┌────────▼────────────┐
                        │  Project Detector   │  ← Auto-detects language,
                        │  (14 languages)     │    framework, package manager
                        └────────┬────────────┘
                                 │
                        ┌────────▼────────────┐
                        │   harness.yaml      │  ← Source of truth
                        │   (editable, git    │    (hooks + rules)
                        │    trackable)       │
                        └────────┬────────────┘
                                 │
                  ┌──────────────┼──────────────┐
                  ▼              ▼              ▼
            ┌──────────┐  ┌──────────┐  ┌──────────┐
            │CLAUDE.md │  │  Hooks   │  │settings. │
            │ (rules)  │  │(enforce) │  │  json    │
            │          │  │          │  │(perms)   │
            └──────────┘  └──────────┘  └──────────┘
```

### 🔍 Project Detector

oh-my-harness automatically detects your project type and injects accurate facts into the LLM prompt:

| Language | Detection | Commands |
|----------|-----------|----------|
| 🟦 TypeScript/JS | package.json, tsconfig | pnpm/npm/yarn test, eslint, tsc |
| 🐍 Python | pyproject.toml, requirements.txt, Pipfile, manage.py, .python-version | pytest, ruff, black, isort, mypy |
| 🍎 Swift | Package.swift, .xcodeproj | swift test, xcodebuild |
| 🦀 Rust | Cargo.toml | cargo test, cargo clippy |
| 🐹 Go | go.mod | go test, golangci-lint |
| ☕ Java/Kotlin | pom.xml, build.gradle | mvn test, ./gradlew test |
| 💎 Ruby | Gemfile | bundle exec rspec |
| 🐘 PHP | composer.json | phpunit |
| 🎯 Dart/Flutter | pubspec.yaml | dart test, flutter test |
| ⚡ C/C++ | CMakeLists.txt | cmake, make |
| 🟣 C#/.NET | *.csproj | dotnet test |
| 💧 Elixir | mix.exs | mix test |
| 🔷 Scala | build.sbt | sbt test |
| ⚡ Zig | build.zig | zig build test |

### 🤖 AI Provider Setup

oh-my-harness supports multiple AI providers for natural language mode:

| Provider | Setup | Available Models | Default |
|----------|-------|------------------|---------|
| **Claude CLI** | `claude` command installed | Opus 4.6, Sonnet 4.6, Haiku 4.5 | ✓ |
| **Claude API** | Set `ANTHROPIC_API_KEY` | Opus 4.6, Sonnet 4.6, Haiku 4.5 | Sonnet 4.6 |
| **OpenAI API** | Set `OPENAI_API_KEY` | GPT-5.5, GPT-5.4, GPT-5.4-mini, GPT-5.4-nano, GPT-4.1, GPT-4.1-mini, o3, o4-mini | GPT-5.5 |
| **Gemini API** | Set `GOOGLE_API_KEY` | Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash Lite, Gemini 3.1 Pro Preview | Gemini 2.5 Pro |
| **Codex OAuth** | `codex` command installed + `codex login`; runs `codex exec` | GPT-5.5, GPT-5.4, GPT-5.4-mini | GPT-5.5 |
| **Codex OAuth API** | `omh config` device-code login; imports `~/.codex/auth.json` once if present, then uses `~/.omh` | GPT-5.5, GPT-5.4, GPT-5.4-mini | GPT-5.5 |

Configuration is saved to `~/.omh/config.json` and selected via interactive UI on first use:

```bash
omh init  # will prompt for AI provider selection and model choice
```

---

## 🧱 Building Block Catalog

All enforcement is powered by **catalog blocks** — reusable, parameterized hook templates:

| Block | Category | Description |
|-------|----------|-------------|
| 🛡️ `branch-guard` | git | Blocks commits on main/merged branches |
| 🧪 `commit-test-gate` | quality | Runs tests before git commit |
| 🔍 `commit-typecheck-gate` | quality | Runs typecheck before git commit |
| 🔒 `command-guard` | security | Blocks dangerous shell commands |
| 📁 `path-guard` | file-protection | Blocks writes to protected paths |
| 🔐 `lockfile-guard` | file-protection | Prevents manual lockfile edits |
| 🤫 `secret-file-guard` | security | Blocks edits to .env, credentials |
| ✏️ `lint-on-save` | auto-fix | Auto-lint on file save |
| 🎨 `format-on-save` | auto-fix | Auto-format on file save |
| 🧪 `test-on-save` | auto-fix | Auto-run tests on file save |
| 🔀 `auto-pr` | automation | Auto-create PR after push |
| 🧪 `tdd-guard` | quality | Blocks source edits unless test modified first (JS/TS/Python/Kotlin/Java) |
| 🔒 `sql-guard` | security | Blocks dangerous SQL operations |
| 🌳 `worktree-setup` | monorepo | Supports monorepo worktree patterns |
| 🗜️ `compact-context` | maintenance | Re-injects context on session start |
| 📋 `config-audit` | audit | Audit trail for config changes |
| 🔔 `desktop-notify` | ux | Cross-platform desktop notifications |
| 🔁 `loop-guard` | quality | Blocks a loop session from writing its own work orders or touching architect-only paths |

### Usage in `harness.yaml`

```yaml
hooks:
  - block: branch-guard
  - block: tdd-guard
    mode: ask          # ask for approval instead of hard-blocking (Claude)
  - block: commit-test-gate
    params:
      testCommand: "npx vitest run"
  - block: path-guard
    params:
      blockedPaths:
        - "node_modules/"
        - "dist/"
  - block: command-guard
    params:
      patterns:
        - "rm -rf /"
        - "sudo rm"
  - block: lint-on-save
    params:
      filePattern: "*.ts"
      command: "npx eslint --fix"
  - block: auto-pr
    params:
      baseBranch: main
```

#### `mode`: block vs. ask

Any blocking hook accepts an optional `mode` (default `block`):

- **`block`** — hard-blocks the tool call. The agent cannot proceed.
- **`ask`** — escalates to the user for approval instead of blocking outright.
  - **Claude Code**: shows a native permission prompt (`permissionDecision: "ask"`).
  - **Codex**: `ask` is **not** supported, so the hook falls back to a hard
    block — your guardrail is never silently downgraded to "allow". The same
    generated script detects the calling runtime and responds accordingly.

`mode: ask` only applies to blocks that can block (`canBlock: true`); setting it
on a non-blocking block (e.g. `lint-on-save`) is reported and ignored.

---

## 🔁 Autonomous Loop Engine

Once `omh init`/`omh sync` has run, any agent session (Claude Code, Codex, Pi)
can be told **"run this as a loop"** — the generated `omh-loop` skill turns that
into a fully set-up autonomous loop, no manual wiring:

```text
you: "ship the remaining Phase B tasks as a loop"
        │
        ▼  omh-loop skill (the session becomes the ARCHITECT)
  1. writes WORKPLAN.md          — goal gates + task checkboxes (single source of truth)
  2. writes docs/work-orders/*.md — one exact work order per task
  3. starts .omh/loop/run.sh      — background, in its own git worktree
  4. attaches monitoring          — tail -f .omh/state/loop-events.jsonl
        │
        ▼  loop (fresh headless session per iteration, cheap model)
  pick next unchecked task → implement its work order exactly → run its
  acceptance commands → tick checkbox + commit → repeat until the sentinel
```

The design follows a battle-tested pattern from real autonomous runs: state
lives in **files** (ledger + git log), never in a conversation. Each iteration
is a fresh `-p` session on an explicit cheap model, so token use stays flat.

### Why it doesn't fall over

Every guard below exists because the failure actually happened somewhere:

| Guard | Failure it prevents |
|-------|---------------------|
| Sentinel = fixed string, whole line, clean exit only | a crashed turn (or a turn merely *mentioning* the sentinel) ending the loop as "complete" |
| Three **separate** backoffs — usage limit / crashed turn / consecutive `BLOCKED` | a loop once spun **266 iterations** doing nothing because waiting-on-a-human was treated like a failure |
| `loop-guard` hook blocks the loop writing its own work orders (Edit/Write **and** Bash redirection/`cd`) | self-approval: the loop authoring the spec it then implements |
| `loop-guard` blocks architect-only paths, listed **by name** | an abstract "don't improvise" is ignored; a named path is obeyed |
| Worktree isolation (`isolate: true`, default) | the loop and the architect fighting over the same working tree |
| Ledger seeded once, re-seeded only when the main-tree copy is newer | the loop's progress being rolled back — or a second goal reusing the first goal's ledger |

### Configuration

On by default. Everything is optional in `harness.yaml`:

```yaml
loop:
  enabled: true                # false removes all loop assets on next sync
  ledger: WORKPLAN.md          # single source of truth
  workOrders: docs/work-orders # architect-written task specs
  model: sonnet                # cheap implementation model (always explicit)
  sentinel: OMH_GOAL_COMPLETE  # whole-line completion signal
  interval: 120                # seconds between iterations
  blockedBackoff: 1800         # backoff after 3 consecutive BLOCKED turns
  architectOnly: []            # paths the loop must never touch (name them!)
  isolate: true                # run in .omh/loop/worktree on branch omh-loop
  runtime: claude              # claude | codex | pi
```

### Operating it

```bash
nohup bash .omh/loop/run.sh >/dev/null 2>&1 &   # start (the skill does this for you)
tail -f .omh/state/loop-events.jsonl             # watch progress / BLOCKED / limits
touch .omh/state/loop.stop                       # stop after the current iteration
```

A task the loop cannot finish (needs a human, or 3 failed attempts) is marked
`BLOCKED: <reason>` in the ledger and skipped — the loop never idles waiting
for a person. When you unblock it (e.g. fix an architect-only file), the loop
picks it back up after its backoff. When the goal completes in isolation, merge
the `omh-loop` branch and **re-verify** — a clean textual merge is not a
semantic one.

---

## 🖥️ Commands

```bash
# 🚀 Initialize
omh init "your project description"      # NL-powered (requires AI provider)
omh init                                  # Interactive TUI (import existing harness.yaml)

# 📋 Catalog
omh catalog list                          # Browse all building blocks
omh catalog info branch-guard             # Block details + params

# 🔧 Hook management
omh hook add branch-guard                 # Add a hook
omh hook remove auto-pr                   # Remove a hook

# 🔄 Sync & manage
omh sync                                 # Regenerate all files from harness.yaml
omh uninstall --dry-run                  # Preview generated-file cleanup
omh uninstall -y                         # Remove generated files, keep user content
omh uninstall -y --purge                 # Also remove harness.yaml

# 🩺 Verify & monitor
omh doctor                               # Health check
omh test                                  # Dry-run verify all hooks
omh stats                                 # TUI analytics dashboard
```

### 🧹 `omh uninstall` — Safe generated-file cleanup

`omh uninstall` removes oh-my-harness generated artifacts while preserving user
content in merged files.

```bash
omh uninstall --dry-run
omh uninstall -y
omh uninstall -y --purge
```

Safety behavior:

- Prints the same uninstall plan for dry-run and real execution.
- Recommends backing up before execution; use `--skip-backup-warning` only for
  automation that already handles backups.
- Keeps `harness.yaml` by default; `--purge` removes it.
- Preserves user content in `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`,
  `.codex/hooks.json`, `.codex/config.toml`, and user Pi extensions.
- Removes only OMH-owned hook commands that point at this project's
  `.omh/hooks` directory.
- Warns when `.codex/config.toml` feature flags (`hooks`/`goals`) are removed,
  because manually-owned feature settings cannot be distinguished from OMH
  generated settings.
- Warns that `.codex/config.toml` comments may be lost when TOML is rewritten.
- Uses backups for modified files and restores them on stop-on-error failures;
  `--continue-on-error` records failures and keeps applying independent
  operations.

### 🩺 `omh doctor`

```text
oh-my-harness: running health checks...
  ✓ .claude/oh-my-harness.json found
  ✓ CLAUDE.md exists with intact markers
  ✓ .claude/settings.json is valid
  ✓ All hook scripts are executable
oh-my-harness: all checks passed
```

### 🧪 `omh test` — Dry-Run Verification

Simulates hook inputs to verify block/allow behavior without entering Claude Code:

```text
┌  omh test  Harness dry-run verification
│
◇  Branch guard
│    ✓ git commit on feat/my-feature → ALLOWED
│
◇  TDD Guard
│    ✓ src/foo.ts without test → BLOCKED
│    ✓ tests/unit/foo.test.ts → ALLOWED
│    ✓ README.md → ALLOWED
│
◇  File guards
│    ✓ node_modules/test-file.js → BLOCKED
│    ✓ dist/test-file.js → BLOCKED
│    ✓ src/index.ts → ALLOWED
│
◇  Command guards
│    ✓ "rm -rf /" → BLOCKED
│    ✓ "npm test" → ALLOWED
│
└  14/14 checks passed ✓
```

### 📊 `omh stats` — TUI Analytics Dashboard

Interactive dashboard powered by [ink](https://github.com/vadimdemedes/ink) with 3 views:

```text
 [1] Overview   [2] Timeline   [3] Blocks          d:filter r:reload q:quit

 Active: 8  Events: 1213  Block rate: 2%

 branch-guard          ████████████████████ 0b/202a
 tdd-guard             █████████████████████ 14b/68a
 commit-test-gate      ████████████████████ 0b/199a
 path-guard            ████████████████████ 4b/76a
 command-guard         ████████████████████ 4b/202a

 Dormant (0 hits):
   ░ lockfile-guard
   ░ secret-file-guard
```

- **Overview** — Active blocks with hit bar charts + dormant block detection
- **Timeline** — 24-hour heatmap + block rate + peak hour
- **Blocks** — Scrollable detail view with params, hits, last block reason

Keyboard: `1/2/3` views, `↑/↓` scroll, `d` date filter, `r` reload, `q` quit

---

## 📊 Stateful Hook Logging

Every hook invocation is recorded in `.omh/state/events.jsonl`:

```jsonl
{"ts":"2026-03-18T08:00:00Z","event":"PreToolUse","hook":"catalog-tdd-guard.sh","decision":"block","reason":"TDD — foo.test.* 테스트 파일을 먼저 수정하세요"}
{"ts":"2026-03-18T08:00:05Z","event":"PreToolUse","hook":"catalog-command-guard.sh","decision":"allow","reason":""}
```

This powers `omh test` live verification and `omh stats` analytics.

---

## 🏗️ Architecture

```text
oh-my-harness/
├── bin/                    # CLI entry point
├── src/
│   ├── catalog/
│   │   ├── blocks/         # 18 building block definitions
│   │   ├── types.ts        # BuildingBlock, HookEntry schemas
│   │   ├── registry.ts     # Block discovery & search
│   │   ├── template-engine.ts # Handlebars rendering + applyDefaults
│   │   └── converter.ts    # HookEntry[] → rendered scripts
│   ├── cli/
│   │   ├── commands/       # init, doctor, catalog, hook, sync, test
│   │   ├── stats/          # TUI dashboard (ink/React)
│   │   │   ├── App.tsx     # App shell (tab bar, keyboard nav)
│   │   │   ├── data.ts     # Data aggregation layer
│   │   │   └── components/ # Overview, Timeline, Blocks views
│   │   ├── harness-tester.ts  # Hook simulation engine
│   │   ├── event-logger.ts    # events.jsonl read/write/stats
│   │   ├── event-verifier.ts  # Event-based verification
│   │   ├── tui/               # Interactive provider & model selection
│   │   ├── provider-setup.ts  # Provider configuration UI
│   │   └── tool-checker.ts    # Command executable checks
│   ├── core/
│   │   ├── harness-schema.ts      # harness.yaml Zod schema
│   │   ├── merged-config.ts       # MergedConfig + HooksConfig interfaces
│   │   ├── harness-converter-v2.ts # harness.yaml → MergedConfig (catalog pipeline)
│   │   └── generator.ts           # Orchestrates all generators
│   ├── generators/
│   │   ├── claude-md.ts    # CLAUDE.md with idempotent markers
│   │   ├── hooks.ts        # Hook scripts + event logger injection
│   │   ├── settings.ts     # .claude/settings.json
│   │   └── gitignore.ts    # .gitignore updater
│   ├── detector/
│   │   ├── project-detector.ts  # Deterministic project detection
│   │   ├── types.ts             # ProjectFacts, Detector interface
│   │   └── detectors/           # 14 language detectors
│   ├── cli/
│   │   ├── tui/            # Interactive provider & model selection
│   │   └── provider-setup.ts # Provider configuration UI
│   └── nl/
│       ├── provider-registry.ts # Multi-provider definitions
│       ├── config-store.ts      # ~/.omh/config.json persistence
│       ├── providers/           # Provider implementations
│       │   ├── claude-cli.ts
│       │   ├── claude-api.ts
│       │   ├── openai-api.ts
│       │   └── gemini-api.ts
│       ├── parse-intent.ts      # LLM prompt integration
│       └── prompt-templates.ts  # NL prompt construction
└── tests/                  # 900+ tests (unit + integration)
```

---

## 📦 Requirements

- **Node.js** >= 20
- **Claude CLI** (optional, for default NL mode) — [Install guide](https://docs.anthropic.com/en/docs/claude-code)
- **API Keys** (optional, for Claude/OpenAI/Gemini API modes) — set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY`
- **Codex CLI OAuth** (optional, for `codex` CLI-wrapper mode) — install `codex` and run `codex login`
- **Codex OAuth API** (optional, experimental direct mode) — run `omh config` and choose Codex OAuth API to complete device-code sign-in; credentials are stored under `~/.omh`

---

## 🗺️ Roadmap

- [x] `npx oh-my-harness` — zero-install usage
- [x] `omh sync` — regenerate from harness.yaml
- [x] Building block catalog — 18 verified hook templates
- [x] Project detector — 14 language auto-detection
- [x] `omh test` — dry-run hook verification
- [x] `omh stats` — TUI analytics dashboard (ink)
- [x] Stateful hook logging — events.jsonl
- [x] TDD Guard — enforce test-first workflow
- [x] Multi-provider AI support — Claude API, OpenAI, Gemini, Codex OAuth
- [x] Interactive model selection per provider
- [x] GitHub star prompt — first-time only
- [x] Codex emitter — `AGENTS.md` + `.codex/hooks.json` + `.codex/config.toml`
- [x] Unified `.omh/` layout — single source of truth for hooks & state across runtimes
- [x] Pi ([pi.dev](https://pi.dev)) emitter — bridge extension (`.pi/extensions/omh-harness.ts`) reusing the same `.omh/hooks/*.sh`
- [x] `ask` mode — request approval before executing risky tools (Claude native prompt / Pi `ctx.ui.select`; Codex falls back to block)
- [x] `omh uninstall` — remove generated artifacts while preserving user content
- [x] `omh config` — view, reconfigure, or reset the saved AI provider (rotate expired keys, switch provider/model)
- [x] Autonomous loop engine — `omh-loop` skill, worktree-isolated runner, loop-guard, JSONL monitoring
- [ ] Community harness.yaml registry — share and reuse configs
- [ ] `omh modify "change X"` — NL config editing

---

## 🤝 Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a PR.

---

## 💪 Support This Project

oh-my-harness is free and open source. Here's how you can help:

- ⭐ **Star** — [Give a star](https://github.com/kyu1204/oh-my-harness) to help others discover the project
- 🐛 **Report Bugs** — [Open an issue](https://github.com/kyu1204/oh-my-harness/issues/new) when something doesn't work
- 💡 **Request Features** — [Suggest ideas](https://github.com/kyu1204/oh-my-harness/issues/new) for new blocks, emitters, or features
- 🔧 **Contribute** — Fix a bug, add a block, or improve docs — PRs are always welcome
- 📢 **Spread the Word** — Share oh-my-harness with your team or community

---

## 📄 License

MIT

---

<div align="center">

**Your agents are only as good as their guardrails.** 🐴

Built with frustration from hand-writing CLAUDE.md files.

</div>
