import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { phpDetector } from "../../../src/detector/detectors/php.js";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "php-detector-"));
}

async function writeFile(dir: string, name: string, content: string): Promise<void> {
  await fs.writeFile(path.join(dir, name), content, "utf-8");
}

describe("phpDetector", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty result for empty directory", async () => {
    const result = await phpDetector.detect(tmpDir);
    expect(result).toEqual({});
  });

  it("detects composer.json as PHP/Composer project", async () => {
    await writeFile(tmpDir, "composer.json", JSON.stringify({ name: "vendor/project" }));
    const result = await phpDetector.detect(tmpDir);
    expect(result.languages).toContain("php");
    expect(result.packageManagers).toContain("composer");
    expect(result.testCommands).toContain("./vendor/bin/phpunit");
    expect(result.lintCommands).toContain("./vendor/bin/phpstan");
    expect(result.blockedPaths).toContain("vendor/");
    expect(result.detectedFiles).toContain("composer.json");
  });

  it("detects artisan file as Laravel project", async () => {
    await writeFile(tmpDir, "composer.json", JSON.stringify({ name: "vendor/project" }));
    await writeFile(tmpDir, "artisan", "#!/usr/bin/env php\n");
    const result = await phpDetector.detect(tmpDir);
    expect(result.languages).toContain("php");
    expect(result.frameworks).toContain("laravel");
    expect(result.packageManagers).toContain("composer");
    expect(result.testCommands).toContain("php artisan test");
    expect(result.lintCommands).toContain("./vendor/bin/pint");
    expect(result.blockedPaths).toContain("vendor/");
    expect(result.detectedFiles).toContain("artisan");
  });

  it("detects phpunit.xml as PHPUnit project", async () => {
    await writeFile(tmpDir, "phpunit.xml", "<phpunit></phpunit>");
    const result = await phpDetector.detect(tmpDir);
    expect(result.languages).toContain("php");
    expect(result.testCommands).toContain("./vendor/bin/phpunit");
    expect(result.detectedFiles).toContain("phpunit.xml");
  });

  it("has name 'php'", () => {
    expect(phpDetector.name).toBe("php");
  });
});
