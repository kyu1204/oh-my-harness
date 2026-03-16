import * as fs from "fs/promises";
import * as path from "path";
import type { Detector } from "../types.js";

export const rustDetector: Detector = {
  name: "rust",
  detect: async (projectDir: string) => {
    const cargoToml = path.join(projectDir, "Cargo.toml");
    try {
      await fs.access(cargoToml);
    } catch {
      return {};
    }

    return {
      languages: ["rust"],
      packageManagers: ["cargo"],
      testCommands: ["cargo test"],
      lintCommands: ["cargo clippy"],
      buildCommands: ["cargo build"],
      blockedPaths: ["target/"],
      detectedFiles: ["Cargo.toml"],
    };
  },
};
