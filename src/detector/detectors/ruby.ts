import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Detector, ProjectFacts } from "../types.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

export const rubyDetector: Detector = {
  name: "ruby",
  detect: async (projectDir: string): Promise<Partial<ProjectFacts>> => {
    const frameworks: string[] = [];
    const packageManagers: string[] = [];
    const testCommands: string[] = [];
    const lintCommands: string[] = [];
    const detectedFiles: string[] = [];

    let isRuby = false;

    const gemfilePath = path.join(projectDir, "Gemfile");
    const rakefilePath = path.join(projectDir, "Rakefile");
    const routesPath = path.join(projectDir, "config", "routes.rb");

    const hasGemfile = await fileExists(gemfilePath);
    const hasRakefile = await fileExists(rakefilePath);
    const hasRoutes = await fileExists(routesPath);

    if (hasGemfile) {
      isRuby = true;
      packageManagers.push("bundler");
      testCommands.push("bundle exec rspec");
      lintCommands.push("bundle exec rubocop");
      detectedFiles.push("Gemfile");
    }

    if (hasRoutes) {
      isRuby = true;
      frameworks.push("rails");
      if (!packageManagers.includes("bundler")) {
        packageManagers.push("bundler");
      }
      testCommands.push("bundle exec rails test");
      if (!lintCommands.includes("bundle exec rubocop")) {
        lintCommands.push("bundle exec rubocop");
      }
      detectedFiles.push("config/routes.rb");
    }

    if (hasRakefile) {
      isRuby = true;
      testCommands.push("rake test");
      detectedFiles.push("Rakefile");
    }

    if (!isRuby) {
      return {};
    }

    return {
      languages: ["ruby"],
      frameworks: dedupe(frameworks),
      packageManagers: dedupe(packageManagers),
      testCommands: dedupe(testCommands),
      lintCommands: dedupe(lintCommands),
      blockedPaths: ["vendor/bundle/", "tmp/", "log/"],
      detectedFiles: dedupe(detectedFiles),
    };
  },
};
