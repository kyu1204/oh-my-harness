# 루프 엔진 TypeScript 재구축 원장

> 단일 진실원본. 체크박스가 곧 진행 상태다. 어떤 세션이 죽어도 이 문서 + `git log`만으로 이어받는다.
> 구현은 `docs/work-orders/L-XX.md` 지시서 그대로. 지시서 없으면 `BLOCKED: no work order`.

## 0. 배경 (왜 다시 만드나)

PR #94의 자율 루프 엔진은 문자열 템플릿 bash 슈퍼바이저(`renderRunner` ~250줄) + 렌더 문자열 단언 테스트(77개 중 28개)로 만들어졌다. 8라운드 리뷰 30건+, 전수조사 16건의 결함이 나왔고 치명 1건이 남아 있다: **러너 프롬프트에 `BLOCKED: no work order` 문자열이 있어 프롬프트를 에코하는 런타임(codex exec)에서 매 턴이 BLOCKED로 오판 → 3턴 뒤 영구 30분 백오프.** 그 외 worktree 미해제, stop이 턴 경계에서만 반영, 규칙 텍스트 3중 복제, Codex에서 loop-guard matcher에 `apply_patch` 별칭 누락으로 가드 미발동.

근본 원인: "슈퍼바이저를 bash로, 테스트는 문자열로"라는 초기 설계. 패치가 아니라 **TypeScript 재구축**으로 간다. 제품 동작(스킬 → 원장·지시서 → 백그라운드 루프 → 모니터링, 3런타임 공통)은 유지.

## 1. 골 정의 (DoD 게이트) — 전부 검증 가능해야 달성

- [x] **G1 코드**: `src/loop/` 7모듈 + `omh loop start|run|stop|status|clean` 존재. `src/generators/loop-assets.ts`에 `renderRunner`·`stopRunningLoop`·`shellSingleQuote` 없음. `.omh/loop/run.sh` 생성 안 됨.
- [x] **G2 품질**: `npm run lint`(tsc) 클린, `npx vitest run` 전부 통과, 렌더 문자열 단언 테스트 27개 제거됨(`grep -c "toContain(\"OMH_LOOP" tests/unit/loop-assets.test.ts` = 0).
- [x] **G3 판정 정확성**: 통합 매트릭스 12케이스 녹색(§5 T-09). 특히 "프롬프트 에코 런타임에서 BLOCKED 오판 없음" 케이스.
- [x] **G4 프로세스 수명**: e2e(§5 T-13)에서 `omh loop start`가 detach 후 즉시 반환, `stop`이 긴 턴 중에도 15초 내 프로세스 그룹 소멸, `already-running` 배타.
- [x] **G5 dogfood**: 이 저장소에서 `omh sync` → SKILL.md·loop-guard·CLAUDE.md 섹션 생성, `omh sync --check` = up to date.
- [x] **G6 문서**: README 루프 섹션이 `omh loop` 명령·새 knob·`.omh/state/loop/` 트리 반영.
- [x] **G7 실 QA 통과 (stub 아님)**: tmux에서 **실제 Claude Code · Codex · Pi** 각각으로 §5 Phase F의 QA 시나리오를 완주. 런타임당 통과 기준 전부 충족: ① `omh loop start` 즉시 반환 + `run.json` 출현 ② 1회차 턴이 지시서를 구현하고 `omh-loop` 브랜치에 커밋(`progress` 이벤트 + reflog 커밋 감지) ③ 원장 체크박스 실제 갱신 ④ **가드 함정 태스크**에서 loop-guard 차단 이벤트(`.omh/state/events.jsonl`에 `catalog-loop-guard` block) 발생 + 루프가 `BLOCKED:` 표기 후 다음으로 진행 ⑤ 골 완료 시 `complete` 이벤트 + 프로세스 그룹 소멸 ⑥ 별도 실행에서 긴 턴 중 `omh loop stop` → 15s 내 그룹 소멸 ⑦ 프롬프트 에코(Codex)에서 BLOCKED 오판 없음(이벤트 로그에 근거 없는 `blocked` 0건). 결과는 §7 진행 로그에 런타임별 이벤트 발췌로 기록.
- 골에서 제외(사용자 승인 액션): PR 머지, 릴리스 태그.

## 2. 루프 프로토콜

- 픽업: §5에서 가장 앞선 `[ ]` 태스크 하나. 선행 태스크(depends)가 미완이면 건너뛰지 말고 `BLOCKED: depends L-XX` 표기.
- **TDD 강제**: 지시서의 테스트 파일을 먼저 작성 → `npx vitest run <file>`로 **실패 확인** → 최소 구현 → 통과. 실패 확인 없이 구현 금지(이 저장소의 tdd-guard 훅이 소스 편집을 차단한다).
- 검증 없이 체크 금지: 지시서의 "검증 명령" 전부 통과해야 `[x]`.
- 역검증: 판정 로직(L-02, L-06) 태스크는 구현을 되돌려 테스트가 실패하는지 확인 후 원복.
- 커밋: 태스크 1개 = 커밋 1개. 메시지 첫 줄 `loop: L-XX <요약>`. 커밋 전 `npm run lint && npx vitest run`.
- BLOCKED: 사람 액션 필요 또는 3회 실패 시 `BLOCKED: <사유>` 표기 후 다음 태스크. 전부 BLOCKED면 골 미달성 보고.
- 자기승인 금지: 루프는 지시서를 쓰지 않는다. 지시서 부재 = BLOCKED.
- **아키텍트 전용 영역(루프 편집 금지)**: `WORKPLAN-LOOP.md` §1~§4·§6, `docs/work-orders/*`, `harness.yaml`, `src/generators/codex-config.ts`(L-10 지시서 범위 내 1줄 제외), **Phase F 실 QA 태스크 전부(L-16~L-18)** — 실제 런타임 인증·토큰이 필요한 사용자 환경 작업.
- 진행 로그(§7)는 매 반복 1줄 갱신.

## 3. 결정 로그

- **D1 슈퍼바이저는 TS, 생성 셸은 훅 하나만.** 런타임 호출은 argv 배열 spawn(셸 미경유) → quoting 결함 계급 소멸.
- **D2 잠금 = `run.json` 하나.** `fs.linkSync(tmp, run.json)`의 원자성(EEXIST)이 잠금, 내용(pid·runId)이 소유자. stale = pid 사망 **또는** `ps -o args= -p pid`에 `--run-id <id>` 없음. 회수 = `rename(run.json, run.json.stale-<mypid>)`(한 쪽만 성공) → unlink → link 재시도 1회. 패자 exit 3.
- **D3 프로세스 그룹.** `start`는 `detached:true`(setsid, pid==pgid)로 `run`을 띄우고, 턴 자식은 detached 없이 같은 그룹. `stop` = `kill(-pid, SIGTERM)` → 10s → `SIGKILL`. 슈퍼바이저가 SIGKILL돼도 자식 도달.
- **D4 stop 플래그는 `start`가 지우고 `run`은 절대 지우지 않는다.** (start~잠금 사이 stop 유실 방지)
- **D5 detached 바이너리 해석**: `spawn(process.execPath, [...process.execArgv, process.argv[1], "loop","run","--run-id",id,"-d",dir])`. `execArgv` 전달로 tsx(`npm run dev`)·npx·글로벌 모두 동작. `run.json` 출현 또는 자식 종료 확인(100ms 폴링, 15s) 후에만 `unref()`.
- **D6 판정은 출력 grep이 아니라 상태 diff.** blocked = 원장 `BLOCKED:` 증가, progress = HEAD 이동 또는 체크 증가, idle = 둘 다 아님. sentinel은 exit 0 AND 마지막 5개 비공백 줄 전체 일치 AND **후행 원장에 미완료(미BLOCKED) 태스크 0** — 아니면 `sentinel-ignored`. limit = 패턴 AND progress 없음.
- **D7 원장 시드는 run 시작 1회, 기준은 `seed.json{ledgerHash}`(run 간 지속).** worktree 원장 없음 또는 해시 다름 → 복사. 크래시 후 같은 골 재시작은 체크 상태 유지. 알려진 한계: 실행 중 메인 원장 편집 → 다음 재시작에 재시드(문서화).
- **D8 worktree 엣지**: 브랜치 있음/worktree 없음 → `-b` 없이 add + `worktree-reused`; 디렉터리 있으나 미등록 → `prune` 후 비어있지 않으면 `WorktreeError`(미커밋 보호); 메인이 `omh-loop`면 프리플라이트 에러; 해제 `remove --force --force`, 브랜치 보존.
- **D9 자산 동기화는 매 반복**(백오프 중 추가된 지시서 도달), `fs.cp(force)`, 소스 없음 skip·실패 throw. 원장은 목록에 없음(D7).
- **D10 스키마**: `shellSafePath`→`relPath`(canonical 상대경로 refine만 유지, 따옴표 금지 제거). 추가 knob `limitBackoff:1800`, `emptyBackoff:300`, `stallStreak:3`, `turnTimeout:7200`.
- **D11 과설계 제거**: lock.ts·backoff.ts·events.ts·paths.ts 별도 모듈 없음(7파일), 슈퍼바이저 주입은 `runTurn`·`sleep`만, `status --follow` 없음(감시는 `tail -f`), 가드 마커파일 폴백 없음(env 상속 3런타임 검증됨).
- **D12 POSIX 전용** 선언(`win32` → exit 1 + 메시지).
- **D13 Codex matcher 일반화**: `normalizeMatcher`가 `split("|")`에 Edit/Write 포함 시 `apply_patch` 추가.

## 4. 아키텍처 요약 (`src/loop/`)

| 파일 | exports |
|---|---|
| `state.ts` | `loopPaths`, `RunInfo`, `acquireRun/updateRun/readRun/releaseRun/isRunLive`, `appendEvent/readEvents`, `pruneRuns(keep=5)`, `atomicWrite` |
| `ledger.ts` | `parseLedger`→`{unchecked,checked,blocked}`, `hashLedger`, `diffLedger`→`{ticked,newBlocked}` |
| `classify.ts` | `classifyTurn(input): TurnKind`, `waitFor(kind, streak, cfg)` |
| `runtime.ts` | `buildTurnArgv(runtime, model, prompt)`, `runTurn({argv,cwd,env,logPath,timeoutMs,shouldStop})`→`{status,signal,tail}` |
| `worktree.ts` | `git`, `ensureWorktree`, `syncAssets`, `seedLedger`, `removeWorktree`, `headOf`, `WorktreeError` |
| `protocol.ts` | `LOOP_RULES(cfg)` → `renderPrompt`/`renderProtocolSection`/`renderSkill` |
| `supervisor.ts` | `runSupervisor({projectDir,cfg,runId}, deps={runTurn,sleep})` |
| `src/cli/commands/loop.ts` | `loopStart/Run/Stop/Status/CleanCommand` → `{exitCode}`, `stopLoop(projectDir,{graceMs})` |

상태 레이아웃: `.omh/state/loop/{run.json, stop, seed.json, runs/<runId>/{events.jsonl, turns/NNN.log}}`, worktree `.omh/loop/worktree`, 브랜치 `omh-loop`.

## 5. 태스크 (Phase별, ID = 지시서)

### Phase A — 순수 모듈 (I/O 없음, 빠른 테스트)
- [x] **L-01** `ledger.ts` — 테스트 `tests/unit/loop-ledger.test.ts`. `- [ ]`/`- [x]`/`- [X]` 카운트, `BLOCKED:` 카운트, sha256 해시, diff. 검증: `npx vitest run tests/unit/loop-ledger.test.ts`.
- [x] **L-02** `classify.ts` — 테스트 `loop-classify.test.ts` 테이블 주도: 7 kind 전부, 크래시+sentinel→error, 미완료 잔존+sentinel→ignored, rate-limit 텍스트+커밋→progress, timeout SIGKILL→crash, `waitFor` 4행. depends L-01. 역검증 필수.
- [x] **L-03** `protocol.ts` — 테스트 `loop-protocol.test.ts`: 세 렌더러가 `LOOP_RULES` 모든 줄 포함, 스킬이 `omh loop start`·`tail -f .omh/state/loop/runs/` 안내, architectOnly 이름 그대로 노출, **프롬프트에 `BLOCKED:` 리터럴이 있어도 판정과 무관함을 주석으로 명시**(D6).

### Phase B — I/O 모듈
- [x] **L-04** `state.ts` — 테스트 `loop-state.test.ts`: acquire 2회→두 번째 false; 죽은 pid 회수; ps argv 불일치 회수(현재 프로세스 pid를 다른 run-id로 기록); 소유자만 release; 이벤트 append/read; prune 5; `atomicWrite` inode 교체. depends 없음.
- [x] **L-05** `runtime.ts` — 테스트 `loop-runtime.test.ts`: 런타임별 argv(claude `--model M --dangerously-skip-permissions -p P`, codex `exec --model M --dangerously-bypass-approvals-and-sandbox P`, pi `--print --no-session --model M P`); stub 스크립트 → status/tail/로그 파일; timeout kill→signal; `trap '' TERM` stub + `shouldStop` → SIGTERM→SIGKILL 에스컬레이션(유예 200ms 주입).
- [x] **L-06** `worktree.ts` — 테스트 `loop-worktree.test.ts`(temp git repo): add; 기존 브랜치 재사용 이벤트; 미등록 비어있지 않은 dir→`WorktreeError`; 메인이 omh-loop→에러; 미커밋 자산 복사(.claude/.codex/.pi/.omh/hooks/work-orders/CLAUDE.md/AGENTS.md/harness.yaml); 시드 첫/새 해시/같은 해시; dirty tree `--force --force` 해제; `--branch`. depends L-01, L-04. 역검증 필수.

### Phase C — 슈퍼바이저·스키마
- [x] **L-07** 스키마·타입 — 테스트 `loop-config.test.ts` 갱신: `relPath`(따옴표 허용, `../x`·`/abs`·`./x`·후행 `/` 거부), knob 4개 기본값·양수, `LoopConfig` 확장. 파일: `src/core/harness-schema.ts`, `src/core/merged-config.ts`.
- [x] **L-08** `supervisor.ts` — 테스트 `loop-supervisor.test.ts`(in-process, `runTurn`/`sleep` 주입, stub이 temp repo를 실제 변경). depends L-01~L-07.
- [x] **L-09** 통합 매트릭스 12케이스(같은 테스트 파일에 추가): complete · 크래시 후 sentinel · 미완료 잔존+sentinel→ignored 후 계속 · limit → limitBackoff · 원장 BLOCKED ×3 → blockedBackoff · idle ×3 → blockedBackoff · 긴 턴 중 stop 플래그 · 동시 `runSupervisor` 2 → 하나 `already-running` · stale run.json 회수 · 실행 중 disable → run.json 소멸·worktree 제거 · 시드/재시드 3케이스 · **stub이 프롬프트를 에코해도 BLOCKED 오판 없음**. depends L-08.

### Phase D — CLI·생성기 배선
- [x] **L-10** `codex-config.ts` `normalizeMatcher` 일반화 — 테스트 `codex-config-generator.test.ts` 케이스 추가(`Edit|Write|Bash` → `apply_patch` 포함). 지시서 범위 외 변경 금지.
- [x] **L-11** `loop-assets.ts` 축소 + `generator.ts`/`uninstall.ts`/`harness-converter-v2.ts` 배선 — 테스트 `loop-assets.test.ts` 재작성(SKILL.md만, plan 대칭, disable 시 `stopLoop`+worktree 제거, run.sh 부재), `uninstall-loop.test.ts` 갱신. 삭제: `renderRunner`·`runtimeCommand`·`shellSingleQuote`·`stopRunningLoop`·`renderLoopProtocol`·`renderSkill`, `loop-runner-behavior.test.ts`. depends L-03, L-06, L-08.
- [x] **L-12** `src/cli/commands/loop.ts` + `src/cli/index.ts` — 테스트 `cli-loop.test.ts`(mkdtemp + lazy import): 프리플라이트 에러 각각(git repo 아님·원장 없음·지시서 0·메인이 omh-loop·활성 run), win32 → exit 1, `status` 유/무, `stop` with no run → exit 0. `start`의 spawn은 D5 그대로. depends L-08.
- [x] **L-13** e2e `loop-e2e.test.ts`(SLOW=30s) — `node_modules/.bin/tsx bin/oh-my-harness.ts loop start` + stub `claude`(체크 후 sentinel): run.json 출현·start 즉시 반환·`stop`으로 그룹 소멸·`complete` 이벤트; 긴 턴(`sleep 30`) 중 stop → 15s 내 소멸. depends L-12.

### Phase D' — 실 QA(Codex)에서 발견된 결함 (2026-08-26 추가)
- [x] **L-19** loop-guard: Codex `apply_patch` 페이로드(`*** Update File:` 헤더) 파싱·차단 — 실 QA에서 PROTECTED.md 편집이 통과함.
- [x] **L-20** Codex argv에 `--dangerously-bypass-hook-trust` — trust 미저장 프로젝트 훅은 조용히 무시됨.
- [x] **L-21** 종료 시 프로세스 그룹 잔존자 정리 — Codex가 남긴 데몬으로 pgid가 살아남음. depends L-20.

### Phase D'' — PR 체크에서 발견 (2026-08-26, CI 실패 1 + CodeRabbit 미해결 3)
- [x] **L-22** QA 픽스처 스크립트 dist 폴백 — CI(빌드 없음)에서 테스트 실패.
- [x] **L-23** 명시적 `loop-guard` 항목이 loop 경로를 무효화하지 못하게 강제.
- [x] **L-24** `computeUninstall` 계획 단계의 `stopLoop`/worktree 해제 부작용 → 적용 단계로 이동.
- [x] **L-25** `acquireRun` stale 회수 레이스: 회수 잠금 + 관측 레코드 재검증.

### Phase D''' — ultracode 심층 감사 확정 결함 (2026-08-27, 26에이전트 6렌즈+반박검증: 확정 17·기각 3·미검증 1)
- [x] **L-26** classify/ledger: limit 순서·error 백오프·'+' 불릿
- [x] **L-27** state/stop 동시성: updateRun 소유권·rm 재확인·stop 플래그 무조건·reclaim 원자 생성·childPid 정리+정체·고아 턴 회수 거부
- [x] **L-28** supervisor/runtime: 최종 턴그룹 KILL 스윕·git 실패 graceful·unborn HEAD
- [x] **L-29** worktree/generator: 재시드 백업·비활성화 시 dirty worktree 보호
- [x] **L-30** guard/schema: 셸 메타문자 금지 재도입(critical)·sentinel trim·Move to 파싱
- [x] **L-31** 원장·리스크 기록

### Phase E — 문서·dogfood
- [x] **L-14** README 갱신(트리·`omh loop` 명령·knob·POSIX 전용·시드 한계) + 이 저장소 `omh sync` dogfood + `sync --check` up to date. depends L-11, L-12.

### Phase F — 실 QA (tmux, 실제 런타임; **아키텍트 실행** — 인증·토큰 비용이 드는 사용자 환경 작업이라 루프 금지 영역)
공통 픽스처 `L-15`가 만들고, 런타임별로 같은 시나리오를 돌린다. 모니터는 wiki 규칙대로 **기동 직후** 2개 부착(이벤트 `tail -F` + `.git/logs/HEAD` reflog tail) 후 empty commit으로 발화 테스트.

- [x] **L-15** QA 픽스처 생성 스크립트 `scripts/loop-qa-fixture.sh <runtime> <dir>` — temp git repo에: `harness.yaml`(`loop.runtime=<rt>`, `model` = 런타임별 저가 모델, `interval: 5`, `stallStreak: 2`, `blockedBackoff: 20`, `architectOnly: ["PROTECTED.md"]`), `PROTECTED.md`, 원장 `WORKPLAN.md` 4태스크, 지시서 4개:
  - Q-1 `hello.txt`에 `hello` 한 줄 생성. 수용: `test "$(cat hello.txt)" = hello`
  - Q-2 `hello.txt` 끝에 `world` 추가. 수용: `grep -qx world hello.txt`
  - Q-3 **가드 함정**: `PROTECTED.md`에 한 줄 추가하라고 지시(architectOnly 위반). 기대: loop-guard 차단 → 루프가 `BLOCKED: architect-only path` 표기.
  - Q-4 `done.txt` 생성. 수용: `test -f done.txt`
  - 골 게이트: Q-1·Q-2·Q-4 체크 + Q-3 BLOCKED. `omh sync` 실행까지 포함. 검증: 스크립트 실행 후 `omh loop status`가 "no run"·프리플라이트 통과.
- [x] **L-16** 실 QA — **Claude Code**: `tmux new -d -s omh-qa-claude 'cd <dir> && omh loop start'` → G7 ①~⑥ 확인. 통과 근거(이벤트 발췌·커밋 해시)를 §7에 기록. depends L-13, L-15.
- [x] **L-17** 실 QA — **Codex** (`codex exec`): 동일 시나리오 + G7 ⑦(프롬프트 에코 오판 0건) 확인. depends L-16.
- [x] **L-18** 실 QA — **Pi** (`pi --print --no-session`): 동일 시나리오. Pi 브리지 익스텐션 경유 가드 차단(④) 확인이 핵심. depends L-16.
- QA 실패 시: 해당 런타임의 결함을 §6 리스크에 기록하고 원인 태스크를 Phase C/D에 신규 `L-XX`로 추가(아키텍트가 지시서 작성) → 수정 → 해당 런타임 QA 재실행. **3런타임 전부 통과 전에는 G7 미달성.**

## 6. 리스크·알려진 한계

- `ps` 의존(정체 검증): POSIX 전용 선언으로 수용.
- 실행 중 메인 원장 편집 → 재시작 시 재시드(D7). README에 안내.
- 훅은 worktree의 `.omh/state`에 기록(cwd 기준) — 기존 동작, 문서화만.
- e2e는 tsx 경유라 CI 시간 +30s.
- 원장 파서는 `- [ ]`/`- [x]`만 인식한다. Pi(haiku-4.5)가 BLOCKED를 `- [BLOCKED] …` 형식으로 쓴 사례가 있음 — 그 줄은 unchecked/blocked 어느 쪽에도 안 잡혀 완료 판정엔 무해하지만 stall 감지에서 빠진다. 후속: 파서가 `[BLOCKED]`·`[-]` 형식도 blocked로 인식하도록 확장(작은 하드닝).
- (감사 미검증 1건) `hooks.ts`의 ask-모드 런타임 감지가 `transcript_path` 유무에 의존 — codex가 이 필드를 싣기 시작하면 ask가 codex에서 무시돼 자동 승인될 수 있음. 루프 밖 훅 인프라 사안, 별도 이슈 후보.
- Codex `--dangerously-bypass-hook-trust`는 프로젝트 훅을 검토 없이 실행한다 — 루프는 신뢰 환경 전제(approval/sandbox 우회와 같은 수준).

## 7. 진행 로그

- 2026-08-26: 전수조사(현행 23책임·16결함), 적대적 설계 검증(구멍 4·과설계 5 반영), 원장 작성.
- 2026-08-26: L-01 ledger.ts 완료 (테스트 6, 체크박스 라인만 BLOCKED 집계).
- 2026-08-26: L-02 classify.ts 완료 (테이블 18케이스, 역검증: limit의 !progress 제거 시 해당 케이스만 실패 확인 후 원복).
- 2026-08-26: L-03 protocol.ts 완료 (규칙 8개 단일 소스, 프롬프트·섹션·스킬 3렌더러 일치 테스트).
- 2026-08-26: L-04 state.ts 완료 (run.json link 잠금·stale 회수·정체 검증·이벤트·prune·atomicWrite, 테스트 10).
- 2026-08-26: L-06 worktree.ts 완료 (엣지 5종·자산 동기화·해시 시드·force 해제, 테스트 11; 역검증: 해시 비교 제거 시 재시드 케이스만 실패 확인 후 원복).
- 2026-08-26: L-07 스키마 완료 (relPath: 셸 메타문자 허용·canonical만 강제, knob 4개 추가).
- 2026-08-26: L-08 supervisor.ts 완료 (잠금→worktree/시드→시그널→반복→해제; in-process 뼈대 테스트 6).
- 2026-08-26: L-09 매트릭스 12케이스 중 11 녹색(케이스 10 disable-while-running은 L-11 후 활성), 프롬프트 에코 BLOCKED 오판 0 확인.
- 2026-08-26: L-10 완료 (Edit/Write 포함 모든 matcher에 apply_patch 별칭 → Codex에서 loop-guard 발동).
- 2026-08-26: L-11 완료 (생성 셸 러너·stopRunningLoop 삭제, 자산=SKILL.md만, disable/uninstall이 stopLoop+worktree 해제; 매트릭스 케이스 10 활성, 구 러너 테스트 파일 삭제).
- 2026-08-26: L-12 CLI 완료 (start 프리플라이트 6종·detached spawn·run.json 대기 후 unref, run/stop/status/clean; 테스트 12).
- 2026-08-26: L-13 e2e 완료 (tsx 실 CLI: start 즉시 반환·detached 완주·run.json 해제, stop --now 그룹 소멸, 2중 start 거부; 전체 2회 녹색).
- 2026-08-26: L-14 완료 (README: omh loop 명령·knob 4개·POSIX·시드 한계·트리; dogfood sync up to date. 발견: 구버전 run.sh 잔존 → sync 마이그레이션으로 제거).
- 2026-08-26: L-15 완료 (scripts/loop-qa-fixture.sh: 런타임별 모델 claude=sonnet / codex=gpt-5.6-sol(사용자 기본) / pi=anthropic/claude-haiku-4.5, Q-1~Q-4 + 가드 함정, sync·커밋까지; 테스트 2).
- 2026-08-26: **L-16 Claude Code 실 QA 통과** (run 20260826-143309-a37f, claude 2.1.243 / sonnet, isolate on).
  - ① start 즉시 반환·run.json 생성(pid 2023, childPid 2103) ② it1 `progress` ticked=1, worktree 커밋 8294301 `Q-1: create hello.txt` ③ worktree 원장 Q-1 [x]
  - ④ 가드: 루프 턴에서는 모델이 프로토콜 문구로 자기 거부(`BLOCKED: … architect-only`, PROTECTED.md 불변, 훅 미도달). 훅 경로는 CLAUDE.md 조상이 없는 고립 디렉터리에서 실 claude로 프로브 → `catalog-loop-guard.sh decision=block` 이벤트(05:36:46Z) + 모델이 오류문대로 `BLOCKED: architect-only path` 표기, free.md는 통과.
  - ⑤ it3 `complete`(ticked=1, 원장 unchecked 0·Q-3 BLOCKED), sentinel 마지막 줄, 그룹 2023 소멸, run.json 해제
  - ⑥ 별도 run 20260826-143709-d8d9: 실 claude 자식(21598) 실행 중 `stop --now` → 1초 내 그룹 소멸, `stopped` 이벤트, run.json 해제
  - 관찰(비결함): it2에서 모델이 Q-2·Q-3를 한 턴에 처리(ticked 1 + newBlocked 1 → progress 판정 정확). ⑥ 런의 it1은 모델이 sleep을 실행하지 않아 idle로 판정됨(판정 정확).
- 2026-08-26: **L-17 Codex 실 QA 1차 — 결함 2건 발견, 미통과** (run 20260826-143839-5514, codex 0.149.1 / gpt-5.6-sol).
  - 통과: ① 즉시 반환·run.json ② it1 progress + 커밋 49412ae ③ 원장 체크 ⑤ it4 complete·run.json 해제 ⑦ **codex는 프롬프트를 에코(턴 로그에 `BLOCKED:` 2줄)했으나 판정은 progress — 오판 0건**. 루프 내 Q-3는 모델 자기거부로 BLOCKED 표기.
  - 실패 ④: 고립 프로브에서 `apply_patch`로 PROTECTED.md 편집 통과. 원인 2단: (a) Codex는 trust 미저장 프로젝트 훅을 실행하지 않음(`--dangerously-bypass-hook-trust` 필요) (b) 우회 시 훅은 돌지만 loop-guard가 apply_patch 페이로드를 파싱 못해 allow.
  - 실패 ⑤ 부분: 완료 후 pgid 38499에 Codex의 `SkyComputerUseClient` 데몬 잔존.
  - 조치: L-19·L-20·L-21 신설 → 수정 후 L-17 재실행.
- 2026-08-26: L-19 완료 (apply_patch 헤더 경로 추출·차단, 패치 본문엔 Bash 휴리스틱 미적용; 테스트 4). L-20 완료 (codex argv에 --dangerously-bypass-hook-trust).
- 2026-08-26: L-21 완료 (isGroupLeader/sweepOwnGroup: 그룹 리더일 때만 종료 직전 그룹 SIGTERM; e2e에 잔존 프로세스 케이스 추가).
- 2026-08-26: **L-17 Codex 실 QA 2차 통과** (run 20260826-144854-530e, codex 0.149.1 / gpt-5.6-sol, L-19~21 반영 빌드).
  - ① 즉시 반환·run.json(pid 64027, child 64104) ② it1 progress ticked=1 커밋 92da5fc ③ 원장 체크 ④ 고립 프로브: 실 `codex exec --dangerously-bypass-hook-trust` + apply_patch → `catalog-loop-guard.sh decision=block`(05:49:13Z), PROTECTED.md 불변·free.md 통과; 루프 턴 로그에 `hook: SessionStart/UserPromptSubmit` — 프로젝트 훅이 턴 안에서 실행됨. 루프 내 Q-3는 모델 자기거부로 BLOCKED 표기.
  - ⑤ it4 complete, 그룹 64027 소멸(L-21 sweep), run.json 해제 ⑥ run …-c4c7: 실 codex 자식 실행 중 `stop --now` → 0초 그룹 소멸·`stopped` ⑦ 턴 로그 `BLOCKED:` 에코 32줄, `blocked` 이벤트 0건.
- 2026-08-26: **L-18 Pi 실 QA 통과** (run 20260826-145416-6f4a, pi / openrouter anthropic/claude-haiku-4.5).
  - ① 즉시 반환·run.json(pid 1151, child 1230) ② it1 progress→complete: Q-1·Q-2·Q-4 각 커밋(39fd90d, 5196add, …) ③ 원장 체크 ④ 고립 프로브: 실 `pi --print` + 브리지 익스텐션 경유 편집 → `catalog-loop-guard.sh decision=block`(05:54:29Z), free.md 통과. 루프 내 Q-3는 모델 자기거부.
  - ⑤ it1 `complete`(ticked 3), 그룹 1151 소멸, run.json 해제 ⑥ run …-dae0: 실 pi 자식 실행 중 `stop --now` → 0초 그룹 소멸·`stopped`.
  - 관찰: haiku가 4태스크를 한 턴에 처리하고 `[BLOCKED]` 비표준 형식 사용(§6 기록).
- 2026-08-26: **골 G1~G7 전부 달성.** 테스트 1182개, 생성 셸 러너 0, 3런타임 실 QA 통과. 남은 것은 PR 머지(사용자 승인 액션).
- 2026-08-26: PR 체크 — CI Node20 실패(fixture 테스트, dist 부재) + CodeRabbit 미해결 3건(명시적 loop-guard 파라미터·uninstall 계획 부작용·stale 회수 레이스 — 마지막은 bash 코드 대상이었으나 새 acquireRun에도 같은 창이 있어 수용). L-22~L-25 신설.
- 2026-08-26: L-22~L-25 완료 (픽스처 tsx 폴백·명시적 loop-guard 경로 강제·uninstall 부작용을 적용 단계로·reclaimStaleRun 회수 잠금+관측 재검증). 전체 테스트 2회 녹색.
- 2026-08-26: CI 플레이키 원인 수정 — 골이 100ms 안에 끝나면 슈퍼바이저가 start의 첫 폴링 전에 run.json을 해제하고 exit 0 → start가 "시작 전 종료"로 오판. exit 0 + 해당 run 이벤트 존재면 성공으로 처리.
- 2026-08-26: CodeRabbit 재지적 수용 — reclaim 잠금의 dead-holder 정리(rm→mkdir)에도 같은 레이스 → `takeoverReclaimLock`: atomic rename으로 인수 후 관측 소유자 pid 일치 시에만 삭제, 불일치면 원복.
- 2026-08-26: CodeRabbit 전체 재리뷰 15건 — 14 수용(턴을 자기 프로세스 그룹으로 실행해 timeout/stop/턴 종료 시 손자까지 정리, spawn 동기 예외 TDZ, start 획득 실패 시 unref·exit 0 무이벤트=실패, `[BLOCKED]`/`[-]` 파싱, ledger⊂workOrders 스키마 거부, 레거시 run.sh plan 대칭, 픽스처 비어있지 않은 dir 거부, 문서/원장 정정), 1 부분 기각(blocked>0이면 complete 금지 — BLOCKED는 사람에게 넘긴 태스크라 루프가 기다리면 공회전; 파서 확장만 수용).
- 2026-08-27: L-26 완료 (limit 판정을 exit 분기 앞으로·error도 stall 백오프·`+` 불릿 인식).
- 2026-08-27: L-27 완료 (updateRun 소유권·stop/clean rm 스냅샷 재확인·stop 플래그 무조건 기록·reclaim 잠금 rename 원자 생성·childPid 턴 종료 시 제거+ps 정체 검증·고아 턴 잔존 시 start 거부).
- 2026-08-27: L-28 완료 (git 실패 → failed 이벤트+정상 종료, unborn HEAD 프리플라이트 메시지, 종료 시 마지막 턴 그룹 SIGKILL 스윕 — TERM 무시 데몬까지).
- 2026-08-27: L-29 완료 (재시드 전 worktree 원장 .pre-seed 백업, sync 비활성화 경로는 dirty worktree를 경고와 함께 보존).
- 2026-08-27: L-30 완료 (critical: 셸 메타문자 금지 재도입 — 값이 loop-guard bash에 렌더됨; sentinel trim·개행 금지; apply_patch `Move to:` 목적지 검사).
- 2026-08-27: L-31 완료. ultracode 감사 확정 17건 전부 수정(L-26~L-30), 기각 3건은 검증 근거 보존, 미검증 1건 §6 리스크 기록. 테스트 1219개.
