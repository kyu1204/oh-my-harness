import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { openInBrowser, browserCommandFor } from "../../src/cli/tui/open-browser.js";

describe("browserCommandFor", () => {
  it("picks the platform opener", () => {
    expect(browserCommandFor("darwin", "https://x")).toEqual(["open", ["https://x"]]);
    expect(browserCommandFor("linux", "https://x")).toEqual(["xdg-open", ["https://x"]]);
    expect(browserCommandFor("win32", "https://x")).toEqual(["cmd", ["/c", "start", "", "https://x"]]);
  });
});

describe("openInBrowser", () => {
  it("spawns detached and resolves true when the opener starts", async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawn = vi.fn(() => child);
    const result = openInBrowser("https://x", { spawn, platform: "darwin" });
    child.emit("spawn");
    await expect(result).resolves.toBe(true);
    expect(spawn).toHaveBeenCalledWith("open", ["https://x"], expect.objectContaining({ detached: true }));
    expect(child.unref).toHaveBeenCalled();
  });

  it("resolves false instead of throwing when no opener is available", async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawn = vi.fn(() => child);
    const result = openInBrowser("https://x", { spawn, platform: "linux" });
    child.emit("error", new Error("ENOENT"));
    await expect(result).resolves.toBe(false);
  });

  it("wraps the URL in an OSC 8 hyperlink with the plain URL as visible text", async () => {
    const { hyperlink } = await import("../../src/cli/tui/open-browser.js");
    const ESC = String.fromCharCode(27);
    expect(hyperlink("https://x/y?z=1")).toBe(`${ESC}]8;;https://x/y?z=1${ESC}\\https://x/y?z=1${ESC}]8;;${ESC}\\`);
  });

  it("refuses non-http URLs", async () => {
    const spawn = vi.fn();
    await expect(openInBrowser("file:///etc/passwd", { spawn, platform: "darwin" })).resolves.toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
});
