# How oh-my-harness compares

Most tools in this space manage **instruction files** (`CLAUDE.md`, `AGENTS.md`,
`.cursorrules`). oh-my-harness manages those too, but its point is the layer
underneath: **hooks that return a block decision** when the agent does something
the rules forbid. Instructions are advice; hooks are enforcement.

| | Hand-written `CLAUDE.md` / `.cursorrules` | Rule-sync tools (ruler, rulesync, …) | Git hooks (husky, pre-commit) | **oh-my-harness** |
|---|---|---|---|---|
| Generates instruction files | you write them | ✅ from one source | ❌ | ✅ from `harness.yaml` |
| Blocks the agent **before** the action (PreToolUse) | ❌ | ❌ | ❌ | ✅ |
| Test-first (TDD) enforcement on edits | ❌ | ❌ | ❌ | ✅ `tdd-guard` |
| Blocks commits when tests / typecheck fail | ❌ | ❌ | ✅ at commit time | ✅ and the agent sees *why* |
| Blocks dangerous shell commands | ❌ | ❌ | ❌ | ✅ `command-guard`, `sql-guard` |
| Protects paths, lockfiles, secret files | ❌ | ❌ | partial | ✅ |
| Same hooks for Claude Code, Codex, Pi | n/a | rules only | n/a | ✅ one script, three runtimes |
| Detects drift between config and generated files | ❌ | some | ❌ | ✅ `omh sync --check` for CI |
| Records what the agent tried and what was blocked | ❌ | ❌ | ❌ | ✅ `events.jsonl`, `omh stats` |
| Unattended multi-session loop with protocol guards | ❌ | ❌ | ❌ | ✅ `omh loop` |
| Natural-language setup | n/a | ❌ | ❌ | ✅ `omh init "…"` (optional) |

## When you do not need oh-my-harness

- You use one agent, one project, and are happy hand-tuning one `CLAUDE.md`.
- You only want rules copied between agents and never want anything blocked.
  A rule-sync tool is lighter.
- Your safety net is CI and you are fine with the agent committing broken
  code locally first.

## When you do

- The agent has ignored a rule in `CLAUDE.md` at least once and you noticed
  after the fact.
- You run agents unattended (loops, overnight jobs, CI-driven fixes).
- You maintain several repos and want the same guardrails in all of them
  without copy-pasting hook scripts.

Comparison rows are as of 2026-09; open an issue if a tool has gained a
capability listed as missing.
