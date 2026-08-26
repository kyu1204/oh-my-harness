import type { LedgerCounts } from "./ledger.js";

/**
 * Turn classification. Judged from STATE — the ledger diff and git HEAD —
 * rather than from what the runtime printed. Output text is consulted for
 * exactly two things, the sentinel and the usage-limit pattern, and both are
 * ANDed with a state condition so an echoed prompt or a file that happens to
 * mention "rate limit" cannot steer the loop.
 */
export type TurnKind = "complete" | "limit" | "crash" | "error" | "blocked" | "progress" | "idle";

export interface TurnInput {
  status: number | null;
  signal: NodeJS.Signals | null;
  /** The runtime was killed by the supervisor's turn timeout. */
  timedOut: boolean;
  /** Last part of the turn's output (a few KB is plenty). */
  tail: string;
  sentinel: string;
  ledgerBefore: LedgerCounts;
  ledgerAfter: LedgerCounts;
  headBefore: string;
  headAfter: string;
}

export interface Classification {
  kind: TurnKind;
  /** The sentinel was printed but tasks remain open — treated as not done. */
  sentinelIgnored: boolean;
}

export interface WaitKnobs {
  interval: number;
  limitBackoff: number;
  emptyBackoff: number;
  blockedBackoff: number;
  stallStreak: number;
}

const LIMIT = /usage limit|limit reached|rate.?limit/i;
const SENTINEL_WINDOW = 5;

function sentinelSeen(tail: string, sentinel: string): boolean {
  const lines = tail.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.slice(-SENTINEL_WINDOW).some((l) => l === sentinel);
}

export function classifyTurn(i: TurnInput): Classification {
  const none = { sentinelIgnored: false };

  if (i.timedOut || (i.status !== 0 && i.tail.trim() === "")) return { kind: "crash", ...none };
  // Any non-zero exit is not a completed goal, whatever the output says.
  if (i.status !== 0) return { kind: "error", ...none };

  const progress = i.headAfter !== i.headBefore || i.ledgerAfter.checked > i.ledgerBefore.checked;

  let sentinelIgnored = false;
  if (sentinelSeen(i.tail, i.sentinel)) {
    if (i.ledgerAfter.unchecked === 0) return { kind: "complete", sentinelIgnored: false };
    sentinelIgnored = true;
  }

  if (LIMIT.test(i.tail) && !progress) return { kind: "limit", sentinelIgnored };
  if (i.ledgerAfter.blocked > i.ledgerBefore.blocked && !progress) return { kind: "blocked", sentinelIgnored };
  if (progress) return { kind: "progress", sentinelIgnored };
  return { kind: "idle", sentinelIgnored };
}

export function waitFor(kind: TurnKind, stallStreak: number, k: WaitKnobs): number {
  switch (kind) {
    case "limit":
      return k.limitBackoff * 1000;
    case "crash":
      return k.emptyBackoff * 1000;
    case "blocked":
    case "idle":
      return (stallStreak >= k.stallStreak ? k.blockedBackoff : k.interval) * 1000;
    default:
      return k.interval * 1000;
  }
}
