import * as fs from "fs/promises";
import * as path from "path";
import type { Detector } from "../types.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export const javaDetector: Detector = {
  name: "java",
  detect: async (projectDir: string) => {
    const pomPath = path.join(projectDir, "pom.xml");
    const gradlePath = path.join(projectDir, "build.gradle");
    const gradleKtsPath = path.join(projectDir, "build.gradle.kts");

    const gradlewPath = path.join(projectDir, "gradlew");

    const [hasPom, hasGradle, hasGradleKts, hasGradlew] = await Promise.all([
      fileExists(pomPath),
      fileExists(gradlePath),
      fileExists(gradleKtsPath),
      fileExists(gradlewPath),
    ]);

    if (hasPom) {
      return {
        languages: ["java"],
        packageManagers: ["maven"],
        testCommands: ["mvn test"],
        buildCommands: ["mvn compile"],
        blockedPaths: ["target/"],
        detectedFiles: ["pom.xml"],
      };
    }

    const gradleCmd = hasGradlew ? "./gradlew" : "gradle";
    const gradlewFiles = hasGradlew ? ["gradlew"] : [];

    if (hasGradleKts) {
      return {
        languages: ["java", "kotlin"],
        packageManagers: ["gradle"],
        testCommands: [`${gradleCmd} test`],
        buildCommands: [`${gradleCmd} build`],
        blockedPaths: ["build/", ".gradle/"],
        detectedFiles: ["build.gradle.kts", ...gradlewFiles],
      };
    }

    if (hasGradle) {
      return {
        languages: ["java"],
        packageManagers: ["gradle"],
        testCommands: [`${gradleCmd} test`],
        buildCommands: [`${gradleCmd} build`],
        blockedPaths: ["build/", ".gradle/"],
        detectedFiles: ["build.gradle", ...gradlewFiles],
      };
    }

    return {};
  },
};
