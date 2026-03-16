import type { Detector } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";

export const zigDetector: Detector = {
  name: "zig",
  detect: async (projectDir: string) => {
    try {
      await fs.access(path.join(projectDir, "build.zig"));
    } catch {
      return {};
    }

    return {
      languages: ["zig"],
      packageManagers: ["zig"],
      testCommands: ["zig build test"],
      buildCommands: ["zig build"],
      blockedPaths: ["zig-cache/", "zig-out/"],
      detectedFiles: ["build.zig"],
    };
  },
};
