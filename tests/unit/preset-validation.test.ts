import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { loadPreset } from "../../src/core/preset-loader.js";

const PRESETS_DIR = path.resolve(import.meta.dirname, "../../presets");

// Dynamically discover all preset directories (excluding _base)
async function discoverPresets(): Promise<string[]> {
  const entries = await fs.readdir(PRESETS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && e.name !== "_base")
    .map((e) => e.name)
    .sort();
}

describe("built-in preset validation", () => {
  it("discovers at least one preset (excluding _base)", async () => {
    const presets = await discoverPresets();
    expect(presets.length).toBeGreaterThan(0);
    expect(presets).not.toContain("_base");
  });

  it("_base preset parses without errors", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "_base"));
    expect(preset).toBeDefined();
  });

  it("_base has required fields", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "_base"));
    expect(preset.name).toBe("_base");
    expect(preset.displayName).toBeTruthy();
    expect(preset.description).toBeTruthy();
    expect(preset.version).toBeTruthy();
  });

  it("all discovered presets parse without errors", async () => {
    const presets = await discoverPresets();
    for (const name of presets) {
      const preset = await loadPreset(path.join(PRESETS_DIR, name));
      expect(preset, `${name} should parse`).toBeDefined();
    }
  });

  it("all discovered presets have required fields", async () => {
    const presets = await discoverPresets();
    for (const name of presets) {
      const preset = await loadPreset(path.join(PRESETS_DIR, name));
      expect(preset.name, `${name}.name`).toBe(name);
      expect(preset.displayName, `${name}.displayName`).toBeTruthy();
      expect(preset.description, `${name}.description`).toBeTruthy();
      expect(preset.version, `${name}.version`).toBeTruthy();
    }
  });

  it("extends chains reference existing presets", async () => {
    const presets = await discoverPresets();
    const allNames = ["_base", ...presets];
    for (const name of presets) {
      const preset = await loadPreset(path.join(PRESETS_DIR, name));
      if (!preset.extends) continue;
      for (const ref of preset.extends) {
        expect(allNames, `${name} extends unknown preset "${ref}"`).toContain(
          ref
        );
      }
    }
  });

  it("_base has no extends", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "_base"));
    expect(preset.extends).toBeUndefined();
  });

  it("nextjs extends typescript", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs"));
    expect(preset.extends).toContain("typescript");
  });

  it("fastapi extends python", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "fastapi"));
    expect(preset.extends).toContain("python");
  });

  it("nextjs-fastapi extends nextjs and fastapi", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs-fastapi"));
    expect(preset.extends).toContain("nextjs");
    expect(preset.extends).toContain("fastapi");
  });

  it("_base has claudeMd sections", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "_base"));
    expect(preset.claudeMd?.sections.length).toBeGreaterThan(0);
  });

  it("nextjs has expected claudeMd section ids", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs"));
    const ids = preset.claudeMd?.sections.map((s) => s.id) ?? [];
    expect(ids).toContain("nextjs-rules");
    expect(ids).toContain("nextjs-testing");
    expect(ids).toContain("nextjs-structure");
  });

  it("fastapi has expected claudeMd section ids", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "fastapi"));
    const ids = preset.claudeMd?.sections.map((s) => s.id) ?? [];
    expect(ids).toContain("fastapi-rules");
    expect(ids).toContain("fastapi-testing");
    expect(ids).toContain("fastapi-structure");
  });

  it("nextjs-fastapi has fullstack-rules section", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs-fastapi"));
    const ids = preset.claudeMd?.sections.map((s) => s.id) ?? [];
    expect(ids).toContain("fullstack-rules");
  });

  it("nextjs has hooks", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs"));
    expect(preset.hooks?.preToolUse?.length).toBeGreaterThan(0);
    expect(preset.hooks?.postToolUse?.length).toBeGreaterThan(0);
  });

  it("fastapi has hooks", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "fastapi"));
    expect(preset.hooks?.preToolUse?.length).toBeGreaterThan(0);
    expect(preset.hooks?.postToolUse?.length).toBeGreaterThan(0);
  });

  it("nextjs-fastapi has preToolUse hooks", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs-fastapi"));
    expect(preset.hooks?.preToolUse?.length).toBeGreaterThan(0);
  });

  it("nextjs has settings permissions", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs"));
    expect(preset.settings?.permissions?.allow?.length).toBeGreaterThan(0);
    expect(preset.settings?.permissions?.deny?.length).toBeGreaterThan(0);
  });

  it("fastapi has settings permissions", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "fastapi"));
    expect(preset.settings?.permissions?.allow?.length).toBeGreaterThan(0);
    expect(preset.settings?.permissions?.deny?.length).toBeGreaterThan(0);
  });

  it("nextjs has expected variables", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs"));
    expect(preset.variables?.framework).toBe("nextjs");
    expect(preset.variables?.language).toBe("typescript");
  });

  it("fastapi has expected variables", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "fastapi"));
    expect(preset.variables?.framework).toBe("fastapi");
    expect(preset.variables?.language).toBe("python");
  });

  it("nextjs-fastapi has expected variables", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "nextjs-fastapi"));
    expect(preset.variables?.framework).toBe("nextjs-fastapi");
    expect(preset.variables?.type).toBe("fullstack");
  });

  // --- Change #1: cpp testRunner includes --output-on-failure ---
  it("cpp testRunner includes --output-on-failure", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "cpp"));
    expect(preset.variables?.testRunner).toContain("--output-on-failure");
  });

  // --- Change #2: elixir linter is 'mix credo' and permission exists ---
  it("elixir linter is 'mix credo'", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "elixir"));
    expect(preset.variables?.linter).toBe("mix credo");
  });

  it("elixir permissions allow 'Bash(mix credo*)'", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "elixir"));
    expect(preset.settings?.permissions?.allow).toContain("Bash(mix credo*)");
  });

  // --- Change #3: java permissions include wrapper scripts and checkstyle ---
  it("java permissions allow 'Bash(./gradlew *)'", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "java"));
    expect(preset.settings?.permissions?.allow).toContain("Bash(./gradlew *)");
  });

  it("java permissions allow 'Bash(./mvnw *)'", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "java"));
    expect(preset.settings?.permissions?.allow).toContain("Bash(./mvnw *)");
  });

  it("java permissions allow 'Bash(checkstyle *)'", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "java"));
    expect(preset.settings?.permissions?.allow).toContain(
      "Bash(checkstyle *)"
    );
  });

  // --- Change #4: php permissions are granular (no wildcard vendor/bin/*) ---
  it("php permissions do not contain wildcard 'Bash(./vendor/bin/*)'", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "php"));
    expect(preset.settings?.permissions?.allow).not.toContain(
      "Bash(./vendor/bin/*)"
    );
  });

  it("php permissions allow 'Bash(./vendor/bin/phpunit *)'", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "php"));
    expect(preset.settings?.permissions?.allow).toContain(
      "Bash(./vendor/bin/phpunit *)"
    );
  });

  it("php permissions allow 'Bash(./vendor/bin/phpstan *)'", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "php"));
    expect(preset.settings?.permissions?.allow).toContain(
      "Bash(./vendor/bin/phpstan *)"
    );
  });

  // --- Change #5: scala has scalafix as linter and scalafmt as formatter ---
  it("scala linter is 'scalafix'", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "scala"));
    expect(preset.variables?.linter).toBe("scalafix");
  });

  it("scala formatter is 'scalafmt'", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "scala"));
    expect(preset.variables?.formatter).toBe("scalafmt");
  });

  // --- Change #6: maven/gradle have testRunner; springboot defers ---
  it("maven has testRunner 'mvn test'", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "maven"));
    expect(preset.variables?.testRunner).toBe("mvn test");
  });

  it("gradle has testRunner './gradlew test'", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "gradle"));
    expect(preset.variables?.testRunner).toBe("./gradlew test");
  });

  it("springboot does not define testRunner (defers to PM preset)", async () => {
    const preset = await loadPreset(path.join(PRESETS_DIR, "springboot"));
    expect(preset.variables?.testRunner).toBeUndefined();
  });
});
