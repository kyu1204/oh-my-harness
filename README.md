<div align="center">

# 🐴 oh-my-harness

**CLAUDE.md is a request. oh-my-harness is enforcement.**

One command turns "TDD enforced, block dangerous commands" into hooks that actually **block** your AI coding agent — for Claude Code, Codex and Pi at once.

[![npm version](https://img.shields.io/npm/v/oh-my-harness.svg)](https://www.npmjs.com/package/oh-my-harness)
[![npm downloads](https://img.shields.io/npm/dm/oh-my-harness.svg)](https://www.npmjs.com/package/oh-my-harness)
[![CI](https://github.com/kyu1204/oh-my-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/kyu1204/oh-my-harness/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/kyu1204/oh-my-harness.svg)](LICENSE)

<img src="docs/demo.gif" alt="omh init generates hooks; an AI agent's commit, rm -rf and untested edit are blocked" width="900">

</div>

```bash
npx oh-my-harness init "React + FastAPI, TDD enforced, lint on save"
```

That is the whole setup. Your agent now hits a wall when it tries to:

| Agent tries to... | Result |
|---|---|
| `git commit` while tests fail | ⛔ **Blocked** |
| edit `src/foo.ts` before touching `foo.test.ts` | ⛔ **Blocked** (TDD guard) |
| run `rm -rf /`, `chmod -R 777`, or any pattern you list | ⛔ **Blocked** |
| write into `node_modules/`, `.next/`, `dist/` | ⛔ **Blocked** |
| commit on a branch already merged to main | ⛔ **Blocked** |
| edit its own hooks or `.claude/settings.json` to switch the guardrails off | ⛔ **Blocked** |
| save a file | ✅ auto-lint |
| push a branch | ✅ auto-PR |

Every decision is logged to `.omh/state/events.jsonl` — `omh stats` shows what your agent tried and what got stopped.

## Why not just write CLAUDE.md?

Because agents read instructions and then forget them halfway through a long session. A rule in a markdown file is a suggestion; a `PreToolUse` hook that returns `{"decision":"block"}` is a fact. oh-my-harness writes the markdown **and** the hooks, from one `harness.yaml`, and keeps them in sync (`omh sync --check` fails CI when they drift). Side-by-side with rule-sync tools and git hooks: [docs/comparison.md](docs/comparison.md).

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

📖 Deeper: [what gets generated & CI drift check](docs/generated-files.md) · [how it works, project detector, AI providers](docs/how-it-works.md)

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

Hand omh a `WORKPLAN.md` and it runs one work order per fresh agent session, in an isolated git worktree, with hard-blocked protocol rules. `omh loop start` / `omh loop status` / `omh loop stop`. Full guide: [docs/loop-engine.md](docs/loop-engine.md).

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

Details for `uninstall`, `doctor`, `test`, `stats` and hook event logging: [docs/commands.md](docs/commands.md). Internals: [docs/architecture.md](docs/architecture.md) · [roadmap](docs/roadmap.md).

---

## 📦 Requirements

- **Node.js** >= 20
- **An AI provider** (optional, only for natural-language `omh init`) — any one of: the `claude` CLI, an API key for Claude/OpenAI/Gemini/OpenRouter, a ChatGPT subscription via Codex, or a local OpenAI-compatible server (Ollama etc.). See [AI Provider Setup](docs/how-it-works.md#-ai-provider-setup).

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
