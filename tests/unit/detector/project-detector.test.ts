import { describe, it, expect } from "vitest";
import { detectProject } from "../../../src/detector/project-detector.js";
import type { Detector } from "../../../src/detector/types.js";
import { emptyFacts } from "../../../src/detector/types.js";

function makeDetector(name: string, result: Partial<ReturnType<typeof emptyFacts>>): Detector {
  return {
    name,
    detect: async () => result,
  };
}

function makeFailingDetector(name: string): Detector {
  return {
    name,
    detect: async () => {
      throw new Error(`${name} failed`);
    },
  };
}

describe("detectProject", () => {
  it("returns empty facts when no detectors provided", async () => {
    const facts = await detectProject("/fake", []);
    expect(facts).toEqual(emptyFacts());
  });

  it("merges facts from multiple detectors", async () => {
    const detectors: Detector[] = [
      makeDetector("node", {
        languages: ["typescript"],
        packageManagers: ["pnpm"],
        testCommands: ["pnpm test"],
      }),
      makeDetector("python", {
        languages: ["python"],
        packageManagers: ["uv"],
        testCommands: ["pytest"],
      }),
    ];

    const facts = await detectProject("/fake", detectors);

    expect(facts.languages).toEqual(["typescript", "python"]);
    expect(facts.packageManagers).toEqual(["pnpm", "uv"]);
    expect(facts.testCommands).toEqual(["pnpm test", "pytest"]);
  });

  it("deduplicates values across detectors", async () => {
    const detectors: Detector[] = [
      makeDetector("a", { languages: ["typescript"], blockedPaths: ["node_modules/"] }),
      makeDetector("b", { languages: ["typescript"], blockedPaths: ["node_modules/", "dist/"] }),
    ];

    const facts = await detectProject("/fake", detectors);

    expect(facts.languages).toEqual(["typescript"]);
    expect(facts.blockedPaths).toEqual(["node_modules/", "dist/"]);
  });

  it("skips failing detectors gracefully", async () => {
    const detectors: Detector[] = [
      makeDetector("good", { languages: ["go"], testCommands: ["go test ./..."] }),
      makeFailingDetector("bad"),
      makeDetector("also-good", { languages: ["rust"], testCommands: ["cargo test"] }),
    ];

    const facts = await detectProject("/fake", detectors);

    expect(facts.languages).toEqual(["go", "rust"]);
    expect(facts.testCommands).toEqual(["go test ./...", "cargo test"]);
  });

  it("preserves all fact fields from a single detector", async () => {
    const detectors: Detector[] = [
      makeDetector("full", {
        languages: ["typescript"],
        frameworks: ["nextjs"],
        packageManagers: ["pnpm"],
        testCommands: ["pnpm test"],
        lintCommands: ["eslint --fix"],
        buildCommands: ["pnpm build"],
        typecheckCommands: ["npx tsc --noEmit"],
        blockedPaths: [".next/", "node_modules/"],
        detectedFiles: ["package.json", "tsconfig.json"],
      }),
    ];

    const facts = await detectProject("/fake", detectors);

    expect(facts.languages).toEqual(["typescript"]);
    expect(facts.frameworks).toEqual(["nextjs"]);
    expect(facts.packageManagers).toEqual(["pnpm"]);
    expect(facts.testCommands).toEqual(["pnpm test"]);
    expect(facts.lintCommands).toEqual(["eslint --fix"]);
    expect(facts.buildCommands).toEqual(["pnpm build"]);
    expect(facts.typecheckCommands).toEqual(["npx tsc --noEmit"]);
    expect(facts.blockedPaths).toEqual([".next/", "node_modules/"]);
    expect(facts.detectedFiles).toEqual(["package.json", "tsconfig.json"]);
  });
});
