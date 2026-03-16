import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { elixirDetector } from "../../../src/detector/detectors/elixir.js";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "elixir-detector-test-"));
}

describe("elixirDetector", () => {
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

    const result = await elixirDetector.detect(dir);

    expect(result).toEqual({});
  });

  it("detects Elixir project when mix.exs exists", async () => {
    const dir = await makeTempDir();
    tmpDirs.push(dir);
    await fs.writeFile(path.join(dir, "mix.exs"), 'defmodule MyApp.MixProject do\n  use Mix.Project\nend\n');

    const result = await elixirDetector.detect(dir);

    expect(result.languages).toEqual(["elixir"]);
    expect(result.packageManagers).toEqual(["mix"]);
    expect(result.testCommands).toEqual(["mix test"]);
    expect(result.lintCommands).toEqual(["mix credo"]);
    expect(result.buildCommands).toEqual(["mix compile"]);
    expect(result.blockedPaths).toEqual(["_build/", "deps/"]);
    expect(result.detectedFiles).toEqual(["mix.exs"]);
  });

  it("has name 'elixir'", () => {
    expect(elixirDetector.name).toBe("elixir");
  });

  it("does not detect Elixir project when mix.exs is absent", async () => {
    const dir = await makeTempDir();
    tmpDirs.push(dir);
    await fs.writeFile(path.join(dir, "main.py"), "print('hello')\n");

    const result = await elixirDetector.detect(dir);

    expect(result).toEqual({});
  });
});
