import * as fs from "fs/promises";
import * as path from "path";
import type { Detector } from "../types.js";

export const dotnetDetector: Detector = {
  name: "dotnet",
  detect: async (projectDir: string) => {
    let entries: string[];
    try {
      entries = await fs.readdir(projectDir);
    } catch {
      return {};
    }

    const sorted = [...entries].sort();
    const csprojFiles = sorted.filter((e) => e.endsWith(".csproj"));
    const fsprojFiles = sorted.filter((e) => e.endsWith(".fsproj"));
    const slnFiles = sorted.filter((e) => e.endsWith(".sln"));

    if (!csprojFiles.length && !fsprojFiles.length && !slnFiles.length) {
      return {};
    }

    const detectedFiles: string[] = [];
    const languages: string[] = [];

    if (csprojFiles.length > 0) {
      detectedFiles.push(...csprojFiles);
      languages.push("csharp");
    }
    if (fsprojFiles.length > 0) {
      detectedFiles.push(...fsprojFiles);
      languages.push("fsharp");
    }
    if (slnFiles.length > 0) {
      detectedFiles.push(...slnFiles);
    }

    return {
      ...(languages.length > 0 ? { languages } : {}),
      frameworks: ["dotnet"],
      packageManagers: ["nuget"],
      buildCommands: ["dotnet build"],
      testCommands: ["dotnet test"],
      lintCommands: ["dotnet format"],
      blockedPaths: ["bin/", "obj/"],
      detectedFiles,
    };
  },
};
