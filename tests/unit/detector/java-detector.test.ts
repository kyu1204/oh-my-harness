import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { javaDetector } from "../../../src/detector/detectors/java.js";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "java-detector-test-"));
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

describe("javaDetector", () => {
  it("has name 'java'", () => {
    expect(javaDetector.name).toBe("java");
  });

  it("returns empty result for empty directory", async () => {
    const result = await javaDetector.detect(tmpDir);
    expect(result).toEqual({});
  });

  it("detects Maven project from pom.xml", async () => {
    await writeFile(tmpDir, "pom.xml", "<project></project>");

    const result = await javaDetector.detect(tmpDir);

    expect(result.languages).toContain("java");
    expect(result.packageManagers).toContain("maven");
    expect(result.testCommands).toContain("mvn test");
    expect(result.buildCommands).toContain("mvn compile");
    expect(result.detectedFiles).toContain("pom.xml");
  });

  it("detects Gradle project from build.gradle (with gradlew)", async () => {
    await writeFile(tmpDir, "build.gradle", "// gradle build file");
    await writeFile(tmpDir, "gradlew", "#!/bin/sh");

    const result = await javaDetector.detect(tmpDir);

    expect(result.languages).toContain("java");
    expect(result.packageManagers).toContain("gradle");
    expect(result.testCommands).toContain("./gradlew test");
    expect(result.buildCommands).toContain("./gradlew build");
    expect(result.detectedFiles).toContain("build.gradle");
    expect(result.detectedFiles).toContain("gradlew");
  });

  it("detects Gradle Kotlin DSL project from build.gradle.kts (with gradlew)", async () => {
    await writeFile(tmpDir, "build.gradle.kts", "// kotlin dsl build file");
    await writeFile(tmpDir, "gradlew", "#!/bin/sh");

    const result = await javaDetector.detect(tmpDir);

    expect(result.languages).toContain("java");
    expect(result.languages).toContain("kotlin");
    expect(result.packageManagers).toContain("gradle");
    expect(result.testCommands).toContain("./gradlew test");
    expect(result.buildCommands).toContain("./gradlew build");
    expect(result.detectedFiles).toContain("build.gradle.kts");
    expect(result.detectedFiles).toContain("gradlew");
  });

  it("uses gradle (not ./gradlew) when build.gradle exists but gradlew does not", async () => {
    await writeFile(tmpDir, "build.gradle", "// gradle build file");

    const result = await javaDetector.detect(tmpDir);

    expect(result.testCommands).toContain("gradle test");
    expect(result.buildCommands).toContain("gradle build");
    expect(result.testCommands).not.toContain("./gradlew test");
    expect(result.detectedFiles).not.toContain("gradlew");
  });

  it("uses gradle (not ./gradlew) when build.gradle.kts exists but gradlew does not", async () => {
    await writeFile(tmpDir, "build.gradle.kts", "// kotlin dsl build file");

    const result = await javaDetector.detect(tmpDir);

    expect(result.testCommands).toContain("gradle test");
    expect(result.buildCommands).toContain("gradle build");
    expect(result.testCommands).not.toContain("./gradlew test");
    expect(result.detectedFiles).not.toContain("gradlew");
  });

  it("includes standard blocked paths for Maven projects", async () => {
    await writeFile(tmpDir, "pom.xml", "<project></project>");

    const result = await javaDetector.detect(tmpDir);

    expect(result.blockedPaths).toContain("target/");
  });

  it("includes standard blocked paths for Gradle projects", async () => {
    await writeFile(tmpDir, "build.gradle", "// gradle");
    await writeFile(tmpDir, "gradlew", "#!/bin/sh");

    const result = await javaDetector.detect(tmpDir);

    expect(result.blockedPaths).toContain("build/");
    expect(result.blockedPaths).toContain(".gradle/");
  });

  it("does not detect kotlin for plain build.gradle", async () => {
    await writeFile(tmpDir, "build.gradle", "// gradle");

    const result = await javaDetector.detect(tmpDir);

    expect(result.languages).not.toContain("kotlin");
  });
});
