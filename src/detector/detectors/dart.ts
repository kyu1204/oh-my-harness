import * as fs from "fs/promises";
import * as path from "path";
import type { Detector } from "../types.js";

export const dartDetector: Detector = {
  name: "dart",
  detect: async (projectDir: string) => {
    let entries: string[];
    try {
      entries = await fs.readdir(projectDir);
    } catch {
      return {};
    }

    if (!entries.includes("pubspec.yaml")) return {};

    let pubspecContent = "";
    try {
      pubspecContent = await fs.readFile(path.join(projectDir, "pubspec.yaml"), "utf-8");
    } catch {
      return {};
    }

    const isFlutter = pubspecContent.includes("flutter:");

    const languages = ["dart"];
    const frameworks: string[] = [];
    const packageManagers: string[] = [];
    const testCommands: string[] = [];
    const buildCommands: string[] = [];
    const lintCommands = ["dart analyze"];
    const blockedPaths = [".dart_tool/", "build/"];
    const detectedFiles = ["pubspec.yaml"];

    if (isFlutter) {
      frameworks.push("flutter");
      packageManagers.push("flutter");
      testCommands.push("flutter test");
      buildCommands.push("flutter build");
    } else {
      packageManagers.push("pub");
      testCommands.push("dart test");
      buildCommands.push("dart compile exe");
    }

    return { languages, frameworks, packageManagers, testCommands, buildCommands, lintCommands, blockedPaths, detectedFiles };
  },
};
