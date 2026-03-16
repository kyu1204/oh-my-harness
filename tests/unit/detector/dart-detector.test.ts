import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { dartDetector } from "../../../src/detector/detectors/dart.js";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "omh-dart-test-"));
}

async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

describe("dartDetector", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await cleanup(tmpDir);
  });

  it("returns empty facts for an empty directory", async () => {
    const result = await dartDetector.detect(tmpDir);
    expect(result).toEqual({});
  });

  it("has name 'dart'", () => {
    expect(dartDetector.name).toBe("dart");
  });

  describe("pure Dart project (pubspec.yaml without flutter SDK)", () => {
    beforeEach(async () => {
      await fs.writeFile(
        path.join(tmpDir, "pubspec.yaml"),
        "name: my_dart_app\ndependencies:\n  args: ^2.4.0\n"
      );
    });

    it("detects dart language", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.languages).toContain("dart");
    });

    it("does not detect flutter framework", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.frameworks).not.toContain("flutter");
    });

    it("sets dart test command", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.testCommands).toContain("dart test");
    });

    it("sets dart compile exe build command", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.buildCommands).toContain("dart compile exe");
    });

    it("sets pub as package manager", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.packageManagers).toContain("pub");
    });

    it("does not set flutter as package manager", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.packageManagers).not.toContain("flutter");
    });

    it("sets dart analyze as lint command", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.lintCommands).toContain("dart analyze");
    });

    it("sets .dart_tool/ in blockedPaths", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.blockedPaths).toContain(".dart_tool/");
    });

    it("sets build/ in blockedPaths", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.blockedPaths).toContain("build/");
    });

    it("includes pubspec.yaml in detectedFiles", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.detectedFiles).toContain("pubspec.yaml");
    });
  });

  describe("Flutter project (pubspec.yaml with flutter: SDK dependency)", () => {
    beforeEach(async () => {
      await fs.writeFile(
        path.join(tmpDir, "pubspec.yaml"),
        "name: my_flutter_app\ndependencies:\n  flutter:\n    sdk: flutter\n"
      );
    });

    it("detects dart language", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.languages).toContain("dart");
    });

    it("detects flutter framework", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.frameworks).toContain("flutter");
    });

    it("sets flutter test command", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.testCommands).toContain("flutter test");
    });

    it("sets flutter build command", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.buildCommands).toContain("flutter build");
    });

    it("sets flutter as package manager", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.packageManagers).toContain("flutter");
    });

    it("does not set pub as package manager", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.packageManagers).not.toContain("pub");
    });

    it("sets dart analyze as lint command", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.lintCommands).toContain("dart analyze");
    });

    it("sets .dart_tool/ in blockedPaths", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.blockedPaths).toContain(".dart_tool/");
    });

    it("sets build/ in blockedPaths", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.blockedPaths).toContain("build/");
    });

    it("includes pubspec.yaml in detectedFiles", async () => {
      const result = await dartDetector.detect(tmpDir);
      expect(result.detectedFiles).toContain("pubspec.yaml");
    });
  });
});
