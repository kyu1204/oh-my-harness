import { describe, it, expect } from "vitest";
import { classifyTurn, waitFor } from "../../src/loop/classify.js";
import type { TurnInput, TurnKind } from "../../src/loop/classify.js";

const SENTINEL = "OMH_GOAL_COMPLETE";
const zero = { unchecked: 0, checked: 0, blocked: 0 };

function input(over: Partial<TurnInput> = {}): TurnInput {
  return {
    status: 0,
    signal: null,
    timedOut: false,
    tail: "did some work\n",
    sentinel: SENTINEL,
    ledgerBefore: { unchecked: 2, checked: 0, blocked: 0 },
    ledgerAfter: { unchecked: 2, checked: 0, blocked: 0 },
    headBefore: "aaa",
    headAfter: "aaa",
    ...over,
  };
}

describe("classifyTurn (table)", () => {
  const cases: Array<[string, Partial<TurnInput>, TurnKind, boolean?]> = [
    ["usage limit with a NON-ZERO exit (the usual case) → limit, not error",
      { status: 1, tail: "Usage limit reached. Resets at 3pm.\n" }, "limit"],
    ["usage limit with a commit is still progress even on exit 1 → error path",
      { status: 1, tail: "rate limit note\n", headAfter: "bbb" }, "error"],
    ["timeout beats the limit pattern", { status: null, signal: "SIGKILL", timedOut: true, tail: "usage limit" }, "crash"],
    ["clean exit, sentinel, nothing left → complete",
      { tail: "done\nOMH_GOAL_COMPLETE\n", ledgerAfter: { unchecked: 0, checked: 2, blocked: 0 }, headAfter: "bbb" }, "complete"],
    ["crashed turn (exit 1, no output) → crash", { status: 1, tail: "   \n" }, "crash"],
    ["timeout kill → crash", { status: null, signal: "SIGKILL", timedOut: true, tail: "partial" }, "crash"],
    ["exit 1 WITH the sentinel → error, never complete",
      { status: 1, tail: "boom\nOMH_GOAL_COMPLETE\n", ledgerAfter: zero }, "error"],
    ["sentinel while unchecked tasks remain → ignored, classified normally (idle)",
      { tail: "OMH_GOAL_COMPLETE\n" }, "idle", true],
    ["sentinel while unchecked remain but HEAD moved → ignored + progress",
      { tail: "OMH_GOAL_COMPLETE\n", headAfter: "bbb" }, "progress", true],
    ["sentinel outside the last 5 non-empty lines → not seen",
      { tail: "OMH_GOAL_COMPLETE\n1\n2\n3\n4\n5\n", ledgerAfter: zero }, "idle", false],
    ["sentinel as a substring → not seen", { tail: "OMH_GOAL_COMPLETE!\n", ledgerAfter: zero }, "idle", false],
    ["sentinel with surrounding whitespace on its line → seen",
      { tail: "  OMH_GOAL_COMPLETE  \n\n", ledgerAfter: zero }, "complete"],
    ["usage limit text, no progress → limit", { tail: "Usage limit reached. Try again later." }, "limit"],
    ["rate-limit text but a commit landed → progress, not limit",
      { tail: "read docs about rate limiting\n", headAfter: "bbb" }, "progress"],
    ["new BLOCKED marker, no commit → blocked",
      { ledgerAfter: { unchecked: 1, checked: 0, blocked: 1 } }, "blocked"],
    ["new BLOCKED marker AND a commit → progress",
      { ledgerAfter: { unchecked: 1, checked: 0, blocked: 1 }, headAfter: "bbb" }, "progress"],
    ["checkbox ticked without a commit → progress",
      { ledgerAfter: { unchecked: 1, checked: 1, blocked: 0 } }, "progress"],
    ["nothing changed, clean exit → idle", {}, "idle"],
    ["exit 2 with output → error", { status: 2, tail: "Traceback" }, "error"],
  ];

  for (const [name, over, kind, ignored] of cases) {
    it(name, () => {
      const c = classifyTurn(input(over));
      expect(c.kind).toBe(kind);
      if (ignored !== undefined) expect(c.sentinelIgnored).toBe(ignored);
    });
  }
});

describe("waitFor", () => {
  const knobs = { interval: 120, limitBackoff: 1800, emptyBackoff: 300, blockedBackoff: 900, stallStreak: 3 };
  it("maps each kind to its wait in milliseconds", () => {
    expect(waitFor("limit", 0, knobs)).toBe(1800_000);
    expect(waitFor("crash", 0, knobs)).toBe(300_000);
    expect(waitFor("progress", 0, knobs)).toBe(120_000);
    expect(waitFor("error", 5, knobs)).toBe(900_000);
    expect(waitFor("complete", 0, knobs)).toBe(120_000);
  });
  it("backs off on blocked/idle only once the stall streak is reached", () => {
    expect(waitFor("blocked", 2, knobs)).toBe(120_000);
    expect(waitFor("blocked", 3, knobs)).toBe(900_000);
    expect(waitFor("idle", 2, knobs)).toBe(120_000);
    expect(waitFor("idle", 4, knobs)).toBe(900_000);
  });
  it("persistent errors reach the stall backoff too — no full-pace retry forever", () => {
    expect(waitFor("error", 2, knobs)).toBe(120_000);
    expect(waitFor("error", 3, knobs)).toBe(900_000);
  });
});
