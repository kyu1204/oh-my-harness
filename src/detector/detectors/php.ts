import * as fs from "fs/promises";
import * as path from "path";
import type { Detector, ProjectFacts } from "../types.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export const phpDetector: Detector = {
  name: "php",
  detect: async (projectDir: string): Promise<Partial<ProjectFacts>> => {
    const composerPath = path.join(projectDir, "composer.json");
    const artisanPath = path.join(projectDir, "artisan");
    const phpunitXmlPath = path.join(projectDir, "phpunit.xml");

    const hasComposer = await fileExists(composerPath);
    const hasArtisan = await fileExists(artisanPath);
    const hasPhpunitXml = await fileExists(phpunitXmlPath);

    if (!hasComposer && !hasArtisan && !hasPhpunitXml) {
      return {};
    }

    const detectedFiles: string[] = [];
    const languages: string[] = ["php"];
    const frameworks: string[] = [];
    const packageManagers: string[] = [];
    const testCommands: string[] = [];
    const lintCommands: string[] = [];
    const blockedPaths: string[] = ["vendor/"];

    if (hasComposer) {
      detectedFiles.push("composer.json");
      packageManagers.push("composer");
      testCommands.push("./vendor/bin/phpunit");
      lintCommands.push("./vendor/bin/phpstan");
    }

    if (hasArtisan) {
      detectedFiles.push("artisan");
      frameworks.push("laravel");
      // Replace phpunit test command with artisan test
      const phpunitIdx = testCommands.indexOf("./vendor/bin/phpunit");
      if (phpunitIdx !== -1) testCommands.splice(phpunitIdx, 1);
      testCommands.push("php artisan test");
      lintCommands.push("./vendor/bin/pint");
    }

    if (hasPhpunitXml) {
      detectedFiles.push("phpunit.xml");
      if (!testCommands.includes("./vendor/bin/phpunit")) {
        testCommands.push("./vendor/bin/phpunit");
      }
    }

    return {
      languages,
      frameworks,
      packageManagers,
      testCommands,
      lintCommands,
      blockedPaths,
      detectedFiles,
    };
  },
};
