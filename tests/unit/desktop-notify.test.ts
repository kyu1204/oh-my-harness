import { describe, it, expect } from "vitest";

import { desktopNotify } from "../../src/catalog/blocks/desktop-notify.js";

describe("desktopNotify block", () => {
  it("has correct metadata", () => {
    expect(desktopNotify.id).toBe("desktop-notify");
    expect(desktopNotify.event).toBe("Notification");
    expect(desktopNotify.matcher).toBe("");
    expect(desktopNotify.canBlock).toBe(false);
  });

  it("has no params", () => {
    expect(desktopNotify.params).toEqual([]);
  });

  it("template handles macOS via osascript", () => {
    expect(desktopNotify.template).toContain("osascript");
  });

  it("template handles Linux via notify-send", () => {
    expect(desktopNotify.template).toContain("notify-send");
  });

  it("does not contain _log_event wrapper", () => {
    expect(desktopNotify.template).not.toContain("_log_event");
  });
});
