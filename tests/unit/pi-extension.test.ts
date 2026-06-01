import { describe, it, expect } from "vitest";
import { extractPiBindings, buildPiExtension } from "../../src/generators/pi-extension.js";
import type { HooksOutput } from "../../src/generators/hooks.js";

function hooksConfig(entries: Record<string, Array<{ matcher: string; command: string }>>): HooksOutput["hooksConfig"] {
  const out: HooksOutput["hooksConfig"] = {};
  for (const [event, list] of Object.entries(entries)) {
    out[event] = list.map((e) => ({
      matcher: e.matcher,
      hooks: [{ type: "command" as const, command: e.command }],
    }));
  }
  return out;
}

describe("extractPiBindings", () => {
  it("maps a Bash PreToolUse hook to the pi 'bash' tool", () => {
    const cfg = hooksConfig({
      PreToolUse: [{ matcher: "Bash", command: "bash '/abs/.omh/hooks/catalog-command-guard.sh'" }],
    });
    const bindings = extractPiBindings(cfg);
    expect(bindings).toEqual([{ tools: ["bash"], command: "bash '/abs/.omh/hooks/catalog-command-guard.sh'" }]);
  });

  it("expands an Edit|Write matcher to edit and write tools", () => {
    const cfg = hooksConfig({
      PreToolUse: [{ matcher: "Edit|Write", command: "bash '/abs/.omh/hooks/catalog-tdd-guard.sh'" }],
    });
    const bindings = extractPiBindings(cfg);
    expect(bindings).toEqual([{ tools: ["edit", "write"], command: "bash '/abs/.omh/hooks/catalog-tdd-guard.sh'" }]);
  });

  it("ignores non-PreToolUse events (no pi tool_call equivalent yet)", () => {
    const cfg = hooksConfig({
      PreToolUse: [{ matcher: "Bash", command: "bash '/abs/.omh/hooks/a.sh'" }],
      PostToolUse: [{ matcher: "Edit|Write", command: "bash '/abs/.omh/hooks/lint.sh'" }],
      SessionStart: [{ matcher: "*", command: "bash '/abs/.omh/hooks/compact.sh'" }],
    });
    const bindings = extractPiBindings(cfg);
    expect(bindings).toEqual([{ tools: ["bash"], command: "bash '/abs/.omh/hooks/a.sh'" }]);
  });

  it("returns empty array when there are no PreToolUse hooks", () => {
    expect(extractPiBindings(hooksConfig({}))).toEqual([]);
  });
});

describe("buildPiExtension", () => {
  const bindings = [
    { tools: ["bash"], command: "bash '/abs/.omh/hooks/catalog-command-guard.sh'" },
    { tools: ["edit", "write"], command: "bash '/abs/.omh/hooks/catalog-tdd-guard.sh'" },
  ];
  const code = buildPiExtension(bindings);

  it("registers a tool_call handler", () => {
    expect(code).toContain('pi.on("tool_call"');
  });

  it("embeds each hook command as a binding", () => {
    expect(code).toContain("bash '/abs/.omh/hooks/catalog-command-guard.sh'");
    expect(code).toContain("bash '/abs/.omh/hooks/catalog-tdd-guard.sh'");
  });

  it("runs the hook command through a shell (command is a full shell line)", () => {
    expect(code).toContain("shell: true");
  });

  it("fails closed when the hook process errors or exits non-zero", () => {
    expect(code).toContain("proc.error");
    expect(code).toContain("proc.status");
    expect(code).toContain("hook failed");
  });

  it("maps pi edit/write 'path' input to the Claude 'file_path' payload field", () => {
    // The shell guards read tool_input.file_path; pi delivers `path`.
    expect(code).toContain("file_path");
    expect(code).toContain("input.path");
  });

  it("sends a Claude-style payload (transcript_path) so ask-mode scripts emit permissionDecision", () => {
    expect(code).toContain("transcript_path");
    expect(code).toContain("permissionDecision");
  });

  it("escalates ask decisions through ctx.ui.select and blocks on decline", () => {
    expect(code).toContain("ctx.ui.select");
    expect(code).toContain("ctx.hasUI");
    expect(code).toContain("block: true");
  });

  it("uses a type-only import so the pi package is not a runtime dependency", () => {
    expect(code).toContain("import type");
    expect(code).not.toMatch(/^import \{[^}]*\} from "@earendil-works\/pi-coding-agent"/m);
  });

  it("is generated/marked as auto-generated", () => {
    expect(code.toLowerCase()).toContain("auto-generated");
  });
});
