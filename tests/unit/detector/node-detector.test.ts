import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { nodeDetector } from "../../../src/detector/detectors/node.js";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "node-detector-test-"));
}

async function writeFile(dir: string, name: string, content: string): Promise<void> {
  const filePath = path.join(dir, name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await makeTmpDir();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("nodeDetector", () => {
  it("returns empty result for empty directory", async () => {
    const result = await nodeDetector.detect(tmpDir);
    expect(result).toEqual({});
  });

  it("detects pnpm project (package.json + pnpm-lock.yaml)", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", scripts: { test: "vitest run" } }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.packageManagers).toContain("pnpm");
    expect(result.testCommands).toContain("npx vitest run");
    expect(result.testCommands).not.toContain("pnpm test");
    expect(result.lintCommands).toContain("pnpm lint");
    expect(result.detectedFiles).toContain("package.json");
    expect(result.detectedFiles).toContain("pnpm-lock.yaml");
  });

  it("detects yarn project (package.json + yarn.lock)", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", scripts: { test: "jest" } }));
    await writeFile(tmpDir, "yarn.lock", "");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.packageManagers).toContain("yarn");
    expect(result.testCommands).toContain("npx jest");
    expect(result.testCommands).not.toContain("yarn test");
    expect(result.lintCommands).toContain("yarn lint");
    expect(result.detectedFiles).toContain("package.json");
    expect(result.detectedFiles).toContain("yarn.lock");
  });

  it("detects npm project (package.json + package-lock.json)", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", scripts: { test: "jest" } }));
    await writeFile(tmpDir, "package-lock.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.packageManagers).toContain("npm");
    expect(result.testCommands).toContain("npx jest");
    expect(result.testCommands).not.toContain("npm test");
    expect(result.lintCommands).toContain("npm run lint");
    expect(result.detectedFiles).toContain("package.json");
    expect(result.detectedFiles).toContain("package-lock.json");
  });

  it("extracts direct test command from scripts.test (vitest run)", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", scripts: { test: "vitest run" } }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.testCommands).toEqual(["npx vitest run"]);
  });

  it("adds --run flag when scripts.test is bare vitest (watch mode prevention)", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", scripts: { test: "vitest" } }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.testCommands).toEqual(["npx vitest run"]);
  });

  it("extracts jest command from scripts.test", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", scripts: { test: "jest --coverage" } }));
    await writeFile(tmpDir, "package-lock.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.testCommands).toEqual(["npx jest --coverage"]);
  });

  it("extracts mocha command from scripts.test", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", scripts: { test: "mocha" } }));
    await writeFile(tmpDir, "package-lock.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.testCommands).toEqual(["npx mocha"]);
  });

  it("detects monorepo root with workspaces field", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({
      name: "my-monorepo",
      private: true,
      workspaces: ["packages/*"],
    }));
    await writeFile(tmpDir, "package-lock.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.languages).toBeDefined();
    expect((result.languages ?? []).length).toBeGreaterThan(0);
  });

  it("detects project with packageManager field", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({
      name: "my-project",
      packageManager: "pnpm@8.0.0",
    }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.packageManagers).toContain("pnpm");
  });

  it("skips tooling-only package.json (no JS dependencies)", async () => {
    // Django project with package.json only for husky/pylint
    await writeFile(tmpDir, "package.json", JSON.stringify({
      name: "my-django-project",
      devDependencies: { husky: "^7.0.4" },
      scripts: { prepare: "husky install", pylint: "pylint --reports=y *" },
    }));
    await writeFile(tmpDir, "package-lock.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.languages ?? []).not.toContain("javascript");
    expect(result.languages ?? []).not.toContain("typescript");
  });

  it("detects JS project when dependencies have runtime packages", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({
      name: "real-js-app",
      dependencies: { express: "^4.0.0" },
      scripts: { test: "jest" },
    }));
    await writeFile(tmpDir, "package-lock.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.languages).toContain("javascript");
  });

  it("does not add test command when scripts.test is missing", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", dependencies: { express: "^4.0.0" } }));
    await writeFile(tmpDir, "package-lock.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.testCommands).toEqual([]);
  });

  it("ignores whitespace-only scripts.test", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", dependencies: { express: "^4.0.0" }, scripts: { test: "   " } }));
    await writeFile(tmpDir, "package-lock.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.testCommands).toEqual([]);
  });

  it("ignores non-string scripts.test", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", dependencies: { express: "^4.0.0" }, scripts: { test: 123 } }));
    await writeFile(tmpDir, "package-lock.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.testCommands).toEqual([]);
  });

  it("detects eslint from .eslintrc file", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", dependencies: { express: "^4.0.0" } }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");
    await writeFile(tmpDir, ".eslintrc", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.lintCommands).toContain("eslint --fix");
    expect(result.detectedFiles).toContain(".eslintrc");
  });

  it("detects eslint from eslint.config.js file", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", dependencies: { express: "^4.0.0" } }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");
    await writeFile(tmpDir, "eslint.config.js", "export default [];");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.lintCommands).toContain("eslint --fix");
    expect(result.detectedFiles).toContain("eslint.config.js");
  });

  it("detects biome from biome.json", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", dependencies: { express: "^4.0.0" } }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");
    await writeFile(tmpDir, "biome.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.lintCommands).toContain("biome check --fix");
    expect(result.detectedFiles).toContain("biome.json");
  });

  it("detects TypeScript from tsconfig.json", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", dependencies: { express: "^4.0.0" } }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");
    await writeFile(tmpDir, "tsconfig.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.languages).toContain("typescript");
    expect(result.typecheckCommands).toContain("npx tsc --noEmit");
    expect(result.detectedFiles).toContain("tsconfig.json");
  });

  it("detects javascript when no tsconfig.json", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", dependencies: { express: "^4.0.0" } }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.languages).toContain("javascript");
    expect(result.languages).not.toContain("typescript");
  });

  it("detects Next.js from next.config.js", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", dependencies: { express: "^4.0.0" } }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");
    await writeFile(tmpDir, "next.config.js", "export default {};");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.frameworks).toContain("nextjs");
    expect(result.lintCommands).toContain("next lint");
    expect(result.detectedFiles).toContain("next.config.js");
  });

  it("detects Next.js from next.config.ts", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", dependencies: { express: "^4.0.0" } }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");
    await writeFile(tmpDir, "next.config.ts", "export default {};");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.frameworks).toContain("nextjs");
    expect(result.lintCommands).toContain("next lint");
    expect(result.detectedFiles).toContain("next.config.ts");
  });

  it("includes standard blocked paths for node projects", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", dependencies: { express: "^4.0.0" } }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.blockedPaths).toContain("node_modules/");
    expect(result.blockedPaths).toContain("dist/");
  });

  it("includes .next/ in blocked paths for Next.js projects", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", dependencies: { express: "^4.0.0" } }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");
    await writeFile(tmpDir, "next.config.js", "export default {};");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.blockedPaths).toContain(".next/");
  });

  it("has name 'node'", () => {
    expect(nodeDetector.name).toBe("node");
  });
});
