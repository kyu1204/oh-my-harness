# Command reference

## 🧹 `omh uninstall` — Safe generated-file cleanup

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

## 🩺 `omh doctor`

```text
oh-my-harness: running health checks...
  ✓ .claude/oh-my-harness.json found
  ✓ CLAUDE.md exists with intact markers
  ✓ .claude/settings.json is valid
  ✓ All hook scripts are executable
oh-my-harness: all checks passed
```

## 🧪 `omh test` — Dry-Run Verification

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

## 📊 `omh stats` — TUI Analytics Dashboard

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

# 📊 Stateful Hook Logging

Every hook invocation is recorded in `.omh/state/events.jsonl`:

```jsonl
{"ts":"2026-03-18T08:00:00Z","event":"PreToolUse","hook":"catalog-tdd-guard.sh","decision":"block","reason":"TDD — foo.test.* 테스트 파일을 먼저 수정하세요"}
{"ts":"2026-03-18T08:00:05Z","event":"PreToolUse","hook":"catalog-command-guard.sh","decision":"allow","reason":""}
```

This powers `omh test` live verification and `omh stats` analytics.
