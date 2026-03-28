import fs from "node:fs/promises";
import path from "node:path";
import type { Detector } from "../types.js";

export const terraformDetector: Detector = {
  name: "terraform",
  detect: async (projectDir: string) => {
    // Check for *.tf files
    let hasTfFiles = false;
    const detectedFiles: string[] = [];

    try {
      const entries = await fs.readdir(projectDir);
      for (const entry of entries) {
        if (entry.endsWith(".tf")) {
          hasTfFiles = true;
          detectedFiles.push(entry);
        }
      }
    } catch {
      return {};
    }

    // Fallback: check for .terraform.lock.hcl
    if (!hasTfFiles) {
      try {
        await fs.access(path.join(projectDir, ".terraform.lock.hcl"));
        hasTfFiles = true;
        detectedFiles.push(".terraform.lock.hcl");
      } catch {
        // not found
      }
    }

    if (!hasTfFiles) {
      return {};
    }

    return {
      languages: ["hcl"],
      frameworks: ["terraform"],
      packageManagers: ["terraform"],
      testCommands: ["terraform test"],
      lintCommands: ["tflint"],
      buildCommands: ["terraform plan"],
      blockedPaths: [".terraform/", "*.tfstate", "*.tfstate.backup"],
      detectedFiles,
    };
  },
};
