import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

function makeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  return proc;
}

describe("codex-oauth provider", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    vi.useRealTimers();
  });

  it("runs codex exec with cached OAuth auth and returns the final stdout", async () => {
    const proc = makeProcess();
    spawnMock.mockReturnValue(proc);
    const { createCodexOauthProvider } = await import("../../src/nl/providers/codex-oauth.js");
    const provider = createCodexOauthProvider("codex", "gpt-5.4");

    const resultPromise = provider.run("Generate JSON only");

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "-m", "gpt-5.4", "-"]),
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
    expect(proc.stdin.write).toHaveBeenCalledWith("Generate JSON only");
    expect(proc.stdin.end).toHaveBeenCalledOnce();

    proc.stdout.emit("data", Buffer.from("  final answer\n"));
    proc.emit("close", 0);

    await expect(resultPromise).resolves.toBe("final answer");
  });

  it("turns missing codex CLI into an actionable login/install error", async () => {
    const proc = makeProcess();
    spawnMock.mockReturnValue(proc);
    const { createCodexOauthProvider } = await import("../../src/nl/providers/codex-oauth.js");
    const provider = createCodexOauthProvider("missing-codex", "gpt-5.4");

    const resultPromise = provider.run("test");
    proc.emit("error", Object.assign(new Error("not found"), { code: "ENOENT" }));

    await expect(resultPromise).rejects.toThrow("Codex CLI not found");
  });

  it("includes stderr and login guidance when codex exec exits non-zero", async () => {
    const proc = makeProcess();
    spawnMock.mockReturnValue(proc);
    const { createCodexOauthProvider } = await import("../../src/nl/providers/codex-oauth.js");
    const provider = createCodexOauthProvider("codex", "gpt-5.4");

    const resultPromise = provider.run("test");
    proc.stderr.emit("data", Buffer.from("auth expired"));
    proc.emit("close", 1);

    await expect(resultPromise).rejects.toThrow("auth expired");
    await expect(resultPromise).rejects.toThrow("codex login");
  });

  it("rejects non-zero codex exec exits even when stdout was produced", async () => {
    const proc = makeProcess();
    spawnMock.mockReturnValue(proc);
    const { createCodexOauthProvider } = await import("../../src/nl/providers/codex-oauth.js");
    const provider = createCodexOauthProvider("codex", "gpt-5.4");

    const resultPromise = provider.run("test");
    proc.stdout.emit("data", Buffer.from("partial output"));
    proc.emit("close", 2);

    await expect(resultPromise).rejects.toThrow("exited with code 2");
    await expect(resultPromise).rejects.toThrow("partial output");
  });

  it("defaults Codex exec to gpt-5.5 when no model is configured", async () => {
    const proc = makeProcess();
    spawnMock.mockReturnValue(proc);
    const { createCodexOauthProvider } = await import("../../src/nl/providers/codex-oauth.js");
    const provider = createCodexOauthProvider("codex");

    const resultPromise = provider.run("test");

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["-m", "gpt-5.5"]),
      expect.any(Object),
    );

    proc.stdout.emit("data", Buffer.from("ok"));
    proc.emit("close", 0);
    await expect(resultPromise).resolves.toBe("ok");
  });

  it("kills codex exec and rejects when the CLI hangs past the timeout", async () => {
    vi.useFakeTimers();
    const proc = makeProcess();
    const killMock = vi.fn();
    Object.assign(proc, { kill: killMock });
    spawnMock.mockReturnValue(proc);
    const { createCodexOauthProvider } = await import("../../src/nl/providers/codex-oauth.js");
    const provider = createCodexOauthProvider("codex", "gpt-5.5", { timeoutMs: 100 });

    const resultPromise = provider.run("hang");
    const rejection = expect(resultPromise).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(100);

    expect(killMock).toHaveBeenCalledWith("SIGTERM");
    await rejection;
  });
});
