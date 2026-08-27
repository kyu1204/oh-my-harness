import { describe, it, expect } from "vitest";
import { parseLedger, hashLedger, diffLedger } from "../../src/loop/ledger.js";

describe("parseLedger", () => {
  it("returns zeros for an empty ledger", () => {
    expect(parseLedger("")).toEqual({ unchecked: 0, checked: 0, blocked: 0 });
  });

  it("counts unchecked and checked boxes with -, * and x/X markers", () => {
    const text = ["- [ ] a", "- [x] b", "- [X] c", "* [ ] d", "+ [ ] plus", "not a task", "  - [ ] indented"].join("\n");
    expect(parseLedger(text)).toEqual({ unchecked: 4, checked: 2, blocked: 0 });
  });

  it("counts BLOCKED tasks separately and not as unchecked", () => {
    const text = ["- [ ] e BLOCKED: no work order", "- [ ] f"].join("\n");
    expect(parseLedger(text)).toEqual({ unchecked: 1, checked: 0, blocked: 1 });
  });

  it("ignores BLOCKED mentions outside checkbox lines (protocol prose, prompt echoes)", () => {
    const text = ["Mark the task `BLOCKED: <reason>` and move on.", "BLOCKED: is how we flag things", "- [ ] g"].join("\n");
    expect(parseLedger(text)).toEqual({ unchecked: 1, checked: 0, blocked: 0 });
  });
});

describe("parseLedger — non-standard BLOCKED forms", () => {
  it("counts [BLOCKED] and [-] boxes as blocked, not as unchecked", () => {
    const text = ["- [BLOCKED] a needs a human", "- [-] b skipped", "- [ ] c"].join("\n");
    expect(parseLedger(text)).toEqual({ unchecked: 1, checked: 0, blocked: 2 });
  });
});

describe("hashLedger", () => {
  it("is deterministic, 64 hex chars, and sensitive to a single character", () => {
    const a = hashLedger("- [ ] a");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLedger("- [ ] a")).toBe(a);
    expect(hashLedger("- [x] a")).not.toBe(a);
  });
});

describe("diffLedger", () => {
  it("reports ticked and newly blocked counts, never negative", () => {
    const before = { unchecked: 3, checked: 1, blocked: 0 };
    const after = { unchecked: 0, checked: 3, blocked: 1 };
    expect(diffLedger(before, after)).toEqual({ ticked: 2, newBlocked: 1 });
    expect(diffLedger(after, before)).toEqual({ ticked: 0, newBlocked: 0 });
  });
});
