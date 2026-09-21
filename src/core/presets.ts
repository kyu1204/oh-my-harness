import { HarnessConfigSchema, type HarnessConfig } from "./harness-schema.js";
import type { ProjectFacts } from "../detector/types.js";

// Deterministic presets (#116): a valid harness.yaml with no LLM and no network.
// The detector supplies every free-form value (test/lint/typecheck commands,
// build dirs); rule text is templated. A block whose required params cannot
// be filled from the facts is left out rather than emitted half-configured.
// The Jev chooser (#129) starts from one of these and tunes it.

export type PresetName = "minimal" | "safe" | "strict";
export const PRESET_NAMES: PresetName[] = ["minimal", "safe", "strict"];

export function isPresetName(v: string): v is PresetName {
  return (PRESET_NAMES as string[]).includes(v);
}

type Params = Record<string, unknown>;

// Per-language file patterns for the blocks that need them.
const LANG: Record<string, { src: string; test: string; glob: string; tddDefault?: boolean }> = {
  typescript: { src: "\\.(ts|tsx|js|jsx)$", test: "\\.(test|spec)\\.(ts|tsx|js|jsx)$", glob: "*.ts", tddDefault: true },
  javascript: { src: "\\.(ts|tsx|js|jsx)$", test: "\\.(test|spec)\\.(ts|tsx|js|jsx)$", glob: "*.js", tddDefault: true },
  python: { src: "\\.py$", test: "(^|/)(test_[^/]*|[^/]*_test)\\.py$", glob: "*.py" },
  go: { src: "\\.go$", test: "_test\\.go$", glob: "*.go" },
  rust: { src: "\\.rs$", test: "(tests/.*|_test)\\.rs$", glob: "*.rs" },
  swift: { src: "\\.swift$", test: "Tests?\\.swift$", glob: "*.swift" },
  kotlin: { src: "\\.kt$", test: "Test\\.kt$", glob: "*.kt" },
  java: { src: "\\.java$", test: "Test\\.java$", glob: "*.java" },
  ruby: { src: "\\.rb$", test: "_spec\\.rb$", glob: "*.rb" },
  php: { src: "\\.php$", test: "Test\\.php$", glob: "*.php" },
  dart: { src: "\\.dart$", test: "_test\\.dart$", glob: "*.dart" },
  elixir: { src: "\\.exs?$", test: "_test\\.exs$", glob: "*.ex" },
  scala: { src: "\\.scala$", test: "(Spec|Test)\\.scala$", glob: "*.scala" },
};

function lang(facts?: ProjectFacts) {
  const l = facts?.languages?.[0]?.toLowerCase() ?? "";
  return LANG[l] ?? LANG.typescript;
}

/**
 * Params for a block, filled from the detector facts. `null` means a required
 * param has no source and the block must not be enabled. `{}` means the
 * catalog defaults are enough.
 */
export function defaultParamsFor(blockId: string, facts?: ProjectFacts): Params | null {
  const l = lang(facts);
  switch (blockId) {
    case "commit-test-gate":
      return facts?.testCommands?.[0] ? { testCommand: facts.testCommands[0] } : null;
    case "commit-typecheck-gate":
      return facts?.typecheckCommands?.[0] ? { typecheckCommand: facts.typecheckCommands[0] } : null;
    case "lint-on-save":
      return facts?.lintCommands?.[0] ? { filePattern: l.glob, command: facts.lintCommands[0] } : null;
    case "test-on-save":
      return facts?.testCommands?.[0] ? { testCommand: facts.testCommands[0], filePattern: l.src } : null;
    case "stop-test-gate":
      return facts?.testCommands?.[0] ? { testCommand: facts.testCommands[0] } : null;
    case "format-on-save":
      return null; // no formatter detection yet; ponytail: add when the detector learns formatters
    case "path-guard":
      return facts?.blockedPaths?.length ? { blockedPaths: [...facts.blockedPaths] } : null;
    case "tdd-guard":
      return l.tddDefault ? {} : { srcPattern: l.src, testPattern: l.test };
    default:
      return {};
  }
}

const HOOKS_BY_PRESET: Record<PresetName, string[]> = {
  minimal: ["branch-guard", "command-guard", "path-guard"],
  safe: ["branch-guard", "command-guard", "path-guard", "commit-test-gate", "commit-typecheck-gate", "lockfile-guard", "secret-file-guard", "lint-on-save"],
  strict: ["branch-guard", "command-guard", "path-guard", "commit-test-gate", "commit-typecheck-gate", "lockfile-guard", "secret-file-guard", "lint-on-save", "tdd-guard"],
};

const RULES = {
  workflow: (preset: PresetName) => ({
    id: "preset-workflow",
    title: "Development Workflow",
    priority: 10,
    content:
      preset === "strict"
        ? [
            "## TDD Development Rules",
            "- Always write or update tests before changing source code.",
            "- Confirm tests fail for the expected reason before implementing the minimum code change.",
            "- Every source file must have a corresponding test file.",
            "- Do not modify source code without test coverage for the behavior being changed.",
          ].join("\n")
        : [
            "## Testing Rules",
            "- Run the test suite before every commit; a red suite is never committed.",
            "- Add or update tests alongside any behavior change.",
          ].join("\n"),
  }),
  branching: {
    id: "preset-branching",
    title: "Branch Workflow",
    priority: 20,
    content: [
      "## Branch Workflow Rules",
      "- Always work on a dedicated branch; never commit directly on main or master.",
      "- Never force-push to a shared branch and never bypass git hooks.",
      "- Commit work in logical task-sized units.",
    ].join("\n"),
  },
  quality: {
    id: "preset-quality",
    title: "Quality Gates",
    priority: 30,
    content: [
      "## Quality Rules",
      "- Lint and type errors must be fixed before completing work.",
      "- Do not write into build output, dependency directories or lockfiles by hand.",
      "- Never touch secrets or credential files.",
    ].join("\n"),
  },
};

/** Generic change descriptions the strict preset lints with jgrep when it is installed (#145). */
export const STRICT_LINTS = [
  "catches an error and silently ignores it",
  "hardcodes a secret, token or password",
  "disables or skips a test instead of fixing it",
];

export function buildPresetHarness(
  preset: PresetName,
  facts?: ProjectFacts,
  meta: { name?: string; description?: string } = {},
  tools: { jgrep?: boolean } = {},
): HarnessConfig {
  const hooks: { block: string; params: Params; mode: "block" | "ask" }[] = [];
  for (const block of HOOKS_BY_PRESET[preset]) {
    const params = defaultParamsFor(block, facts);
    if (params === null) continue;
    hooks.push({ block, params, mode: "block" });
  }
  if (preset === "strict" && tools.jgrep) {
    hooks.push({ block: "semantic-diff-gate", params: { rules: [...STRICT_LINTS] }, mode: "block" });
  }

  const stacks = (facts?.languages ?? []).map((language, i) => ({
    name: language,
    framework: facts?.frameworks?.[i] ?? facts?.frameworks?.[0] ?? "none",
    language,
    packageManager: facts?.packageManagers?.[i] ?? facts?.packageManagers?.[0],
    testRunner: facts?.testCommands?.[0],
    linter: facts?.lintCommands?.[0],
  }));

  const rules = preset === "minimal"
    ? [RULES.branching, RULES.quality]
    : [RULES.workflow(preset), RULES.branching, RULES.quality];

  // Schema defaults (loop, permissions, enforcement) come from the schema itself.
  return HarnessConfigSchema.parse({
    version: "1.0",
    project: { name: meta.name, description: meta.description, stacks },
    rules,
    hooks,
  });
}
