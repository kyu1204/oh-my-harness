// Re-record tests/fixtures/jev/*.json against the live TypeSafe API.
//   TYPESAFE_API_KEY=... npx tsx scripts/record-jev-fixtures.mts
// Each fixture stores the exact request the chooser builds, the raw response,
// and the routed decisions, so the unit test can assert both request
// compatibility and selection stability without network.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { builtinBlocks } from "../src/catalog/blocks/index.js";
import { buildJevRequest, routeAnswers, TYPESAFE_ENDPOINT } from "../src/nl/typesafe-chooser.js";
import type { ProjectFacts } from "../src/detector/types.js";

const facts = (p: Partial<ProjectFacts>): ProjectFacts => ({
  languages: [], frameworks: [], packageManagers: [], testCommands: [], lintCommands: [],
  buildCommands: [], typecheckCommands: [], blockedPaths: [], detectedFiles: [], ...p,
});

const SCENARIOS = [
  { name: "ts-api", description: "TypeScript Express API with Prisma and Postgres. TDD enforced, lint on save, block dangerous commands.",
    facts: facts({ languages: ["typescript"], frameworks: ["express"], packageManagers: ["npm"], testCommands: ["npx vitest run"], lintCommands: ["npx eslint --fix"], typecheckCommands: ["npx tsc --noEmit"], blockedPaths: ["dist/", "node_modules/"] }) },
  { name: "py-script", description: "Small Python data script, no tests, just keep me from deleting stuff by accident.",
    facts: facts({ languages: ["python"], packageManagers: ["pip"] }) },
  { name: "ios", description: "Swift iOS app with XCTest. I want commits to always pass tests and typecheck. No auto PRs.",
    facts: facts({ languages: ["swift"], testCommands: ["xcodebuild test -scheme App"], lintCommands: ["swiftlint"], typecheckCommands: ["xcodebuild build -scheme App"] }) },
  { name: "go-cli", description: "Go CLI, strict: nothing gets committed without tests, protect main, format on save with gofmt, notify me on desktop when a long task finishes.",
    facts: facts({ languages: ["go"], packageManagers: ["go"], testCommands: ["go test ./..."], lintCommands: ["golangci-lint run"], buildCommands: ["go build ./..."] }) },
  { name: "docs", description: "Markdown documentation site only. Minimal guardrails, just don't let it touch the build folder or push to main.",
    facts: facts({ languages: ["markdown"], blockedPaths: ["build/", "node_modules/"] }) },
];

const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("TYPESAFE_API_KEY is required");
const outDir = join(process.cwd(), "tests", "fixtures", "jev");
mkdirSync(outDir, { recursive: true });

for (const s of SCENARIOS) {
  const request = buildJevRequest({ description: s.description, facts: s.facts, blocks: builtinBlocks });
  const res = await fetch(TYPESAFE_ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(request) });
  if (!res.ok) throw new Error(`${s.name}: ${res.status} ${await res.text()}`);
  const response = await res.json();
  const routed = routeAnswers(response.answers);
  const on = [...routed.blocks].filter(([, v]) => v === "on").map(([k]) => k);
  const off = [...routed.blocks].filter(([, v]) => v === "off").map(([k]) => k);
  writeFileSync(join(outDir, `${s.name}.json`), JSON.stringify({ name: s.name, description: s.description, facts: s.facts, request, response, expected: { on, off, strictness: routed.strictness } }, null, 2) + "\n");
  console.log(`${s.name}: strictness=${routed.strictness} on=[${on.join(", ")}] off=[${off.join(", ")}] (${response.usage?.input_tokens} tok)`);
}
