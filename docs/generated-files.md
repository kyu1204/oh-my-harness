# Generated files & keeping them in sync

## 🔄 Keeping generated files in sync

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

## 📁 What Gets Generated

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
│   │   └── worktree/                  # gitignored — the loop's isolated git worktree (see Loop Engine)
│   ├── state/                         # gitignored — log/runtime data
│   │   ├── events.jsonl               # Unified hook event log (powers omh stats)
│   │   ├── loop/                      # run.json (lock + identity), stop flag, runs/<id>/events.jsonl
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
