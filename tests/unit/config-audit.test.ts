import { describe, it, expect } from "vitest";

import { configAudit } from "../../src/catalog/blocks/config-audit.js";

describe("configAudit block", () => {
  it("has correct metadata", () => {
    expect(configAudit.id).toBe("config-audit");
    expect(configAudit.event).toBe("ConfigChange");
    expect(configAudit.matcher).toBe("");
    expect(configAudit.canBlock).toBe(false);
  });

  it("has logFile param with default", () => {
    const param = configAudit.params.find((p) => p.name === "logFile");
    expect(param).toBeDefined();
    expect(param!.type).toBe("string");
    expect(param!.default).toBe(".claude/hooks/.state/config-audit.log");
  });

  it("template uses triple-stash for logFile", () => {
    expect(configAudit.template).toContain("{{{logFile}}}");
  });

  it("template reads source and file_path from input", () => {
    expect(configAudit.template).toContain(".source");
    expect(configAudit.template).toContain(".file_path");
  });

  it("does not contain _log_event wrapper", () => {
    expect(configAudit.template).not.toContain("_log_event");
  });
});
