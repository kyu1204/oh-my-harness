import { createHash } from "node:crypto";

/**
 * Ledger (WORKPLAN.md) parsing. The supervisor judges a turn by how the
 * ledger changed, not by what the runtime printed — so these counts are the
 * ground truth for "blocked" and "progress".
 */
export interface LedgerCounts {
  /** Open tasks that are not marked BLOCKED. */
  unchecked: number;
  checked: number;
  /** Open tasks carrying a `BLOCKED:` marker. */
  blocked: number;
}

export interface LedgerDiff {
  ticked: number;
  newBlocked: number;
}

// [BLOCKED] and [-] are non-standard forms real agents write for a skipped
// task; they count as blocked, never as open work.
const CHECKBOX = /^\s*[-*]\s+\[( |x|X|-|BLOCKED)\]/;

export function parseLedger(text: string): LedgerCounts {
  const counts: LedgerCounts = { unchecked: 0, checked: 0, blocked: 0 };
  for (const line of text.split("\n")) {
    const m = CHECKBOX.exec(line);
    // Only checkbox lines count: protocol prose and echoed prompts also
    // contain the literal "BLOCKED:" and must not register.
    if (!m) continue;
    if (m[1] === "x" || m[1] === "X") {
      counts.checked++;
    } else if (m[1] !== " " || line.includes("BLOCKED:")) {
      counts.blocked++;
    } else {
      counts.unchecked++;
    }
  }
  return counts;
}

export function hashLedger(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function diffLedger(before: LedgerCounts, after: LedgerCounts): LedgerDiff {
  return {
    ticked: Math.max(0, after.checked - before.checked),
    newBlocked: Math.max(0, after.blocked - before.blocked),
  };
}
