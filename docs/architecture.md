# Architecture

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
│   │   ├── commands/       # init, doctor, catalog, hook, sync, test, loop (start/run/stop/status/clean)
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
│   ├── loop/               # autonomous loop supervisor (TypeScript, no generated shell)
│   │   ├── supervisor.ts   # one run: lock → worktree/seed → turns → release
│   │   ├── state.ts        # run.json link-lock, events, atomic writes
│   │   ├── classify.ts     # turn verdict from ledger diff + HEAD; wait policy
│   │   ├── runtime.ts      # argv per runtime, turn execution in its own process group
│   │   ├── worktree.ts     # git worktree lifecycle, asset sync, ledger seeding
│   │   ├── protocol.ts     # the rules, rendered into prompt / CLAUDE.md / skill
│   │   └── stop.ts         # identity-checked group stop, group sweep
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
