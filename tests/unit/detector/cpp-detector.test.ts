import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { cppDetector } from "../../../src/detector/detectors/cpp.js";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "cpp-detector-test-"));
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

describe("cppDetector", () => {
  it("returns empty result for empty directory", async () => {
    const result = await cppDetector.detect(tmpDir);
    expect(result).toEqual({});
  });

  it("has name 'cpp'", () => {
    expect(cppDetector.name).toBe("cpp");
  });

  describe("CMakeLists.txt", () => {
    it("detects CMake C/C++ project", async () => {
      await writeFile(tmpDir, "CMakeLists.txt", "cmake_minimum_required(VERSION 3.10)\nproject(MyApp)");

      const result = await cppDetector.detect(tmpDir);

      expect(result.languages).toContain("c");
      expect(result.languages).toContain("cpp");
      expect(result.buildCommands).toContain("cmake --build build");
      expect(result.testCommands).toContain("ctest --test-dir build");
      expect(result.blockedPaths).toContain("build/");
      expect(result.blockedPaths).toContain("cmake-build-*/");
      expect(result.detectedFiles).toContain("CMakeLists.txt");
    });

    it("prefers CMakeLists.txt over Makefile when both present", async () => {
      await writeFile(tmpDir, "CMakeLists.txt", "cmake_minimum_required(VERSION 3.10)");
      await writeFile(tmpDir, "Makefile", "all:\n\tgcc main.c -o main");

      const result = await cppDetector.detect(tmpDir);

      expect(result.buildCommands).toContain("cmake --build build");
      expect(result.buildCommands).not.toContain("make");
      expect(result.detectedFiles).toContain("CMakeLists.txt");
      expect(result.detectedFiles).not.toContain("Makefile");
    });
  });

  describe("Makefile only", () => {
    it("detects Make C project", async () => {
      await writeFile(tmpDir, "Makefile", "all:\n\tgcc main.c -o main");

      const result = await cppDetector.detect(tmpDir);

      expect(result.languages).toContain("c");
      expect(result.languages).not.toContain("cpp");
      expect(result.buildCommands).toContain("make");
      expect(result.testCommands).toContain("make test");
      expect(result.blockedPaths).toContain("build/");
      expect(result.blockedPaths).toContain("cmake-build-*/");
      expect(result.detectedFiles).toContain("Makefile");
    });
  });

  describe("meson.build", () => {
    it("detects Meson C/C++ project", async () => {
      await writeFile(tmpDir, "meson.build", "project('myapp', 'cpp')");

      const result = await cppDetector.detect(tmpDir);

      expect(result.languages).toContain("c");
      expect(result.languages).toContain("cpp");
      expect(result.buildCommands).toContain("meson compile -C build");
      expect(result.testCommands).toContain("meson test -C build");
      expect(result.blockedPaths).toContain("build/");
      expect(result.blockedPaths).toContain("cmake-build-*/");
      expect(result.detectedFiles).toContain("meson.build");
    });
  });
});
