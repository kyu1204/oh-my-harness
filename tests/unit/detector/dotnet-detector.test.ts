import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { dotnetDetector } from "../../../src/detector/detectors/dotnet.js";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "dotnet-detector-test-"));
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

describe("dotnetDetector", () => {
  it("has name 'dotnet'", () => {
    expect(dotnetDetector.name).toBe("dotnet");
  });

  it("returns empty result for empty directory", async () => {
    const result = await dotnetDetector.detect(tmpDir);
    expect(result).toEqual({});
  });

  it("detects C# project from .csproj file", async () => {
    await writeFile(tmpDir, "MyApp.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>");

    const result = await dotnetDetector.detect(tmpDir);

    expect(result.languages).toContain("csharp");
    expect(result.frameworks).toContain("dotnet");
    expect(result.packageManagers).toContain("nuget");
    expect(result.buildCommands).toContain("dotnet build");
    expect(result.testCommands).toContain("dotnet test");
    expect(result.lintCommands).toContain("dotnet format");
    expect(result.blockedPaths).toContain("bin/");
    expect(result.blockedPaths).toContain("obj/");
    expect(result.detectedFiles).toContain("MyApp.csproj");
  });

  it("detects .NET solution from .sln file", async () => {
    await writeFile(tmpDir, "MyApp.sln", "Microsoft Visual Studio Solution File");

    const result = await dotnetDetector.detect(tmpDir);

    expect(result.frameworks).toContain("dotnet");
    expect(result.packageManagers).toContain("nuget");
    expect(result.buildCommands).toContain("dotnet build");
    expect(result.testCommands).toContain("dotnet test");
    expect(result.lintCommands).toContain("dotnet format");
    expect(result.blockedPaths).toContain("bin/");
    expect(result.blockedPaths).toContain("obj/");
    expect(result.detectedFiles).toContain("MyApp.sln");
  });

  it("detects F# project from .fsproj file", async () => {
    await writeFile(tmpDir, "MyLib.fsproj", "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>");

    const result = await dotnetDetector.detect(tmpDir);

    expect(result.languages).toContain("fsharp");
    expect(result.frameworks).toContain("dotnet");
    expect(result.packageManagers).toContain("nuget");
    expect(result.buildCommands).toContain("dotnet build");
    expect(result.testCommands).toContain("dotnet test");
    expect(result.lintCommands).toContain("dotnet format");
    expect(result.blockedPaths).toContain("bin/");
    expect(result.blockedPaths).toContain("obj/");
    expect(result.detectedFiles).toContain("MyLib.fsproj");
  });

  it("does not include languages for .sln-only project", async () => {
    await writeFile(tmpDir, "MyApp.sln", "Microsoft Visual Studio Solution File");

    const result = await dotnetDetector.detect(tmpDir);

    expect(result.languages ?? []).not.toContain("csharp");
    expect(result.languages ?? []).not.toContain("fsharp");
  });

  it("includes all matching .csproj files in detectedFiles", async () => {
    await writeFile(tmpDir, "Alpha.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>");
    await writeFile(tmpDir, "Beta.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>");
    await writeFile(tmpDir, "Gamma.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>");

    const result = await dotnetDetector.detect(tmpDir);

    expect(result.detectedFiles).toContain("Alpha.csproj");
    expect(result.detectedFiles).toContain("Beta.csproj");
    expect(result.detectedFiles).toContain("Gamma.csproj");
  });

  it("returns .csproj files in sorted order", async () => {
    await writeFile(tmpDir, "Zebra.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>");
    await writeFile(tmpDir, "Alpha.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>");
    await writeFile(tmpDir, "Mango.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>");

    const result = await dotnetDetector.detect(tmpDir);

    const csprojFiles = (result.detectedFiles ?? []).filter((f) => f.endsWith(".csproj"));
    expect(csprojFiles).toEqual(["Alpha.csproj", "Mango.csproj", "Zebra.csproj"]);
  });
});
