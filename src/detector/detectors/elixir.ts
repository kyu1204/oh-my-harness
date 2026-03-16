import type { Detector } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";

export const elixirDetector: Detector = {
  name: "elixir",
  detect: async (projectDir: string) => {
    try {
      await fs.access(path.join(projectDir, "mix.exs"));
    } catch {
      return {};
    }

    return {
      languages: ["elixir"],
      packageManagers: ["mix"],
      testCommands: ["mix test"],
      lintCommands: ["mix credo"],
      buildCommands: ["mix compile"],
      blockedPaths: ["_build/", "deps/"],
      detectedFiles: ["mix.exs"],
    };
  },
};
