# Contributing to oh-my-harness

Thanks for your interest in contributing! This guide will help you get started.

## Getting Started

```bash
# Fork and clone the repo
git clone https://github.com/<your-username>/oh-my-harness.git
cd oh-my-harness

# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

## Development Workflow

This project follows **TDD (Test-Driven Development)**. All contributions must adhere to this workflow:

1. **Write a failing test first** — describe the expected behavior
2. **Verify the test fails** for the right reason
3. **Implement the minimum code** to make the test pass
4. **Refactor** while keeping tests green

### Branch Naming

Create a branch from `main` using the convention:

```
feat/add-something      # New feature
fix/broken-thing        # Bug fix
docs/update-readme      # Documentation
refactor/clean-up       # Code refactoring
test/add-missing-tests  # Test additions
```

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Type check
npm run lint
```

## Your first PR in 30 minutes: add a building block

Building blocks are the easiest entry point. Each one is a single file that
becomes a hook script in every project that enables it.

1. `git clone` and `npm install`, then `npx vitest run` to see green.
2. Copy `src/catalog/blocks/lockfile-guard.ts` to `src/catalog/blocks/<your-block>.ts`.
   Change `id`, `name`, `description`, `params` and the bash `template`.
   Call `_emit_decision "block" "$REASON"` to block, `_log_event` to record.
3. Register it in `src/catalog/blocks/index.ts`.
4. Add a test in `tests/unit/catalog-blocks.test.ts` (an existing block's test
   is a good copy source). Run `npx vitest run tests/unit/catalog-blocks.test.ts`.
5. Try it for real: `npm run build && npm link`, then in any project
   `omh hook add <your-block>` and trigger it.
6. Open the PR. Issues labelled
   [`block-request`](https://github.com/kyu1204/oh-my-harness/labels/block-request)
   are ready-made ideas.

## What to Contribute

### harness.yaml Schema

To add new fields to `harness.yaml`, update `src/core/harness-schema.ts` (Zod schema) and `src/core/merged-config.ts` (TypeScript interfaces). Regenerate docs if needed.

### Building Blocks

Add new hook templates in `src/catalog/blocks/`. Each block is a self-contained hook definition with parameters and a Handlebars template.

### Detectors

Add project detection for new languages/frameworks in `src/detector/detectors/`.

### Bug Fixes

Check [open issues](https://github.com/kyu1204/oh-my-harness/issues) for bugs to fix.

## Pull Request Guidelines

- Keep PRs focused — one logical change per PR
- All tests must pass (`npm test`)
- Type check must pass (`npm run lint`)
- Build must succeed (`npm run build`)
- Include tests for new functionality
- Write a clear PR description with **Summary** and **Test plan** sections

## Code Style

- **TypeScript strict mode** — no `any` types
- **Interfaces** over type aliases for object shapes
- **Explicit return types** on exported functions
- Keep it simple — avoid over-engineering

## Reporting Issues

When reporting a bug, please include:

- Node.js version (`node -v`)
- oh-my-harness version (`omh --version`)
- Steps to reproduce
- Expected vs actual behavior
- Error output (if any)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
