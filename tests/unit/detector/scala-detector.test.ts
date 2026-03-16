import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { scalaDetector } from "../../../src/detector/detectors/scala.js";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "scala-detector-test-"));
}

describe("scalaDetector", () => {
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

    const result = await scalaDetector.detect(dir);

    expect(result).toEqual({});
  });

  it("detects Scala project when build.sbt exists", async () => {
    const dir = await makeTempDir();
    tmpDirs.push(dir);
    await fs.writeFile(path.join(dir, "build.sbt"), 'name := "MyApp"\nscalaVersion := "3.3.0"\n');

    const result = await scalaDetector.detect(dir);

    expect(result.languages).toEqual(["scala"]);
    expect(result.packageManagers).toEqual(["sbt"]);
    expect(result.testCommands).toEqual(["sbt test"]);
    expect(result.lintCommands).toEqual(["sbt scalafmtCheck"]);
    expect(result.buildCommands).toEqual(["sbt compile"]);
    expect(result.blockedPaths).toEqual(["target/", "project/target/"]);
    expect(result.detectedFiles).toEqual(["build.sbt"]);
  });

  it("has name 'scala'", () => {
    expect(scalaDetector.name).toBe("scala");
  });

  it("does not detect Scala project when build.sbt is absent", async () => {
    const dir = await makeTempDir();
    tmpDirs.push(dir);
    await fs.writeFile(path.join(dir, "main.py"), "print('hello')\n");

    const result = await scalaDetector.detect(dir);

    expect(result).toEqual({});
  });
});
