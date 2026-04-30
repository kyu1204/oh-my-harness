import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { notifyIfUpdateAvailable } from "../../src/cli/version-notifier.js";

const PKG = { name: "oh-my-harness", version: "0.10.2" };

describe("notifyIfUpdateAvailable", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("skips when OMH_SKIP_VERSION_CHECK=1", () => {
    process.env.OMH_SKIP_VERSION_CHECK = "1";
    const result = notifyIfUpdateAvailable(PKG);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("OMH_SKIP_VERSION_CHECK");
    expect(result.notifier).toBeNull();
  });

  it("skips when OMH_SKIP_VERSION_CHECK=true", () => {
    process.env.OMH_SKIP_VERSION_CHECK = "true";
    const result = notifyIfUpdateAvailable(PKG);
    expect(result.skipped).toBe(true);
  });

  it("does not skip when OMH_SKIP_VERSION_CHECK is empty string", () => {
    process.env.OMH_SKIP_VERSION_CHECK = "";
    process.env.NO_UPDATE_NOTIFIER = "1"; // suppress real network behavior
    const result = notifyIfUpdateAvailable(PKG);
    expect(result.skipped).toBe(false);
  });

  it("does not skip when OMH_SKIP_VERSION_CHECK=0", () => {
    process.env.OMH_SKIP_VERSION_CHECK = "0";
    process.env.NO_UPDATE_NOTIFIER = "1";
    const result = notifyIfUpdateAvailable(PKG);
    expect(result.skipped).toBe(false);
  });

  it("returns notifier instance when not skipped", () => {
    delete process.env.OMH_SKIP_VERSION_CHECK;
    process.env.NO_UPDATE_NOTIFIER = "1";
    const result = notifyIfUpdateAvailable(PKG);
    expect(result.notifier).not.toBeNull();
  });

  it("never throws on errors — best-effort by design", () => {
    delete process.env.OMH_SKIP_VERSION_CHECK;
    process.env.NO_UPDATE_NOTIFIER = "1";
    expect(() => notifyIfUpdateAvailable(PKG)).not.toThrow();
  });
});
