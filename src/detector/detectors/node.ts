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

/**
 * Resolve scripts.test content into a direct executable command.
 * - Prevents watch mode hang (vitest → vitest run)
 * - Adds npx prefix for direct runner invocation
 */
function resolveTestCommand(testScript: string): string {
  const trimmed = testScript.trim();

  // vitest without "run" → add --run to prevent watch mode
  if (/^vitest$/.test(trimmed)) {
    return "npx vitest run";
  }

  // Known runners: prefix with npx if not already
  if (/^(vitest|jest|mocha)\b/.test(trimmed)) {
    return trimmed.startsWith("npx ") ? trimmed : `npx ${trimmed}`;
  }

  // Unknown script content: use as-is (e.g. custom shell commands)
  return trimmed;
}

export const nodeDetector: Detector = {
  name: "node",
  detect: async (projectDir: string): Promise<Partial<ProjectFacts>> => {
    const packageJsonPath = path.join(projectDir, "package.json");
    if (!(await fileExists(packageJsonPath))) {
      return {};
    }

    // Check if this is a real JS/TS project or just tooling (husky, linter wrappers)
    const pkgCheck = await readJsonFile(packageJsonPath);
    const deps = pkgCheck && typeof pkgCheck.dependencies === "object" && pkgCheck.dependencies !== null
      ? Object.keys(pkgCheck.dependencies as Record<string, unknown>)
      : [];
    const devDeps = pkgCheck && typeof pkgCheck.devDependencies === "object" && pkgCheck.devDependencies !== null
      ? Object.keys(pkgCheck.devDependencies as Record<string, unknown>)
      : [];
    const pkgScriptsRaw = pkgCheck && typeof pkgCheck.scripts === "object" && pkgCheck.scripts !== null
      ? Object.values(pkgCheck.scripts as Record<string, string>).join(" ")
      : "";
    const jsDevIndicators = /typescript|react|vue|angular|next|vite|webpack|eslint|jest|vitest|mocha|babel|svelte|nuxt/;
    const jsScriptIndicators = /vitest|jest|mocha|tsc|eslint|webpack|vite|next|react-scripts/;
    // Also check for JS ecosystem config files
    const jsConfigFiles = [
      "tsconfig.json", ".eslintrc", ".eslintrc.js", ".eslintrc.json",
      "eslint.config.js", "eslint.config.ts", "eslint.config.mjs",
      "biome.json", "next.config.js", "next.config.ts", "next.config.mjs",
      "vite.config.ts", "vite.config.js", "webpack.config.js",
    ];
    let hasJsConfigFile = false;
    for (const cf of jsConfigFiles) {
      if (await fileExists(path.join(projectDir, cf))) {
        hasJsConfigFile = true;
        break;
      }
    }
    const hasWorkspaces = pkgCheck && (Array.isArray(pkgCheck.workspaces) || typeof pkgCheck.workspaces === "object");
    const hasPackageManager = pkgCheck && typeof pkgCheck.packageManager === "string";
    const hasJsIndicator = deps.length > 0
      || devDeps.some((d) => jsDevIndicators.test(d))
      || jsScriptIndicators.test(pkgScriptsRaw)
      || hasJsConfigFile
      || hasWorkspaces
      || hasPackageManager;
    if (!hasJsIndicator) {
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

    // Determine lint command prefix based on package manager
    const lintCmd = pm === "npm" ? "npm run lint" : `${pm} lint`;

    // Read package.json to inspect scripts
    const pkg = await readJsonFile(packageJsonPath);
    const scripts = pkg && typeof pkg.scripts === "object" && pkg.scripts !== null
      ? (pkg.scripts as Record<string, string>)
      : {};

    // Detect test runner from scripts.test — use direct command instead of npm test wrapper
    const rawTestScript = scripts["test"];
    if (typeof rawTestScript === "string" && rawTestScript.trim().length > 0) {
      const resolved = resolveTestCommand(rawTestScript);
      testCommands.push(resolved);
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
      typecheckCommands.push("npx tsc --noEmit");
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
