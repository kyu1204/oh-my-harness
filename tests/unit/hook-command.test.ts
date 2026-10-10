import { describe, it, expect } from "vitest";
import {
  buildHookCommand,
  parseHookCommand,
  rewriteHookCommand,
  resolveHookScript,
} from "../../src/core/hook-command.js";

const REL = ".omh/hooks/catalog-branch-guard.sh";

describe("buildHookCommand", () => {
  it("claude: anchors on ${CLAUDE_PROJECT_DIR}", () => {
    expect(buildHookCommand(REL, "claude")).toBe(`bash "\${CLAUDE_PROJECT_DIR}/${REL}"`);
  });

  it("codex: anchors on the git root with a cwd fallback", () => {
    expect(buildHookCommand(REL, "codex")).toBe(
      `bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/${REL}"`,
    );
  });

  it("pi: relative path (the bridge spawns with cwd = project root)", () => {
    expect(buildHookCommand(REL, "pi")).toBe(`bash '${REL}'`);
  });

  it("never embeds a machine path", () => {
    for (const rt of ["claude", "codex", "pi"] as const) {
      expect(buildHookCommand(REL, rt)).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\/);
    }
  });
});

describe("parseHookCommand", () => {
  it("strips the project-root anchor of every runtime form", () => {
    for (const rt of ["claude", "codex", "pi"] as const) {
      expect(parseHookCommand(buildHookCommand(REL, rt))).toEqual({ script: REL, anchored: rt !== "pi" });
    }
    expect(parseHookCommand(`bash "$CLAUDE_PROJECT_DIR/${REL}"`)).toEqual({ script: REL, anchored: true });
  });

  it("accepts the legacy absolute form and bare relative form", () => {
    expect(parseHookCommand("bash '/abs/p/.omh/hooks/x.sh'")).toEqual({ script: "/abs/p/.omh/hooks/x.sh", anchored: true });
    expect(parseHookCommand("bash .omh/hooks/x.sh")).toEqual({ script: ".omh/hooks/x.sh", anchored: false });
  });

  it("returns null for commands that are not a bash script invocation", () => {
    expect(parseHookCommand("node myhook.js")).toBeNull();
    expect(parseHookCommand("bash -c 'echo hi'")).toBeNull();
  });
});

describe("rewriteHookCommand", () => {
  it("converts the Claude form into the target runtime form", () => {
    const claude = buildHookCommand(REL, "claude");
    expect(rewriteHookCommand(claude, "codex")).toBe(buildHookCommand(REL, "codex"));
    expect(rewriteHookCommand(claude, "pi")).toBe(buildHookCommand(REL, "pi"));
  });

  it("leaves absolute and unparseable commands untouched", () => {
    expect(rewriteHookCommand("bash /p/.omh/hooks/x.sh", "codex")).toBe("bash /p/.omh/hooks/x.sh");
    expect(rewriteHookCommand("node myhook.js", "pi")).toBe("node myhook.js");
  });
});

describe("resolveHookScript", () => {
  it("resolves anchored and relative scripts against projectDir, keeps absolute", () => {
    expect(resolveHookScript(buildHookCommand(REL, "claude"), "/proj")).toBe(`/proj/${REL}`);
    expect(resolveHookScript("bash .omh/hooks/x.sh", "/proj")).toBe("/proj/.omh/hooks/x.sh");
    expect(resolveHookScript("bash '/abs/x.sh'", "/proj")).toBe("/abs/x.sh");
    expect(resolveHookScript("node x.js", "/proj")).toBeNull();
  });
});
