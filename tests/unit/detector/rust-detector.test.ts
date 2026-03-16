import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { rustDetector } from "../../../src/detector/detectors/rust.js";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "rust-detector-test-"));
}

async function writeFile(dir: string, name: string, content: string): Promise<void> {
  const filePath = path.join(dir, name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await makeTmpDir();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("rustDetector", () => {
  it("returns empty result for empty directory", async () => {
    const result = await rustDetector.detect(tmpDir);
    expect(result).toEqual({});
  });

  it("detects Rust project from Cargo.toml", async () => {
    await writeFile(tmpDir, "Cargo.toml", '[package]\nname = "my-app"\nversion = "0.1.0"');

    const result = await rustDetector.detect(tmpDir);

    expect(result.languages).toContain("rust");
    expect(result.packageManagers).toContain("cargo");
    expect(result.testCommands).toContain("cargo test");
    expect(result.lintCommands).toContain("cargo clippy");
    expect(result.buildCommands).toContain("cargo build");
    expect(result.blockedPaths).toContain("target/");
    expect(result.detectedFiles).toContain("Cargo.toml");
  });

  it("does not detect Rust when Cargo.toml is absent", async () => {
    await writeFile(tmpDir, "main.rs", 'fn main() {}');

    const result = await rustDetector.detect(tmpDir);

    expect(result).toEqual({});
  });

  it("has name 'rust'", () => {
    expect(rustDetector.name).toBe("rust");
  });
});
