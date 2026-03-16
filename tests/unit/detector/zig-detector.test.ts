import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { zigDetector } from "../../../src/detector/detectors/zig.js";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "zig-detector-test-"));
}

describe("zigDetector", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("returns empty object for empty directory", async () => {
    const dir = await makeTempDir();
    tmpDirs.push(dir);

    const result = await zigDetector.detect(dir);

    expect(result).toEqual({});
  });

  it("detects Zig project when build.zig exists", async () => {
    const dir = await makeTempDir();
    tmpDirs.push(dir);
    await fs.writeFile(path.join(dir, "build.zig"), 'const std = @import("std");\n\npub fn build(b: *std.Build) void {}\n');

    const result = await zigDetector.detect(dir);

    expect(result.languages).toEqual(["zig"]);
    expect(result.packageManagers).toEqual(["zig"]);
    expect(result.testCommands).toEqual(["zig build test"]);
    expect(result.buildCommands).toEqual(["zig build"]);
    expect(result.blockedPaths).toEqual(["zig-cache/", "zig-out/"]);
    expect(result.detectedFiles).toEqual(["build.zig"]);
  });

  it("has name 'zig'", () => {
    expect(zigDetector.name).toBe("zig");
  });

  it("does not detect Zig project when build.zig is absent", async () => {
    const dir = await makeTempDir();
    tmpDirs.push(dir);
    await fs.writeFile(path.join(dir, "main.py"), "print('hello')\n");

    const result = await zigDetector.detect(dir);

    expect(result).toEqual({});
  });
});
