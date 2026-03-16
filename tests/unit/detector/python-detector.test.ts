import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pythonDetector } from "../../../src/detector/detectors/python.js";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "python-detector-"));
}

async function writeFile(dir: string, name: string, content: string): Promise<void> {
  await fs.writeFile(path.join(dir, name), content, "utf-8");
}

describe("pythonDetector", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty result for empty directory", async () => {
    const result = await pythonDetector.detect(tmpDir);
    expect(result).toEqual({});
  });

  it("detects uv project via pyproject.toml [tool.uv] section - no test/lint without explicit signals", async () => {
    await writeFile(
      tmpDir,
      "pyproject.toml",
      "[tool.uv]\ndev-dependencies = []\n",
    );
    const result = await pythonDetector.detect(tmpDir);
    expect(result.languages).toContain("python");
    expect(result.packageManagers).toContain("uv");
    expect(result.testCommands).toEqual([]);
    expect(result.lintCommands).toEqual([]);
    expect(result.detectedFiles).toContain("pyproject.toml");
  });

  it("detects uv project via uv.lock file - no test/lint without explicit signals", async () => {
    await writeFile(tmpDir, "uv.lock", "version = 1\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.languages).toContain("python");
    expect(result.packageManagers).toContain("uv");
    expect(result.testCommands).toEqual([]);
    expect(result.lintCommands).toEqual([]);
    expect(result.detectedFiles).toContain("uv.lock");
  });

  it("detects poetry project via pyproject.toml [tool.poetry] section - no test/lint without explicit signals", async () => {
    await writeFile(
      tmpDir,
      "pyproject.toml",
      "[tool.poetry]\nname = \"my-package\"\n",
    );
    const result = await pythonDetector.detect(tmpDir);
    expect(result.languages).toContain("python");
    expect(result.packageManagers).toContain("poetry");
    expect(result.testCommands).toEqual([]);
    expect(result.lintCommands).toEqual([]);
    expect(result.detectedFiles).toContain("pyproject.toml");
  });

  it("detects poetry project via poetry.lock file - no test/lint without explicit signals", async () => {
    await writeFile(tmpDir, "poetry.lock", "# This file is auto-generated\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.languages).toContain("python");
    expect(result.packageManagers).toContain("poetry");
    expect(result.testCommands).toEqual([]);
    expect(result.lintCommands).toEqual([]);
    expect(result.detectedFiles).toContain("poetry.lock");
  });

  it("detects pip project via requirements.txt - no test commands without explicit signals", async () => {
    await writeFile(tmpDir, "requirements.txt", "requests==2.31.0\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.languages).toContain("python");
    expect(result.packageManagers).toContain("pip");
    expect(result.testCommands).toEqual([]);
    expect(result.detectedFiles).toContain("requirements.txt");
  });

  it("detects pytest via pytest.ini", async () => {
    await writeFile(tmpDir, "pytest.ini", "[pytest]\ntestpaths = tests\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.languages).toContain("python");
    expect(result.testCommands).toContain("pytest");
    expect(result.detectedFiles).toContain("pytest.ini");
  });

  it("detects pytest via conftest.py", async () => {
    await writeFile(tmpDir, "conftest.py", "import pytest\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.languages).toContain("python");
    expect(result.testCommands).toContain("pytest");
    expect(result.detectedFiles).toContain("conftest.py");
  });

  it("detects pytest via setup.cfg [tool:pytest] section", async () => {
    await writeFile(tmpDir, "setup.cfg", "[tool:pytest]\ntestpaths = tests\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.languages).toContain("python");
    expect(result.testCommands).toContain("pytest");
    expect(result.detectedFiles).toContain("setup.cfg");
  });

  it("detects flake8 via .flake8 file", async () => {
    await writeFile(tmpDir, ".flake8", "[flake8]\nmax-line-length = 88\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.languages).toContain("python");
    expect(result.lintCommands).toContain("flake8");
    expect(result.detectedFiles).toContain(".flake8");
  });

  it("detects ruff via ruff.toml", async () => {
    await writeFile(tmpDir, "ruff.toml", "line-length = 88\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.languages).toContain("python");
    expect(result.lintCommands).toContain("ruff check");
    expect(result.detectedFiles).toContain("ruff.toml");
  });

  it("detects ruff via pyproject.toml [tool.ruff] section", async () => {
    await writeFile(tmpDir, "pyproject.toml", "[tool.ruff]\nline-length = 88\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.languages).toContain("python");
    expect(result.lintCommands).toContain("ruff check");
    expect(result.detectedFiles).toContain("pyproject.toml");
  });

  it("detects mypy via mypy.ini", async () => {
    await writeFile(tmpDir, "mypy.ini", "[mypy]\nstrict = true\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.languages).toContain("python");
    expect(result.typecheckCommands).toContain("mypy .");
    expect(result.detectedFiles).toContain("mypy.ini");
  });

  it("detects mypy via pyproject.toml [tool.mypy] section", async () => {
    await writeFile(tmpDir, "pyproject.toml", "[tool.mypy]\nstrict = true\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.languages).toContain("python");
    expect(result.typecheckCommands).toContain("mypy .");
    expect(result.detectedFiles).toContain("pyproject.toml");
  });

  it("includes blockedPaths when python is detected", async () => {
    await writeFile(tmpDir, "requirements.txt", "requests\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.blockedPaths).toContain("__pycache__/");
    expect(result.blockedPaths).toContain(".venv/");
    expect(result.blockedPaths).toContain("*.pyc");
  });

  it("combines multiple tools from pyproject.toml", async () => {
    await writeFile(
      tmpDir,
      "pyproject.toml",
      "[tool.uv]\ndev-dependencies = []\n\n[tool.ruff]\nline-length = 88\n\n[tool.mypy]\nstrict = true\n",
    );
    const result = await pythonDetector.detect(tmpDir);
    expect(result.packageManagers).toContain("uv");
    expect(result.lintCommands).toContain("ruff check");
    expect(result.typecheckCommands).toContain("mypy .");
  });

  it("uv + pytest.ini -> testCommands includes pytest", async () => {
    await writeFile(tmpDir, "pyproject.toml", "[tool.uv]\ndev-dependencies = []\n");
    await writeFile(tmpDir, "pytest.ini", "[pytest]\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.testCommands).toContain("pytest");
    expect(result.packageManagers).toContain("uv");
  });

  it("poetry + conftest.py -> testCommands uses poetry run pytest", async () => {
    await writeFile(tmpDir, "poetry.lock", "# auto-generated\n");
    await writeFile(tmpDir, "conftest.py", "import pytest\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.testCommands).toContain("poetry run pytest");
    expect(result.testCommands).not.toContain("pytest");
    expect(result.packageManagers).toContain("poetry");
  });

  it("poetry + pytest.ini -> testCommands uses poetry run pytest", async () => {
    await writeFile(tmpDir, "poetry.lock", "# auto-generated\n");
    await writeFile(tmpDir, "pytest.ini", "[pytest]\ntestpaths = tests\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.testCommands).toContain("poetry run pytest");
    expect(result.testCommands).not.toContain("pytest");
  });

  it("uv + ruff.toml -> lintCommands includes ruff check", async () => {
    await writeFile(tmpDir, "uv.lock", "version = 1\n");
    await writeFile(tmpDir, "ruff.toml", "line-length = 88\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.lintCommands).toContain("ruff check");
    expect(result.packageManagers).toContain("uv");
  });

  it("poetry + [tool.ruff] -> lintCommands uses poetry run ruff check", async () => {
    await writeFile(
      tmpDir,
      "pyproject.toml",
      "[tool.poetry]\nname = \"my-pkg\"\n\n[tool.ruff]\nline-length = 88\n",
    );
    const result = await pythonDetector.detect(tmpDir);
    expect(result.lintCommands).toContain("poetry run ruff check");
    expect(result.lintCommands).not.toContain("ruff check");
    expect(result.packageManagers).toContain("poetry");
  });

  it("poetry + ruff.toml -> lintCommands uses poetry run ruff check", async () => {
    await writeFile(tmpDir, "poetry.lock", "# auto-generated\n");
    await writeFile(tmpDir, "ruff.toml", "line-length = 88\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.lintCommands).toContain("poetry run ruff check");
    expect(result.lintCommands).not.toContain("ruff check");
  });

  it("poetry + .flake8 -> lintCommands uses poetry run flake8", async () => {
    await writeFile(tmpDir, "poetry.lock", "# auto-generated\n");
    await writeFile(tmpDir, ".flake8", "[flake8]\nmax-line-length = 88\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.lintCommands).toContain("poetry run flake8");
    expect(result.lintCommands).not.toContain("flake8");
    expect(result.packageManagers).toContain("poetry");
  });

  it("poetry + mypy.ini -> typecheckCommands uses poetry run mypy .", async () => {
    await writeFile(tmpDir, "poetry.lock", "# auto-generated\n");
    await writeFile(tmpDir, "mypy.ini", "[mypy]\nstrict = true\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.typecheckCommands).toContain("poetry run mypy .");
    expect(result.typecheckCommands).not.toContain("mypy .");
    expect(result.packageManagers).toContain("poetry");
  });

  it("poetry + [tool.mypy] -> typecheckCommands uses poetry run mypy .", async () => {
    await writeFile(
      tmpDir,
      "pyproject.toml",
      "[tool.poetry]\nname = \"my-pkg\"\n\n[tool.mypy]\nstrict = true\n",
    );
    const result = await pythonDetector.detect(tmpDir);
    expect(result.typecheckCommands).toContain("poetry run mypy .");
    expect(result.typecheckCommands).not.toContain("mypy .");
    expect(result.packageManagers).toContain("poetry");
  });

  it("non-poetry + .flake8 -> lintCommands uses flake8 (no prefix)", async () => {
    await writeFile(tmpDir, "requirements.txt", "requests==2.31.0\n");
    await writeFile(tmpDir, ".flake8", "[flake8]\nmax-line-length = 88\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.lintCommands).toContain("flake8");
    expect(result.lintCommands).not.toContain("poetry run flake8");
  });

  it("non-poetry + mypy.ini -> typecheckCommands uses mypy . (no prefix)", async () => {
    await writeFile(tmpDir, "requirements.txt", "requests==2.31.0\n");
    await writeFile(tmpDir, "mypy.ini", "[mypy]\nstrict = true\n");
    const result = await pythonDetector.detect(tmpDir);
    expect(result.typecheckCommands).toContain("mypy .");
    expect(result.typecheckCommands).not.toContain("poetry run mypy .");
  });

  it("deduplicates commands when multiple signals present", async () => {
    await writeFile(
      tmpDir,
      "pyproject.toml",
      "[tool.uv]\ndev-dependencies = []\n",
    );
    await writeFile(tmpDir, "pytest.ini", "[pytest]\n");
    const result = await pythonDetector.detect(tmpDir);
    const testCmds = result.testCommands ?? [];
    expect(testCmds.filter((c) => c === "pytest")).toHaveLength(1);
  });

  it("has name 'python'", () => {
    expect(pythonDetector.name).toBe("python");
  });
});
