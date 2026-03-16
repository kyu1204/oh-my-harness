import type { Detector } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";

export const goDetector: Detector = {
  name: "go",
  detect: async (projectDir: string) => {
    try {
      await fs.access(path.join(projectDir, "go.mod"));
    } catch {
      return {};
    }

    return {
      languages: ["go"],
      packageManagers: ["go modules"],
      testCommands: ["go test ./..."],
      lintCommands: ["golangci-lint run"],
      buildCommands: ["go build ./..."],
      blockedPaths: ["vendor/"],
      detectedFiles: ["go.mod"],
    };
  },
};
