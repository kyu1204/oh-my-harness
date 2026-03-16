import type { Detector } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";

export const scalaDetector: Detector = {
  name: "scala",
  detect: async (projectDir: string) => {
    try {
      await fs.access(path.join(projectDir, "build.sbt"));
    } catch {
      return {};
    }

    return {
      languages: ["scala"],
      packageManagers: ["sbt"],
      testCommands: ["sbt test"],
      lintCommands: ["sbt scalafmtCheck"],
      buildCommands: ["sbt compile"],
      blockedPaths: ["target/", "project/target/"],
      detectedFiles: ["build.sbt"],
    };
  },
};
