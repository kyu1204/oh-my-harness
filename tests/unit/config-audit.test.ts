import { describe, it, expect } from "vitest";

import { configAudit } from "../../src/catalog/blocks/config-audit.js";

describe("configAudit block", () => {
  it("has correct metadata", () => {
    expect(configAudit.id).toBe("config-audit");
    expect(configAudit.event).toBe("ConfigChange");
    expect(configAudit.matcher).toBe("");
    expect(configAudit.canBlock).toBe(false);
  });

  it("has no params (uses unified events.jsonl via _log_event wrapper)", () => {
    expect(configAudit.params).toEqual([]);
  });

  it("template reads source and file_path from input", () => {
    expect(configAudit.template).toContain(".source");
    expect(configAudit.template).toContain(".file_path");
  });

  it("template emits a meta JSON object via _log_event", () => {
    expect(configAudit.template).toContain("_log_event");
    expect(configAudit.template).toContain("\"source\"");
    expect(configAudit.template).toContain("\"file\"");
  });

  it("template no longer writes to a separate .log file", () => {
    expect(configAudit.template).not.toContain(".log");
  });
});
