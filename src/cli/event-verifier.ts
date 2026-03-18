import { readEvents, type HookEvent } from "./event-logger.js";

export interface EventVerification {
  verified: boolean;
  matchedEvent?: HookEvent;
  warning?: string;
}

// 테스트 실행 전 스냅샷 카운트 가져오기
export async function getEventSnapshot(projectDir: string): Promise<number> {
  const events = await readEvents(projectDir);
  return events.length;
}

// 테스트 실행 후 새 이벤트에서 hook 매칭 확인
export async function verifyEventLogged(
  projectDir: string,
  snapshotCount: number,
  expectedHook: string,
  expectedDecision: "block" | "allow",
): Promise<EventVerification> {
  const events = await readEvents(projectDir);
  const newEvents = events.slice(snapshotCount);

  if (newEvents.length === 0) {
    return { verified: false, warning: "No new events recorded in events.jsonl" };
  }

  // hook 이름 매칭 (정규화 후 동등 비교: catalog-command-guard.sh → command-guard)
  const normalize = (name: string): string =>
    name.replace(/\.sh$/, "").replace(/^catalog-/, "").replace(/^harness-/, "");

  const normalizedExpected = normalize(expectedHook);
  const matched = newEvents.find((e) => normalize(e.hook) === normalizedExpected);

  if (!matched) {
    return { verified: false, warning: `No event found for hook "${expectedHook}"` };
  }

  if (matched.decision !== expectedDecision) {
    return {
      verified: false,
      matchedEvent: matched,
      warning: `Event logged decision="${matched.decision}" but expected "${expectedDecision}"`,
    };
  }

  return { verified: true, matchedEvent: matched };
}
