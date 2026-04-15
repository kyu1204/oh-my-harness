import fs from "node:fs/promises";
import path from "node:path";

export interface HookEvent {
  ts: string;
  event: string;
  hook: string;
  decision: "block" | "allow" | "error";
  reason?: string;
  tool?: string;
}

const STATE_DIR = ".claude/hooks/.state";
const EVENTS_FILE = "events.jsonl";

export async function appendEvent(
  projectDir: string,
  hookEvent: HookEvent,
): Promise<void> {
  const stateDir = path.join(projectDir, STATE_DIR);
  await fs.mkdir(stateDir, { recursive: true });
  const filePath = path.join(stateDir, EVENTS_FILE);
  await fs.appendFile(filePath, JSON.stringify(hookEvent) + "\n", "utf-8");
}

export async function readEvents(projectDir: string): Promise<HookEvent[]> {
  const filePath = path.join(projectDir, STATE_DIR, EVENTS_FILE);
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  const events: HookEvent[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (
        typeof parsed.ts === "string" &&
        typeof parsed.event === "string" &&
        typeof parsed.hook === "string" &&
        (parsed.decision === "block" || parsed.decision === "allow" || parsed.decision === "error")
      ) {
        events.push(parsed as unknown as HookEvent);
      }
    } catch {
      // 잘못된 줄 무시
    }
  }
  return events;
}

export async function getSessionEvents(
  projectDir: string,
  since?: Date,
): Promise<HookEvent[]> {
  const events = await readEvents(projectDir);
  if (!since) return events;
  return events.filter((e) => new Date(e.ts) >= since);
}

export interface EventStats {
  totalEvents: number;
  blockCount: number;
  allowCount: number;
  errorCount: number;
  byHook: Record<string, { block: number; allow: number; error: number }>;
}

export function aggregateStats(events: HookEvent[]): EventStats {
  const stats: EventStats = {
    totalEvents: events.length,
    blockCount: 0,
    allowCount: 0,
    errorCount: 0,
    byHook: {},
  };

  for (const e of events) {
    if (e.decision === "block") stats.blockCount++;
    else if (e.decision === "error") stats.errorCount++;
    else stats.allowCount++;

    if (!stats.byHook[e.hook]) {
      stats.byHook[e.hook] = { block: 0, allow: 0, error: 0 };
    }
    stats.byHook[e.hook][e.decision]++;
  }

  return stats;
}
