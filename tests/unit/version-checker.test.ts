import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchLatestVersion } from "../../src/cli/version-checker.js";

describe("fetchLatestVersion", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns version on 200 response", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ version: "1.2.3" }),
        }) as unknown as Response,
    );
    expect(await fetchLatestVersion("foo")).toBe("1.2.3");
  });

  it("returns null on non-ok response", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: false,
          json: async () => ({}),
        }) as unknown as Response,
    );
    expect(await fetchLatestVersion("foo")).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network failure");
    });
    expect(await fetchLatestVersion("foo")).toBeNull();
  });

  it("returns null when version field is missing", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({}),
        }) as unknown as Response,
    );
    expect(await fetchLatestVersion("foo")).toBeNull();
  });

  it("uses custom registry when provided", async () => {
    let calledUrl = "";
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      calledUrl = String(url);
      return {
        ok: true,
        json: async () => ({ version: "0.0.1" }),
      } as unknown as Response;
    });
    await fetchLatestVersion("bar", { registry: "https://example.com" });
    expect(calledUrl).toBe("https://example.com/bar/latest");
  });

  it("URL-encodes scoped package names", async () => {
    let calledUrl = "";
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      calledUrl = String(url);
      return {
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      } as unknown as Response;
    });
    await fetchLatestVersion("@scope/pkg");
    expect(calledUrl).toContain("%40scope%2Fpkg");
  });

  it("normalizes registry trailing slash", async () => {
    let calledUrl = "";
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      calledUrl = String(url);
      return {
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      } as unknown as Response;
    });
    await fetchLatestVersion("foo", { registry: "https://example.com/" });
    expect(calledUrl).toBe("https://example.com/foo/latest");
  });

  it("aborts on timeout", async () => {
    globalThis.fetch = vi.fn(async (_url, opts: RequestInit | undefined) => {
      return new Promise<Response>((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    expect(await fetchLatestVersion("foo", { timeoutMs: 10 })).toBeNull();
  });
});
