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
| `git commit --no-verify`, `git push --force origin main` | ⛔ **Blocked** |
| edit its own hooks or `.claude/settings.json` to switch the guardrails off | ⛔ **Blocked** |
| save a file | ✅ auto-lint |
| push a branch | ✅ auto-PR |

Every decision is logged to `.omh/state/events.jsonl` — `omh stats` shows what your agent tried and what got stopped, and `omh explain` tells you in plain language why the last few calls were blocked and how to allow once or change the rule.

## Why not just write CLAUDE.md?

Because agents read instructions and then forget them halfway through a long session. A rule in a markdown file is a suggestion; a `PreToolUse` hook that returns `{"decision":"block"}` is a fact. oh-my-harness writes the markdown **and** the hooks, from one `harness.yaml`, and keeps them in sync (`omh sync --check` fails CI when they drift). Side-by-side with rule-sync tools and git hooks: [docs/comparison.md](docs/comparison.md).

---

## 🚀 Quick Start

```bash
# Zero-install: run directly with npx
npx oh-my-harness init "TypeScript Next.js frontend with Python FastAPI backend"

# No AI provider? Deterministic presets need nothing but the repo:
npx oh-my-harness init --preset strict     # minimal | safe | strict

# With a TypeSafe key, Jev tunes the preset to your description in one ~500 ms, sub-cent call:
TYPESAFE_API_KEY=... npx oh-my-harness init "TypeScript API, TDD enforced, no auto PRs"

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

📖 Deeper: [what gets generated & CI drift check](docs/generated-files.md) · [how it works, project detector, presets & Jev, AI providers](docs/how-it-works.md)

---

## 🎛️ Presets and the Jev chooser

You do not need a chat model to set up a harness.

**Presets** are deterministic and offline. The project detector fills in test, lint and typecheck commands and build directories; rule text is templated; a block whose required parameter cannot be detected is left out rather than half-configured.

| Preset | What it enables |
|--------|-----------------|
| `minimal` | dangerous-command guard, main-branch guard, build-output guard |
| `safe` | minimal + tests and typecheck must pass before a commit, lockfile and secret-file guards, lint on save |
| `strict` | safe + test-first (TDD) on every source edit |

```bash
omh init --preset safe        # confirm prompt; add -y to skip it
```

**Jev** picks the blocks for you from a description. [Jev](https://docs.typesafe.ai/introduction) is TypeSafe's System One model: it does not generate text, it answers typed questions with calibrated probabilities. `omh init "description"` sends the description plus the detector facts and asks, in one call, "should block X be enabled?" for every selectable block and "how strict?" once. Probabilities at or above 0.65 enable a block, at or below 0.35 disable it, anything in between keeps the preset default. Rule text and free-form params never come from the model.

```bash
export TYPESAFE_API_KEY=...   # or put it in the project's .env
omh init "Next.js + FastAPI, TDD enforced, no auto PRs"
# Jev (jev-latest) chose: strictness=strict, 1716 input tokens
#   enabled:   ... tdd-guard, sql-guard ...
#   disabled:  auto-pr
```

- Get a key from the [TypeSafe console](https://typesafe.ai) (early access at the time of writing). One init costs a fraction of a cent (input $0.042 per million tokens, output free) and takes about half a second.
- `--preset` always wins and never calls Jev. No key and no LLM provider? `omh init "description"` falls back to `safe` and says so.
- `omh doctor` and `omh config --show` tell you whether the chooser is active. Remove the key to go back to the LLM providers or presets.
- `omh modify "..."` later edits the same way: Jev answers enable / disable / ask / keep per block, you confirm the change set, `omh sync` runs. Mark an entry `locked: true` in harness.yaml and modify will refuse to remove or weaken it.
- Interactive `omh init` offers both: "Describe your project (Jev picks the blocks)" and "Use a preset (no AI)".
- Descriptions in English work best; other languages are handled but with lower confidence, so include the specifics.

The always-on guards (harness self-protection, `--no-verify`, force-push) are added to every preset and every Jev result.

### Rules that enforce themselves

Two fields on a rule in `harness.yaml` turn prose into a check:

```yaml
rules:
  - id: no-deps
    title: No new dependencies
    content: Do not add npm dependencies without asking.
    enforce: true          # every Bash/Edit/Write call is judged against this rule by Jev
  - id: no-secrets
    title: No secrets in code
    content: Never commit tokens or passwords.
    lint: hardcodes a secret, token or password   # the staged diff is linted with jgrep before commit
```

`enforce: true` adds `semantic-rule-guard`: one Jev question per enforced rule per tool call, block at p ≥ 0.9, ask between 0.6 and 0.9, allow below; without a key, or on an API error, it allows and logs `skipped`. `lint:` adds `semantic-diff-gate`, which runs `jgrep --diff --staged "<description>"` and blocks the commit on a hit with `file:line`. When the same command also stages (`git add … && git commit`, `git commit -a`), the gate previews the index that command would build, so nothing slips through because it was not staged yet. jgrep is optional: `npm i -g jevgrep && jgrep init`; the `strict` preset adds three generic lints when `omh init` finds it. Both layers are additive and never relax a deterministic guard.

---

## 🧱 Building Block Catalog

All enforcement is powered by **catalog blocks** — reusable, parameterized hook templates:

| Block | Category | Description |
|-------|----------|-------------|
| 🛡️ `branch-guard` | git | Blocks commits on main/merged branches |
| 🧪 `commit-test-gate` | quality | Runs tests before git commit |
| 🔍 `commit-typecheck-gate` | quality | Runs typecheck before git commit |
| 🔒 `command-guard` | security | Blocks dangerous shell commands |
| 🪝 `harness-guard` | security | Blocks shell writes to the harness's own hooks and config (always on) |
| 🚫 `no-verify-guard` | git | Blocks `--no-verify` / `-n` / hooksPath overrides on commit and push (always on) |
| 💥 `force-push-guard` | git | Blocks force pushes to protected branches (always on) |
| 🛑 `stop-test-gate` | quality | When the agent tries to end its turn with failing tests, sends it back (retry-capped) |
| 📝 `stop-uncommitted-warn` | git | Lists uncommitted changes as a system message when the turn ends |
| 🧠 `semantic-rule-guard` | security | Rules marked `enforce: true` are judged by Jev on every Bash/Edit/Write call |
| 🔎 `semantic-diff-gate` | quality | Lints the staged diff with [jgrep](https://github.com/kyu1204/jgrep) against `lint:` rule descriptions before commit (optional) |
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
omh init "your project description"      # Jev with TYPESAFE_API_KEY, else an LLM provider, else the "safe" preset
omh init --preset strict                  # No provider: minimal | safe | strict
omh explain                               # Why were the last tool calls blocked, and what to do about it
omh modify "no auto PRs, TDD guard asks"  # Edit harness.yaml from a sentence (Jev decides per block; locked: true entries stay)
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
