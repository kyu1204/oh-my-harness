import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { goDetector } from "../../../src/detector/detectors/go.js";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "go-detector-test-"));
}

describe("goDetector", () => {
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

    const result = await goDetector.detect(dir);

    expect(result).toEqual({});
  });

  it("detects Go project when go.mod exists", async () => {
    const dir = await makeTempDir();
    tmpDirs.push(dir);
    await fs.writeFile(path.join(dir, "go.mod"), "module example.com/myapp\n\ngo 1.21\n");

    const result = await goDetector.detect(dir);

    expect(result.languages).toEqual(["go"]);
    expect(result.packageManagers).toEqual(["go modules"]);
    expect(result.testCommands).toEqual(["go test ./..."]);
    expect(result.lintCommands).toEqual(["golangci-lint run"]);
    expect(result.buildCommands).toEqual(["go build ./..."]);
    expect(result.blockedPaths).toEqual(["vendor/"]);
    expect(result.detectedFiles).toEqual(["go.mod"]);
  });

  it("has name 'go'", () => {
    expect(goDetector.name).toBe("go");
  });

  it("does not detect Go project when go.mod is absent", async () => {
    const dir = await makeTempDir();
    tmpDirs.push(dir);
    await fs.writeFile(path.join(dir, "main.py"), "print('hello')\n");

    const result = await goDetector.detect(dir);

    expect(result).toEqual({});
  });
});
