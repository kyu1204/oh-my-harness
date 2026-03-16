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

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

export const pythonDetector: Detector = {
  name: "python",
  detect: async (projectDir: string): Promise<Partial<ProjectFacts>> => {
    const languages: string[] = [];
    const packageManagers: string[] = [];
    const testCommands: string[] = [];
    const lintCommands: string[] = [];
    const typecheckCommands: string[] = [];
    const blockedPaths: string[] = [];
    const detectedFiles: string[] = [];

    let isPython = false;
    let isPoetry = false;

    const pyprojectPath = path.join(projectDir, "pyproject.toml");
    const uvLockPath = path.join(projectDir, "uv.lock");
    const poetryLockPath = path.join(projectDir, "poetry.lock");
    const requirementsTxtPath = path.join(projectDir, "requirements.txt");
    const pytestIniPath = path.join(projectDir, "pytest.ini");
    const conftestPath = path.join(projectDir, "conftest.py");
    const setupCfgPath = path.join(projectDir, "setup.cfg");
    const flake8Path = path.join(projectDir, ".flake8");
    const ruffTomlPath = path.join(projectDir, "ruff.toml");
    const mypyIniPath = path.join(projectDir, "mypy.ini");

    const pyprojectContent = await readTextFile(pyprojectPath);

    // uv detection
    const hasUvSection = pyprojectContent?.includes("[tool.uv]") ?? false;
    const hasUvLock = await fileExists(uvLockPath);

    if (hasUvSection || hasUvLock) {
      isPython = true;
      packageManagers.push("uv");
      if (pyprojectContent && hasUvSection) detectedFiles.push("pyproject.toml");
      if (hasUvLock) detectedFiles.push("uv.lock");
    }

    // poetry detection
    const hasPoetrySection = pyprojectContent?.includes("[tool.poetry]") ?? false;
    const hasPoetryLock = await fileExists(poetryLockPath);

    if (hasPoetrySection || hasPoetryLock) {
      isPython = true;
      isPoetry = true;
      packageManagers.push("poetry");
      if (pyprojectContent && hasPoetrySection && !detectedFiles.includes("pyproject.toml")) {
        detectedFiles.push("pyproject.toml");
      }
      if (hasPoetryLock) detectedFiles.push("poetry.lock");
    }

    // pip / requirements.txt detection
    if (await fileExists(requirementsTxtPath)) {
      isPython = true;
      packageManagers.push("pip");
      detectedFiles.push("requirements.txt");
    }

    // pytest.ini detection
    if (await fileExists(pytestIniPath)) {
      isPython = true;
      testCommands.push(isPoetry ? "poetry run pytest" : "pytest");
      detectedFiles.push("pytest.ini");
    }

    // conftest.py detection
    if (await fileExists(conftestPath)) {
      isPython = true;
      testCommands.push(isPoetry ? "poetry run pytest" : "pytest");
      detectedFiles.push("conftest.py");
    }

    // setup.cfg [tool:pytest] detection
    const setupCfgContent = await readTextFile(setupCfgPath);
    if (setupCfgContent?.includes("[tool:pytest]")) {
      isPython = true;
      testCommands.push(isPoetry ? "poetry run pytest" : "pytest");
      detectedFiles.push("setup.cfg");
    }

    // .flake8 detection
    if (await fileExists(flake8Path)) {
      isPython = true;
      lintCommands.push(isPoetry ? "poetry run flake8" : "flake8");
      detectedFiles.push(".flake8");
    }

    // ruff.toml detection
    if (await fileExists(ruffTomlPath)) {
      isPython = true;
      lintCommands.push(isPoetry ? "poetry run ruff check" : "ruff check");
      detectedFiles.push("ruff.toml");
    }

    // pyproject.toml [tool.ruff] detection
    if (pyprojectContent?.includes("[tool.ruff]")) {
      isPython = true;
      lintCommands.push(isPoetry ? "poetry run ruff check" : "ruff check");
      if (!detectedFiles.includes("pyproject.toml")) detectedFiles.push("pyproject.toml");
    }

    // mypy.ini detection
    if (await fileExists(mypyIniPath)) {
      isPython = true;
      typecheckCommands.push(isPoetry ? "poetry run mypy ." : "mypy .");
      detectedFiles.push("mypy.ini");
    }

    // pyproject.toml [tool.mypy] detection
    if (pyprojectContent?.includes("[tool.mypy]")) {
      isPython = true;
      typecheckCommands.push(isPoetry ? "poetry run mypy ." : "mypy .");
      if (!detectedFiles.includes("pyproject.toml")) detectedFiles.push("pyproject.toml");
    }

    if (!isPython) {
      return {};
    }

    languages.push("python");
    blockedPaths.push("__pycache__/", ".venv/", "*.pyc");

    return {
      languages: dedupe(languages),
      packageManagers: dedupe(packageManagers),
      testCommands: dedupe(testCommands),
      lintCommands: dedupe(lintCommands),
      typecheckCommands: dedupe(typecheckCommands),
      blockedPaths: dedupe(blockedPaths),
      detectedFiles: dedupe(detectedFiles),
    };
  },
};
