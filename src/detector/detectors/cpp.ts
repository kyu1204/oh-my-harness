import * as fs from "fs/promises";
import * as path from "path";
import type { Detector } from "../types.js";

export const cppDetector: Detector = {
  name: "cpp",
  detect: async (projectDir: string) => {
    const cmakeFile = path.join(projectDir, "CMakeLists.txt");
    const makeFile = path.join(projectDir, "Makefile");
    const mesonFile = path.join(projectDir, "meson.build");

    const [hasCMake, hasMakefile, hasMeson] = await Promise.all([
      fs.access(cmakeFile).then(() => true).catch(() => false),
      fs.access(makeFile).then(() => true).catch(() => false),
      fs.access(mesonFile).then(() => true).catch(() => false),
    ]);

    const blockedPaths = ["build/", "cmake-build-*/"];

    if (hasCMake) {
      return {
        languages: ["c", "cpp"],
        buildCommands: ["cmake --build build"],
        testCommands: ["ctest --test-dir build"],
        blockedPaths,
        detectedFiles: ["CMakeLists.txt"],
      };
    }

    if (hasMeson) {
      return {
        languages: ["c", "cpp"],
        buildCommands: ["meson compile -C build"],
        testCommands: ["meson test -C build"],
        blockedPaths,
        detectedFiles: ["meson.build"],
      };
    }

    if (hasMakefile) {
      return {
        languages: ["c"],
        buildCommands: ["make"],
        testCommands: ["make test"],
        blockedPaths,
        detectedFiles: ["Makefile"],
      };
    }

    return {};
  },
};
