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

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const nodeDetector: Detector = {
  name: "node",
  detect: async (projectDir: string): Promise<Partial<ProjectFacts>> => {
    const packageJsonPath = path.join(projectDir, "package.json");
    if (!(await fileExists(packageJsonPath))) {
      return {};
    }

    const detectedFiles: string[] = ["package.json"];
    const languages: string[] = [];
    const frameworks: string[] = [];
    const packageManagers: string[] = [];
    const testCommands: string[] = [];
    const lintCommands: string[] = [];
    const typecheckCommands: string[] = [];
    const blockedPaths: string[] = ["node_modules/", "dist/"];

    // Detect package manager from lock files
    const pnpmLock = path.join(projectDir, "pnpm-lock.yaml");
    const yarnLock = path.join(projectDir, "yarn.lock");
    const npmLock = path.join(projectDir, "package-lock.json");

    let pm: "pnpm" | "yarn" | "npm" = "npm";

    if (await fileExists(pnpmLock)) {
      pm = "pnpm";
      packageManagers.push("pnpm");
      detectedFiles.push("pnpm-lock.yaml");
    } else if (await fileExists(yarnLock)) {
      pm = "yarn";
      packageManagers.push("yarn");
      detectedFiles.push("yarn.lock");
    } else if (await fileExists(npmLock)) {
      pm = "npm";
      packageManagers.push("npm");
      detectedFiles.push("package-lock.json");
    }

    // Determine lint command prefix and test command based on package manager
    const lintCmd = pm === "npm" ? "npm run lint" : `${pm} lint`;
    const testCmdDefault = pm === "npm" ? "npm test" : `${pm} test`;

    // Read package.json to inspect scripts
    const pkg = await readJsonFile(packageJsonPath);
    const scripts = pkg && typeof pkg.scripts === "object" && pkg.scripts !== null
      ? (pkg.scripts as Record<string, string>)
      : {};

    // Detect test runner from scripts.test
    const testScript = scripts["test"];
    testCommands.push(testCmdDefault);
    if (testScript && /vitest|jest|mocha/.test(testScript) && testScript !== testCmdDefault) {
      testCommands.push(testScript);
    }

    lintCommands.push(lintCmd);

    // Detect Next.js
    const nextConfigJs = path.join(projectDir, "next.config.js");
    const nextConfigTs = path.join(projectDir, "next.config.ts");
    const nextConfigMjs = path.join(projectDir, "next.config.mjs");

    let isNextJs = false;
    for (const nextConfig of [nextConfigJs, nextConfigTs, nextConfigMjs]) {
      if (await fileExists(nextConfig)) {
        isNextJs = true;
        frameworks.push("nextjs");
        detectedFiles.push(path.basename(nextConfig));
        break;
      }
    }

    if (isNextJs) {
      blockedPaths.push(".next/");
      // Replace generic lint with next lint
      const idx = lintCommands.indexOf(lintCmd);
      if (idx !== -1) lintCommands.splice(idx, 1);
      lintCommands.push("next lint");
    }

    // Detect ESLint
    const eslintFiles = [".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml", "eslint.config.js", "eslint.config.ts", "eslint.config.mjs"];
    for (const ef of eslintFiles) {
      if (await fileExists(path.join(projectDir, ef))) {
        if (!lintCommands.includes("eslint --fix")) {
          lintCommands.push("eslint --fix");
        }
        detectedFiles.push(ef);
        break;
      }
    }

    // Detect Biome
    const biomePath = path.join(projectDir, "biome.json");
    if (await fileExists(biomePath)) {
      lintCommands.push("biome check --fix");
      detectedFiles.push("biome.json");
    }

    // Detect TypeScript
    const tsconfigPath = path.join(projectDir, "tsconfig.json");
    if (await fileExists(tsconfigPath)) {
      languages.push("typescript");
      typecheckCommands.push("tsc --noEmit");
      detectedFiles.push("tsconfig.json");
    } else {
      languages.push("javascript");
    }

    return {
      languages,
      frameworks,
      packageManagers,
      testCommands,
      lintCommands,
      typecheckCommands,
      blockedPaths,
      detectedFiles,
    };
  },
};
