# Autonomous Loop Engine

Once `omh init`/`omh sync` has run (with `loop.enabled: true`, the default),
any agent session (Claude Code, Codex, Pi) can be told **"run this as a loop"** — the generated `omh-loop` skill turns that
into a fully set-up autonomous loop, no manual wiring:

```text
you: "ship the remaining Phase B tasks as a loop"
        │
        ▼  omh-loop skill (the session becomes the ARCHITECT)
  1. writes the `loop.ledger`     — default WORKPLAN.md; goal gates + task checkboxes
  2. writes `loop.workOrders`/*.md — default docs/work-orders; one exact work order per task
  3. runs `omh loop start`        — a detached supervisor; with `isolate: true` (default), in its own git worktree
  4. attaches monitoring          — omh loop status, then tail -f .omh/state/loop/runs/<id>/events.jsonl
        │
        ▼  loop (fresh headless session per iteration, cheap model)
  pick next unchecked task → implement its work order exactly → run its
  acceptance commands → tick checkbox + commit → repeat until the sentinel
```

The design follows a battle-tested pattern from real autonomous runs: state
lives in **files** (ledger + git log), never in a conversation. Each iteration
is a fresh headless session (`claude -p` / `codex exec --dangerously-bypass-hook-trust` / `pi --print --no-session`)
on an explicit cheap model, so token use stays flat.

## Why it doesn't fall over

Every guard below exists because the failure actually happened somewhere:

| Guard | Failure it prevents |
|-------|---------------------|
| Sentinel = fixed string, whole line, clean exit only | a crashed turn (or a turn merely *mentioning* the sentinel) ending the loop as "complete" |
| Three **separate** backoffs — usage limit / empty-output failed turn / consecutive `BLOCKED` | a loop once spun **266 iterations** doing nothing because waiting-on-a-human was treated like a failure |
| `loop-guard` hook blocks the loop writing its own work orders (Edit/Write **and** Bash redirection/`cd`) | self-approval: the loop authoring the spec it then implements |
| `loop-guard` blocks architect-only paths, listed **by name** | an abstract "don't improvise" is ignored; a named path is obeyed |
| Worktree isolation (`isolate: true`, default) | the loop and the architect fighting over the same working tree |
| Ledger seeded once, re-seeded only when the main-tree copy is newer | the loop's progress being rolled back — or a second goal reusing the first goal's ledger |

## Configuration

On by default. Everything is optional in `harness.yaml`:

```yaml
loop:
  enabled: true                # false removes all loop assets on next sync
  ledger: WORKPLAN.md          # single source of truth
  workOrders: docs/work-orders # architect-written task specs
  model: sonnet                # cheap implementation model (always explicit)
  sentinel: OMH_GOAL_COMPLETE  # whole-line completion signal
  interval: 120                # seconds between iterations
  blockedBackoff: 1800         # backoff once stallStreak blocked/idle turns pile up
  limitBackoff: 1800           # backoff after a provider usage limit
  emptyBackoff: 300            # backoff after a crashed (empty-output / timed-out) turn
  stallStreak: 3               # consecutive blocked/idle turns before blockedBackoff
  turnTimeout: 7200            # hard per-turn timeout (seconds); the turn is killed past this
  architectOnly: []            # paths the loop must never touch (name them!)
  isolate: true                # run in .omh/loop/worktree on branch omh-loop
  runtime: claude              # claude | codex | pi
```

## Operating it

```bash
omh loop start            # preflight, then a detached supervisor (the skill does this for you)
omh loop status           # run id, pid, iteration, last event, events path
tail -f .omh/state/loop/runs/<id>/events.jsonl   # progress / blocked / idle / limit / crash
omh loop stop [--now]     # stop flag + SIGTERM to the whole process group (--now: 1s grace)
omh loop clean [--branch] # remove the worktree and stale state (and optionally the omh-loop branch)
```

The supervisor is TypeScript (`src/loop/`), not a generated script: the runtime
is spawned from an argv array (no shell), each turn is judged by the **ledger
diff and git HEAD** rather than by grepping output, and the run lock is a single
`run.json` created atomically with `link(2)`. POSIX only — it relies on process
groups and `ps` for identity checks.

Known limit: the ledger is seeded into the worktree once per goal (by content
hash). Editing the main-tree ledger mid-run does nothing until the next start,
which then re-seeds it — add mid-run tasks as new work orders instead, and edit
the worktree's ledger if you must.

A task the loop cannot finish (needs a human, or 3 failed attempts) is marked
`BLOCKED: <reason>` in the ledger and skipped — the loop never idles waiting
for a person. When you unblock it (e.g. fix an architect-only file), the loop
picks it back up after its backoff. When the goal completes in isolation, merge
the `omh-loop` branch and **re-verify** — a clean textual merge is not a
semantic one.
