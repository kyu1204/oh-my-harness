import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { terraformDetector } from "../../../src/detector/detectors/terraform.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-terraform-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("terraformDetector", () => {
  it("has name 'terraform'", () => {
    expect(terraformDetector.name).toBe("terraform");
  });

  it("returns empty object for empty directory", async () => {
    const result = await terraformDetector.detect(tmpDir);
    expect(result).toEqual({});
  });

  it("detects Terraform project when main.tf exists", async () => {
    await fs.writeFile(path.join(tmpDir, "main.tf"), 'resource "aws_instance" "web" {}');
    const result = await terraformDetector.detect(tmpDir);

    expect(result.languages).toContain("hcl");
    expect(result.frameworks).toContain("terraform");
    expect(result.packageManagers).toContain("terraform");
    expect(result.testCommands).toContain("terraform test");
    expect(result.lintCommands).toContain("tflint");
    expect(result.buildCommands).toContain("terraform plan");
    expect(result.blockedPaths).toContain(".terraform/");
    expect(result.detectedFiles).toContain("main.tf");
  });

  it("detects Terraform project when .terraform.lock.hcl exists", async () => {
    await fs.writeFile(path.join(tmpDir, ".terraform.lock.hcl"), "provider registry.terraform.io/hashicorp/aws {}");
    const result = await terraformDetector.detect(tmpDir);

    expect(result.languages).toContain("hcl");
    expect(result.frameworks).toContain("terraform");
  });

  it("detects Terraform project when variables.tf exists", async () => {
    await fs.writeFile(path.join(tmpDir, "variables.tf"), 'variable "region" { default = "us-east-1" }');
    const result = await terraformDetector.detect(tmpDir);

    expect(result.languages).toContain("hcl");
    expect(result.frameworks).toContain("terraform");
  });

  it("includes tfstate in blocked paths", async () => {
    await fs.writeFile(path.join(tmpDir, "main.tf"), "");
    const result = await terraformDetector.detect(tmpDir);

    expect(result.blockedPaths).toContain(".terraform/");
    expect(result.blockedPaths).toContain("*.tfstate");
  });

  it("does not detect Terraform for non-tf files", async () => {
    await fs.writeFile(path.join(tmpDir, "main.py"), "print('hello')");
    const result = await terraformDetector.detect(tmpDir);
    expect(result).toEqual({});
  });
});
