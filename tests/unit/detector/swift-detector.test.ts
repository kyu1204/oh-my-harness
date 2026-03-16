import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { swiftDetector } from "../../../src/detector/detectors/swift.js";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "omh-swift-test-"));
}

async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

describe("swiftDetector", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await cleanup(tmpDir);
  });

  it("returns empty facts for an empty directory", async () => {
    const result = await swiftDetector.detect(tmpDir);
    expect(result).toEqual({});
  });

  describe("SPM project (Package.swift only, no .xcodeproj)", () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(tmpDir, "Package.swift"), "// swift-tools-version:5.9\n");
    });

    it("detects swift language", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.languages).toContain("swift");
    });

    it("detects spm framework", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.frameworks).toContain("spm");
    });

    it("sets swift test command", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.testCommands).toContain("swift test");
    });

    it("sets swift build command", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.buildCommands).toContain("swift build");
    });

    it("includes Package.swift in detectedFiles", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.detectedFiles).toContain("Package.swift");
    });

    it("sets .build/ in blockedPaths", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.blockedPaths).toContain(".build/");
    });

    it("sets DerivedData/ in blockedPaths", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.blockedPaths).toContain("DerivedData/");
    });

    it("does not detect xcode framework", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.frameworks).not.toContain("xcode");
    });
  });

  describe("Xcode project (.xcodeproj present)", () => {
    const projectName = "MyApp";

    beforeEach(async () => {
      await fs.mkdir(path.join(tmpDir, `${projectName}.xcodeproj`));
    });

    it("detects swift language", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.languages).toContain("swift");
    });

    it("detects xcode framework", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.frameworks).toContain("xcode");
    });

    it("does not detect spm framework", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.frameworks).not.toContain("spm");
    });

    it("sets xcodebuild test command with scheme", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.testCommands).toContain(`xcodebuild test -scheme ${projectName}`);
    });

    it("sets xcodebuild build command", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.buildCommands).toContain("xcodebuild build");
    });

    it("includes .xcodeproj in detectedFiles", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.detectedFiles).toContain(`${projectName}.xcodeproj`);
    });

    it("sets blockedPaths", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.blockedPaths).toContain("DerivedData/");
    });
  });

  describe("Xcode project with Package.swift (xcodeproj takes precedence when no workspace)", () => {
    const projectName = "HybridApp";

    beforeEach(async () => {
      await fs.writeFile(path.join(tmpDir, "Package.swift"), "// swift-tools-version:5.9\n");
      await fs.mkdir(path.join(tmpDir, `${projectName}.xcodeproj`));
    });

    it("detects xcode framework (not spm)", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.frameworks).toContain("xcode");
      expect(result.frameworks).not.toContain("spm");
    });

    it("sets xcodebuild test command", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.testCommands).toContain(`xcodebuild test -scheme ${projectName}`);
    });
  });

  describe("Xcode workspace (.xcworkspace present, no .xcodeproj)", () => {
    const workspaceName = "MyWorkspace";

    beforeEach(async () => {
      await fs.mkdir(path.join(tmpDir, `${workspaceName}.xcworkspace`));
    });

    it("detects swift language", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.languages).toContain("swift");
    });

    it("detects xcode framework", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.frameworks).toContain("xcode");
    });

    it("sets xcodebuild test command with workspace", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.testCommands).toContain(
        `xcodebuild test -workspace ${workspaceName}.xcworkspace`
      );
    });

    it("sets xcodebuild build command", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.buildCommands).toContain("xcodebuild build");
    });

    it("includes .xcworkspace in detectedFiles", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.detectedFiles).toContain(`${workspaceName}.xcworkspace`);
    });
  });

  describe("Xcode workspace + xcodeproj (workspace takes priority)", () => {
    const workspaceName = "MyWorkspace";
    const projectName = "MyApp";

    beforeEach(async () => {
      await fs.mkdir(path.join(tmpDir, `${workspaceName}.xcworkspace`));
      await fs.mkdir(path.join(tmpDir, `${projectName}.xcodeproj`));
    });

    it("uses workspace test command, not xcodeproj scheme", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.testCommands).toContain(
        `xcodebuild test -workspace ${workspaceName}.xcworkspace`
      );
      expect(result.testCommands).not.toContain(`xcodebuild test -scheme ${projectName}`);
    });

    it("sets xcodebuild build command", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.buildCommands).toContain("xcodebuild build");
    });

    it("includes both workspace and xcodeproj in detectedFiles", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.detectedFiles).toContain(`${workspaceName}.xcworkspace`);
      expect(result.detectedFiles).toContain(`${projectName}.xcodeproj`);
    });

    it("does not duplicate xcode in frameworks", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.frameworks?.filter((f) => f === "xcode").length).toBe(1);
    });
  });

  describe("SwiftLint (.swiftlint.yml present)", () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(tmpDir, ".swiftlint.yml"), "disabled_rules: []\n");
    });

    it("sets swiftlint in lintCommands (not buildCommands)", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.lintCommands).toContain("swiftlint");
      expect(result.buildCommands).not.toContain("swiftlint");
    });

    it("includes .swiftlint.yml in detectedFiles", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.detectedFiles).toContain(".swiftlint.yml");
    });
  });

  describe("SwiftLint combined with SPM project", () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(tmpDir, "Package.swift"), "// swift-tools-version:5.9\n");
      await fs.writeFile(path.join(tmpDir, ".swiftlint.yml"), "disabled_rules: []\n");
    });

    it("detects spm framework", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.frameworks).toContain("spm");
    });

    it("includes swift build command in buildCommands", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.buildCommands).toContain("swift build");
    });

    it("includes swiftlint in lintCommands (not buildCommands)", async () => {
      const result = await swiftDetector.detect(tmpDir);
      expect(result.lintCommands).toContain("swiftlint");
      expect(result.buildCommands).not.toContain("swiftlint");
    });
  });

  it("has name 'swift'", () => {
    expect(swiftDetector.name).toBe("swift");
  });
});
