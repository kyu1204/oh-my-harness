import { describe, it, expect } from "vitest";
import { HooksConfigSchema } from "../../src/core/preset-types.js";

describe("HooksConfigSchema", () => {
  it("supports preToolUse and postToolUse", () => {
    const parsed = HooksConfigSchema.parse({
      preToolUse: [],
      postToolUse: [],
    });
    expect(parsed.preToolUse).toEqual([]);
    expect(parsed.postToolUse).toEqual([]);
  });

  it("supports extended event types (sessionStart, notification, configChange)", () => {
    const parsed = HooksConfigSchema.parse({
      sessionStart: [{ id: "test-session", matcher: "compact" }],
      notification: [{ id: "test-notify", matcher: "" }],
      configChange: [{ id: "test-config", matcher: "" }],
    });
    expect(parsed.sessionStart).toHaveLength(1);
    expect(parsed.notification).toHaveLength(1);
    expect(parsed.configChange).toHaveLength(1);
  });

  it("supports worktreeCreate event type", () => {
    const parsed = HooksConfigSchema.parse({
      worktreeCreate: [{ id: "test-wt", matcher: "" }],
    });
    expect(parsed.worktreeCreate).toHaveLength(1);
  });

  it("all event fields are optional", () => {
    const parsed = HooksConfigSchema.parse({});
    expect(parsed.preToolUse).toBeUndefined();
    expect(parsed.postToolUse).toBeUndefined();
    expect(parsed.sessionStart).toBeUndefined();
    expect(parsed.notification).toBeUndefined();
    expect(parsed.configChange).toBeUndefined();
    expect(parsed.worktreeCreate).toBeUndefined();
  });
});
