import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { rubyDetector } from "../../../src/detector/detectors/ruby.js";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "ruby-detector-"));
}

async function writeFile(dir: string, name: string, content: string): Promise<void> {
  await fs.writeFile(path.join(dir, name), content, "utf-8");
}

describe("rubyDetector", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty result for empty directory", async () => {
    const result = await rubyDetector.detect(tmpDir);
    expect(result).toEqual({});
  });

  it("detects Ruby/Bundler project via Gemfile", async () => {
    await writeFile(tmpDir, "Gemfile", "source 'https://rubygems.org'\ngem 'rails'\n");
    const result = await rubyDetector.detect(tmpDir);
    expect(result.languages).toContain("ruby");
    expect(result.packageManagers).toContain("bundler");
    expect(result.testCommands).toContain("bundle exec rspec");
    expect(result.lintCommands).toContain("bundle exec rubocop");
    expect(result.detectedFiles).toContain("Gemfile");
  });

  it("detects Rails project via config/routes.rb", async () => {
    await writeFile(tmpDir, "Gemfile", "source 'https://rubygems.org'\ngem 'rails'\n");
    await fs.mkdir(path.join(tmpDir, "config"), { recursive: true });
    await writeFile(path.join(tmpDir, "config"), "routes.rb", "Rails.application.routes.draw do\nend\n");
    const result = await rubyDetector.detect(tmpDir);
    expect(result.languages).toContain("ruby");
    expect(result.frameworks).toContain("rails");
    expect(result.packageManagers).toContain("bundler");
    expect(result.testCommands).toContain("bundle exec rails test");
    expect(result.lintCommands).toContain("bundle exec rubocop");
    expect(result.detectedFiles).toContain("config/routes.rb");
  });

  it("includes bundler in packageManagers when only config/routes.rb is present (no Gemfile)", async () => {
    await fs.mkdir(path.join(tmpDir, "config"), { recursive: true });
    await writeFile(path.join(tmpDir, "config"), "routes.rb", "Rails.application.routes.draw do\nend\n");
    const result = await rubyDetector.detect(tmpDir);
    expect(result.languages).toContain("ruby");
    expect(result.frameworks).toContain("rails");
    expect(result.packageManagers).toContain("bundler");
    expect(result.detectedFiles).toContain("config/routes.rb");
  });

  it("detects Ruby/Rake project via Rakefile only", async () => {
    await writeFile(tmpDir, "Rakefile", "task :default => [:test]\n");
    const result = await rubyDetector.detect(tmpDir);
    expect(result.languages).toContain("ruby");
    expect(result.testCommands).toContain("rake test");
    expect(result.detectedFiles).toContain("Rakefile");
  });

  it("includes blockedPaths when ruby is detected", async () => {
    await writeFile(tmpDir, "Gemfile", "source 'https://rubygems.org'\n");
    const result = await rubyDetector.detect(tmpDir);
    expect(result.blockedPaths).toContain("vendor/bundle/");
    expect(result.blockedPaths).toContain("tmp/");
    expect(result.blockedPaths).toContain("log/");
  });

  it("has name 'ruby'", () => {
    expect(rubyDetector.name).toBe("ruby");
  });
});
