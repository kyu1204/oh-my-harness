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
    expect(result.testCommands).toContain("pnpm test");
    expect(result.lintCommands).toContain("pnpm lint");
    expect(result.detectedFiles).toContain("package.json");
    expect(result.detectedFiles).toContain("pnpm-lock.yaml");
  });

  it("detects yarn project (package.json + yarn.lock)", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", scripts: { test: "jest" } }));
    await writeFile(tmpDir, "yarn.lock", "");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.packageManagers).toContain("yarn");
    expect(result.testCommands).toContain("yarn test");
    expect(result.lintCommands).toContain("yarn lint");
    expect(result.detectedFiles).toContain("package.json");
    expect(result.detectedFiles).toContain("yarn.lock");
  });

  it("detects npm project (package.json + package-lock.json)", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", scripts: { test: "jest" } }));
    await writeFile(tmpDir, "package-lock.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.packageManagers).toContain("npm");
    expect(result.testCommands).toContain("npm test");
    expect(result.lintCommands).toContain("npm run lint");
    expect(result.detectedFiles).toContain("package.json");
    expect(result.detectedFiles).toContain("package-lock.json");
  });

  it("detects vitest as test runner from scripts.test", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", scripts: { test: "vitest run" } }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.testCommands).toContain("vitest run");
  });

  it("detects jest as test runner from scripts.test", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", scripts: { test: "jest --coverage" } }));
    await writeFile(tmpDir, "package-lock.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.testCommands).toContain("jest --coverage");
  });

  it("detects mocha as test runner from scripts.test", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test", scripts: { test: "mocha" } }));
    await writeFile(tmpDir, "package-lock.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.testCommands).toContain("mocha");
  });

  it("detects eslint from .eslintrc file", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");
    await writeFile(tmpDir, ".eslintrc", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.lintCommands).toContain("eslint --fix");
    expect(result.detectedFiles).toContain(".eslintrc");
  });

  it("detects eslint from eslint.config.js file", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");
    await writeFile(tmpDir, "eslint.config.js", "export default [];");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.lintCommands).toContain("eslint --fix");
    expect(result.detectedFiles).toContain("eslint.config.js");
  });

  it("detects biome from biome.json", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");
    await writeFile(tmpDir, "biome.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.lintCommands).toContain("biome check --fix");
    expect(result.detectedFiles).toContain("biome.json");
  });

  it("detects TypeScript from tsconfig.json", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");
    await writeFile(tmpDir, "tsconfig.json", "{}");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.languages).toContain("typescript");
    expect(result.typecheckCommands).toContain("tsc --noEmit");
    expect(result.detectedFiles).toContain("tsconfig.json");
  });

  it("detects javascript when no tsconfig.json", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.languages).toContain("javascript");
    expect(result.languages).not.toContain("typescript");
  });

  it("detects Next.js from next.config.js", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");
    await writeFile(tmpDir, "next.config.js", "export default {};");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.frameworks).toContain("nextjs");
    expect(result.lintCommands).toContain("next lint");
    expect(result.detectedFiles).toContain("next.config.js");
  });

  it("detects Next.js from next.config.ts", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");
    await writeFile(tmpDir, "next.config.ts", "export default {};");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.frameworks).toContain("nextjs");
    expect(result.lintCommands).toContain("next lint");
    expect(result.detectedFiles).toContain("next.config.ts");
  });

  it("includes standard blocked paths for node projects", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.blockedPaths).toContain("node_modules/");
    expect(result.blockedPaths).toContain("dist/");
  });

  it("includes .next/ in blocked paths for Next.js projects", async () => {
    await writeFile(tmpDir, "package.json", JSON.stringify({ name: "test" }));
    await writeFile(tmpDir, "pnpm-lock.yaml", "");
    await writeFile(tmpDir, "next.config.js", "export default {};");

    const result = await nodeDetector.detect(tmpDir);

    expect(result.blockedPaths).toContain(".next/");
  });

  it("has name 'node'", () => {
    expect(nodeDetector.name).toBe("node");
  });
});
