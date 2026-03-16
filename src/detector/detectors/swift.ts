import * as fs from "fs/promises";
import * as path from "path";
import type { Detector } from "../types.js";

export const swiftDetector: Detector = {
  name: "swift",
  detect: async (projectDir: string) => {
    let entries: string[];
    try {
      entries = await fs.readdir(projectDir);
    } catch {
      return {};
    }

    const hasPackageSwift = entries.includes("Package.swift");
    const hasSwiftlint = entries.includes(".swiftlint.yml");
    const xcodeproj = entries.find((e) => e.endsWith(".xcodeproj"));
    const xcworkspace = entries.find((e) => e.endsWith(".xcworkspace"));

    const isSwift = hasPackageSwift || !!xcodeproj || !!xcworkspace || hasSwiftlint;
    if (!isSwift) return {};

    const languages = ["swift"];
    const frameworks: string[] = [];
    const testCommands: string[] = [];
    const buildCommands: string[] = [];
    const lintCommands: string[] = [];
    const detectedFiles: string[] = [];
    const blockedPaths = [".build/", "DerivedData/"];

    if (xcworkspace) {
      frameworks.push("xcode");
      const workspaceName = path.basename(xcworkspace, ".xcworkspace");
      testCommands.push(`xcodebuild test -workspace "${xcworkspace}" -scheme "${workspaceName}"`);
      buildCommands.push(`xcodebuild build -workspace "${xcworkspace}" -scheme "${workspaceName}"`);
      detectedFiles.push(xcworkspace);
      if (xcodeproj) detectedFiles.push(xcodeproj);
    } else if (xcodeproj) {
      frameworks.push("xcode");
      const scheme = path.basename(xcodeproj, ".xcodeproj");
      testCommands.push(`xcodebuild test -scheme "${scheme}"`);
      buildCommands.push(`xcodebuild build -scheme "${scheme}"`);
      detectedFiles.push(xcodeproj);
    } else if (hasPackageSwift) {
      frameworks.push("spm");
      testCommands.push("swift test");
      buildCommands.push("swift build");
      detectedFiles.push("Package.swift");
    }

    if (hasSwiftlint) {
      lintCommands.push("swiftlint");
      detectedFiles.push(".swiftlint.yml");
    }

    return { languages, frameworks, testCommands, buildCommands, lintCommands, blockedPaths, detectedFiles };
  },
};
