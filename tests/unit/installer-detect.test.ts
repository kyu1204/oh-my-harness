import { describe, it, expect } from "vitest";
import { detectInstaller } from "../../src/cli/installer-detect.js";

function makeEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  return { ...base, ...overrides };
}

describe("detectInstaller", () => {
  it("detects npm from user-agent prefix", () => {
    const result = detectInstaller(
      makeEnv({ npm_config_user_agent: "npm/10.0.0 node/v20.0.0 darwin x64" }),
    );
    expect(result.installer).toBe("npm");
    expect(result.updateCommand).toContain("npm install -g");
    expect(result.isEphemeral).toBe(false);
  });

  it("detects pnpm from user-agent prefix", () => {
    const result = detectInstaller(
      makeEnv({ npm_config_user_agent: "pnpm/8.0.0 node/v20.0.0 darwin x64" }),
    );
    expect(result.installer).toBe("pnpm");
    expect(result.updateCommand).toContain("pnpm add -g");
  });

  it("detects yarn from user-agent prefix", () => {
    const result = detectInstaller(
      makeEnv({ npm_config_user_agent: "yarn/1.22.0 npm/? node/v20.0.0" }),
    );
    expect(result.installer).toBe("yarn");
    expect(result.updateCommand).toContain("yarn global add");
  });

  it("detects bun from user-agent prefix", () => {
    const result = detectInstaller(
      makeEnv({ npm_config_user_agent: "bun/1.0.0 node/v20.0.0 darwin x64" }),
    );
    expect(result.installer).toBe("bun");
    expect(result.updateCommand).toContain("bun add -g");
  });

  it("detects npx — flagged as ephemeral", () => {
    const result = detectInstaller(
      makeEnv({
        npm_config_user_agent: "npm/10.0.0 npx-cli/10.0.0 node/v20.0.0",
      }),
    );
    expect(result.installer).toBe("npx");
    expect(result.isEphemeral).toBe(true);
    expect(result.notes).toMatch(/global/i);
  });

  it("detects volta when VOLTA_HOME is set", () => {
    const result = detectInstaller(
      makeEnv({ VOLTA_HOME: "/Users/test/.volta" }),
    );
    expect(result.installer).toBe("volta");
    expect(result.updateCommand).toContain("volta install");
  });

  it("falls back to npm when no env vars set", () => {
    const result = detectInstaller(makeEnv());
    expect(result.installer).toBe("npm");
    expect(result.updateCommand).toContain("npm install -g");
  });

  it("update commands all reference oh-my-harness package", () => {
    const installers = ["npm", "pnpm", "yarn", "bun"];
    for (const ua of installers) {
      const result = detectInstaller(
        makeEnv({ npm_config_user_agent: `${ua}/1.0.0 node/v20.0.0` }),
      );
      expect(result.updateCommand).toContain("oh-my-harness");
    }
  });

  it("npx detection takes precedence over npm user-agent", () => {
    const result = detectInstaller(
      makeEnv({
        npm_config_user_agent: "npm/10.0.0 npm-cli/10.0.0 node/v20.0.0 ... npx",
      }),
    );
    expect(result.installer).toBe("npx");
  });

  it("volta detection takes precedence over user-agent", () => {
    const result = detectInstaller(
      makeEnv({
        VOLTA_HOME: "/Users/test/.volta",
        npm_config_user_agent: "pnpm/8.0.0 node/v20.0.0",
      }),
    );
    expect(result.installer).toBe("volta");
  });
});
