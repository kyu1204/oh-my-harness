# `omh uninstall` + 훅 병합/제거 안전화 작업 계획서

작성: 2026-06-02 · 재작성: 2026-06-03  
대상: 딥 리서치 #2(라이프사이클 공백) + 선재 버그(sync가 사용자 훅 clobber)  
관련: [[sync-check-drift]] 의 `plan/compute` 아키텍처 재사용. TDD + 실 tmux 통합 QA 필수.

---

## 0. 2026-06-03 재검증 요약 — Claude만의 문제가 아님

Claude의 `.claude/settings.json`만 문제가 아니라, **Codex `.codex/hooks.json`도 같은 종류의 사용자 훅 clobber 위험이 있다.** Pi는 현재 생성 구조상 단일 전용 확장 파일만 덮어쓰므로 같은 수준의 병합 문제는 낮다.

| 대상 | sync 시 사용자 훅 clobber | uninstall 시 사용자 훅 삭제 | 결론 |
|---|---:|---:|---|
| Claude `.claude/settings.json` | 있음 | 있음 | 기존 계획대로 병합/선별 제거 필수 |
| Codex `.codex/hooks.json` | **있음** | **있음** | 전용 파일 계약으로 둘지, 병합형으로 승격할지 결정 필요 |
| Codex `.codex/config.toml` inline `[hooks]` | 낮음 | 낮음 | 현재 TOML 병합이 사용자 inline hooks·테이블을 보존함 |
| Pi `.pi/extensions/omh-harness.ts` | 같은 파일 직접 편집 시만 있음 | 같은 파일 직접 편집 시만 있음 | OMH 전용 generated file 취급이 타당 |
| Pi `.pi/extensions/*.ts` 기타 파일 | 없음 | 없음 | 사용자 확장 보존, 빈 디렉터리만 정리 |

### 근거

- Claude: `src/generators/settings.ts`가 기존 settings를 spread한 뒤 `hooks: hooksOutput.hooksConfig`로 `hooks` 키를 통째 교체한다.
- Codex: `src/generators/codex-config.ts`가 `.codex/hooks.json`을 `JSON.stringify(codexHooks)`로 통째 재작성한다. 기존 `.codex/hooks.json`의 사용자 훅은 보존되지 않는다.
- Codex `config.toml`: `buildCodexConfigToml()`은 기존 TOML을 parse 후 `[features]`만 갱신하므로 inline `[hooks]`, MCP 서버 등 사용자 테이블은 보존된다. 단, TOML 주석은 round-trip 과정에서 사라진다.
- Codex 공식 문서 기준, Codex는 `hooks.json`과 inline `[hooks]` tables를 모두 훅 소스로 인정하고 여러 훅 소스를 함께 로드한다. 따라서 사용자가 project-local `.codex/hooks.json`에 직접 훅을 두는 것도 정상 사용 케이스다.
- Pi: `src/generators/pi-extension.ts`는 `.pi/extensions/omh-harness.ts`만 생성한다. 다른 `.pi/extensions/*.ts` 파일은 건드리지 않는다.

---

## 1. 문제 / 목표

oh-my-harness는 생성물을 여러 위치에 흩뿌리지만 이를 되돌리는 명령이 없다. 사용자는 수동으로 삭제해야 하고, 특히 **머지형 파일**은 사용자 콘텐츠와 OMH 생성물이 섞여 있어 무차별 삭제가 위험하다.

추가로 발견된 선재 버그는 더 중요하다.

1. Claude `settings.json`은 `permissions`는 `_ohMyHarness.managedPermissions`로 사용자 항목을 보존하지만, `hooks`는 추적 없이 통째 교체한다.
2. Codex `.codex/hooks.json`도 sync 때 파일 전체를 재생성하므로, 사용자가 같은 파일에 직접 추가한 훅은 사라진다.
3. uninstall이 이후 우리 훅을 제거하려 해도, sync 단계에서 이미 사용자 훅을 잃으면 복구할 방법이 없다.

### 목표

1. `omh uninstall` 추가
   - 생성물을 안전하게 제거한다.
   - 사용자 콘텐츠는 보존한다.
   - 기본 dry-run 친화적 출력 + 확인 후 실행을 제공한다.
2. Claude hooks 병합 수정
   - sync 시 `.omh/hooks`를 가리키지 않는 사용자 훅 엔트리를 보존한다.
   - `.omh/hooks`를 가리키는 기존 OMH 훅만 새 생성물로 교체한다.
3. Codex hooks 소유권 결정 및 구현
   - 권장: `.codex/hooks.json`도 병합형으로 승격해 사용자 훅 보존.
   - 최소안: `.codex/hooks.json`을 OMH 전용 파일로 명시하고, 사용자 Codex 훅은 `.codex/config.toml` inline `[hooks]` 또는 `~/.codex/hooks.json`에 두도록 문서화.
4. Pi uninstall 안전성 보장
   - `.pi/extensions/omh-harness.ts`만 제거한다.
   - `.pi/extensions/custom.ts` 같은 사용자 확장은 보존한다.

### 완료 기준

- lint green
- 전체 test green
- 실 tmux 통합 QA 통과
  - Claude 사용자 훅이 있는 `settings.json`에서 `sync` 후 사용자 훅 보존
  - Codex 사용자 훅 케이스가 선택한 정책대로 동작
    - 병합형 선택 시: `.codex/hooks.json` 사용자 훅 보존
    - 전용 파일 선택 시: 문서와 dry-run 경고가 명확함
  - uninstall 후 생성물 제거, 사용자 콘텐츠 보존, `harness.yaml` 기본 보존

---

## 2. 훅 소유권 원칙

### 2.1 OMH 훅 식별 기준

OMH가 만든 runtime hook command는 전부 생성된 `.omh/hooks/*.sh`를 실행한다. 따라서 다음 기준으로 OMH 훅을 식별한다.

```ts
isOmhHookCommand(command, projectDir) === true
```

true 조건:

- command가 `.omh/hooks` 경로를 참조한다.
- 절대경로/인용/`bash '<path>'` 형식을 robust하게 처리한다.
- 가능하면 `projectDir/.omh/hooks` 하위 realpath로 확인한다.

보수 원칙:

- 불확실하면 사용자 훅으로 보고 보존한다.
- command 문자열만으로 `.omh/hooks` 하위가 확실할 때만 제거/교체한다.

### 2.2 파일별 소유권

| 파일 | 소유권 | sync 전략 | uninstall 전략 |
|---|---|---|---|
| `.claude/settings.json` | 병합형 | 사용자 hooks/permissions/기타 키 보존, OMH hooks/permissions만 갱신 | OMH hooks/permissions/meta만 제거 |
| `.codex/hooks.json` | **결정 필요** | 권장: 병합형. 최소안: OMH 전용 | 권장: OMH command만 제거. 최소안: 파일 삭제 |
| `.codex/config.toml` | 병합형 | 사용자 테이블 보존, `[features].hooks/goals`만 보장 | OMH가 추가한 feature keys만 제거 |
| `.pi/extensions/omh-harness.ts` | 전용 | 통째 생성/갱신 | 통째 삭제 |
| `.pi/extensions/*.ts` 기타 | 사용자 | 건드리지 않음 | 보존 |

---

## 3. 제거 대상 분류

### A. 전용 파일/디렉터리 — 통째 삭제

| 경로 | 비고 |
|---|---|
| `.omh/` | hooks/, state/, manifest.json 전부 OMH 소유 |
| `.claude/oh-my-harness.json` | OMH 상태 파일 |
| `.pi/extensions/omh-harness.ts` | OMH Pi bridge 전용 파일 |

조건부 전용:

| 경로 | 처리 |
|---|---|
| `.codex/hooks.json` | 정책 결정에 따름. 병합형 승격 시 통째 삭제 금지, OMH 훅만 제거. 전용 계약 유지 시 통째 삭제 |

### B. 머지형 파일 — 외과적 제거

| 경로 | 제거 방법 | 보존 |
|---|---|---|
| `CLAUDE.md` | managed section만 제거 | 사용자 본문 |
| `AGENTS.md` | managed section만 제거 | 사용자 본문 |
| `.claude/settings.json` | OMH permissions/hooks/meta만 제거 | 사용자 permissions/hooks/기타 키 |
| `.codex/config.toml` | OMH feature keys + deprecated key만 제거 | inline hooks, MCP 서버, 사용자 TOML 설정 |
| `.codex/hooks.json` | 병합형 선택 시 OMH command 엔트리만 제거 | 사용자 Codex hooks |
| `.gitignore` | `# oh-my-harness` section만 제거 | 사용자 라인 |

### C. 기본 보존

- `harness.yaml`: 사용자 소스. 기본 보존, `--purge`로만 삭제.
- `.pi/extensions`의 사용자 확장 파일.
- `.codex/config.toml`의 inline `[hooks]`와 사용자 설정.
- 머지형 파일이 OMH 제거 후 빈 내용이면 파일 자체 삭제, 아니면 stripped 콘텐츠 기록.

---

## 4. 아키텍처 — plan/compute 재사용

[[sync-check-drift]]에서 만든 패턴을 대칭으로 적용한다.

```ts
computeUninstall(projectDir, opts) => UninstallPlan {
  delete: string[]
  modify: { path: string; content: string }[]
  removeDirs: string[]
  keptHarnessYaml: boolean
  warnings: string[]
}
```

- `omh uninstall --dry-run`: 플랜만 출력, 쓰기 없음.
- `omh uninstall`: 플랜 출력 → 확인 → 실행.
- `omh uninstall --yes`: 확인 생략.
- `omh uninstall --purge`: `harness.yaml`까지 삭제.

### 역-generator 모듈

`src/core/uninstall.ts`

순수 함수 중심:

- `isOmhHookCommand(command, projectDir)`
- `stripManagedMarkdown(content)`
- `stripClaudeSettings(json, projectDir)`
- `stripCodexHooksJson(json, projectDir)` — 병합형 선택 시
- `stripCodexConfigToml(toml)`
- `stripGitignoreSection(content)`
- `computeUninstall(projectDir, opts)`

기존 유틸 재사용:

- managed markdown section 유틸
- settings managed permissions 메타
- gitignore section header
- TOML parser(`smol-toml`)

---

## 5. 명령 표면

```bash
omh uninstall [options]
  -d, --project-dir <dir>
  --dry-run
  -y, --yes
  --purge
```

기본 출력:

```text
oh-my-harness uninstall plan
- delete: N files/directories
- modify: M files
- keep: harness.yaml
- warnings: K
```

Codex 정책별 출력:

- 병합형 선택 시: `.codex/hooks.json`: remove OMH hook entries, keep user entries.
- 전용 계약 유지 시: `.codex/hooks.json`: delete whole file; warn if file contains non-OMH hook commands.

---

## 6. 작업 분해 — TDD 순서

> 편집-시점 tdd-guard 활성. 소스 편집 전 대응 테스트 먼저 작성한다.

### T0. 훅 소유권 유틸 추가

- `src/core/managed-hooks.ts` 또는 `src/core/uninstall.ts`에 공유 유틸 추가.
- `isOmhHookCommand(command, projectDir)` 구현.
- 테스트:
  - `bash '<project>/.omh/hooks/foo.sh'` true
  - quoted/unquoted true
  - `.omh/hooks` 바깥 경로 false
  - `node myhook.js`, `python3 ~/.codex/hooks/foo.py` false
  - path traversal/유사 문자열은 false

### T1. Claude generate hooks 병합 — 선재 버그 수정

- `src/generators/settings.ts`
  - 기존 `hooks: hooksOutput.hooksConfig` 통째 교체 제거.
  - 기존 `settings.hooks`를 event별로 순회한다.
  - 각 matcher entry의 hook command 중 OMH command만 제거한다.
  - 남은 사용자 entry + 새 OMH entry를 합친다.
  - 빈 event는 제거한다.
- 테스트:
  - 사용자 훅 보존 + OMH 훅 추가
  - 재sync 시 이전 OMH 훅은 중복 없이 교체
  - 사용자 훅 없음 케이스 기존 동작 유지
  - matcher group 안에 사용자 hook과 OMH hook이 섞이면 사용자 hook만 보존

### T2. Codex hooks 정책 구현

#### 권장안 A — `.codex/hooks.json` 병합형 승격

- `src/generators/codex-config.ts`
  - 기존 `.codex/hooks.json`을 읽어 parse한다.
  - OMH command만 제거한다.
  - 사용자 hooks + 새 OMH hooks를 병합한다.
  - malformed JSON이면 overwrite하지 말고 에러를 surface한다.
- `stripCodexHooksJson(json, projectDir)` 추가.
- 테스트:
  - 사용자 `.codex/hooks.json` 훅 보존
  - 이전 OMH 훅 교체
  - 사용자 inline `[hooks]` in `config.toml` 보존
  - malformed hooks.json에서 사용자 내용 보호를 위해 실패

#### 최소안 B — `.codex/hooks.json` OMH 전용 계약 유지

- 코드 변경 최소화.
- uninstall dry-run에서 non-OMH command가 발견되면 강한 경고.
- README에 사용자 Codex 훅 위치를 명시:
  - project-local inline `[hooks]` in `.codex/config.toml`
  - user-level `~/.codex/hooks.json`
- 테스트:
  - uninstall이 `.codex/hooks.json` 전체 삭제
  - non-OMH command 포함 시 warning 출력

> 추천은 A. Codex 공식 문서상 `.codex/hooks.json`도 정상 사용자 훅 표면이므로, Claude와 같은 보존 원칙을 적용하는 편이 안전하다.

### T3. 머지형 외과 제거 유틸

- `src/core/uninstall.ts`
  - `stripManagedMarkdown(content) => string | null`
  - `stripClaudeSettings(json, projectDir) => object | null`
  - `stripCodexConfigToml(toml) => string | null`
  - `stripCodexHooksJson(json, projectDir) => object | null` — 권장안 A 선택 시
  - `stripGitignoreSection(content) => string | null`
- 테스트:
  - 사용자 본문/permission/hook/TOML table/gitignore line 보존
  - OMH 부분만 제거
  - OMH만 있던 파일은 `null`
  - 마커/메타 없으면 보수적으로 보존

### T4. `computeUninstall` 플랜

- 전용 경로 수집:
  - `.omh`
  - `.claude/oh-my-harness.json`
  - `.pi/extensions/omh-harness.ts`
  - `.codex/hooks.json`은 정책에 따라 delete 또는 modify
- 머지형 strip 결과를 `modify` 또는 `delete`로 반영.
- 빈 디렉터리 정리 후보:
  - `.pi/extensions`
  - `.pi`
  - `.codex`는 사용자 `config.toml`/기타 파일이 있으면 보존
  - `.claude`는 사용자 파일이 있으면 보존
- `harness.yaml`은 기본 보존, `--purge`면 delete.
- 테스트:
  - 합성 프로젝트에서 delete/modify/removeDirs 정확
  - `--purge` 동작
  - 비-OMH 프로젝트 무해 동작

### T5. uninstall 실행기 + CLI

- `src/cli/commands/uninstall.ts`
  - plan 출력
  - dry-run
  - confirm prompt
  - `--yes`
  - delete/modify/removeDirs 실행
- CLI index 와이어링.
- 테스트:
  - command 등록
  - dry-run은 쓰기 없음
  - `--yes`는 실행
  - confirm no는 실행 안 함

### T6. 안전장치

- malformed JSON/TOML은 overwrite/delete하지 않고 경고 또는 실패.
- manifest 기반 삭제는 경로 검증.
- `.omh/hooks` 경로 식별이 애매하면 사용자 훅으로 보존.
- `.pi/extensions`와 `.codex`는 비어 있을 때만 디렉터리 삭제.
- `.codex/config.toml`에서 사용자가 직접 `hooks = true`/`goals = true`를 원했을 가능성은 추적 불가. uninstall은 OMH가 추가한 feature로 보고 제거하되, 다른 `[features]` 키는 보존한다.

### T7. 실 tmux 통합 QA

빌드된 `omh`로 임시 프로젝트에서 수행한다.

1. `omh sync`
2. 사용자 콘텐츠 추가
   - `CLAUDE.md` 사용자 본문
   - `.claude/settings.json` 사용자 permission + 사용자 hook
   - `.codex/config.toml` inline `[hooks]` + MCP server
   - 권장안 A 선택 시 `.codex/hooks.json` 사용자 hook
   - `.pi/extensions/custom.ts`
3. `omh sync` 재실행
4. 검증
   - Claude 사용자 hook 보존
   - Codex 사용자 hook 정책대로 보존/경고
   - Pi custom extension 보존
5. `omh uninstall --dry-run`
6. `omh uninstall -y`
7. 검증
   - `.omh` 제거
   - `.pi/extensions/omh-harness.ts` 제거
   - `.pi/extensions/custom.ts` 보존
   - `CLAUDE.md`/`AGENTS.md` 사용자 본문 보존
   - `.claude/settings.json` 사용자 permission/hook 보존
   - `.codex/config.toml` 사용자 inline hooks/MCP 보존
   - `harness.yaml` 보존
8. `omh uninstall -y --purge` 1회 추가 검증
   - `harness.yaml` 삭제

### T8. 문서

- README:
  - `omh uninstall` 사용법
  - `--dry-run`, `--yes`, `--purge`
  - uninstall vs purge
  - Claude/Codex/Pi 훅 보존 정책
- Codex 정책 문서화:
  - 권장안 A면 `.codex/hooks.json` 사용자 훅 보존 명시
  - 최소안 B면 `.codex/hooks.json`은 OMH 전용이고 사용자 훅은 inline `[hooks]` 또는 user-level hooks로 안내

---

## 7. 테스트 전략

| 레벨 | 범위 |
|---|---|
| 단위 | `isOmhHookCommand`, strip 유틸, Claude/Codex hook merge |
| 통합 | `computeUninstall` 플랜, 실행 후 디스크 상태 |
| E2E(tmux) | sync → 사용자 편집 → sync → uninstall → 보존/제거 검증 |

완료: `npm run lint` + `npm test` + T7 통과.

---

## 8. 리스크 / 결정 필요 항목

1. **Codex `.codex/hooks.json` 소유권**
   - 최대 결정 사항.
   - 사용자 안전 우선이면 병합형 승격(A).
   - 구현 단순성과 기존 가정 유지면 전용 계약(B), 대신 경고/문서가 필수.
2. **사용자 콘텐츠 오삭제**
   - 모든 제거는 마커/메타/`.omh/hooks` 경로 기반.
   - 불확실하면 보존.
3. **한 matcher group에 사용자 hook과 OMH hook이 섞인 경우**
   - hook command 단위 partition 필요.
   - entry 단위 삭제만 하면 사용자 hook까지 지울 수 있다.
4. **Codex TOML 주석 손실**
   - 기존 코드의 알려진 trade-off.
   - uninstall에서도 TOML parser round-trip 사용 시 주석 손실 가능. 문서화 또는 regex-free 대안 검토.
5. **Pi generated file 직접 편집**
   - `.pi/extensions/omh-harness.ts`는 전용 파일로 명시.
   - 사용자 커스터마이징은 별도 `.pi/extensions/*.ts` 파일로 안내.
6. **manifest 없는 레거시 프로젝트**
   - 마커/경로 기반 best-effort 제거.
7. **명령 이름**
   - `uninstall` 유지 권장. `clean`은 범위가 모호하고 `purge`와 혼동 가능.

---

## 9. PR 분할

### PR-1 — 훅 보존 버그픽스

- `isOmhHookCommand`
- Claude hooks 병합
- Codex hooks 정책 결정 및 구현
- 관련 단위 테스트

### PR-2 — uninstall 순수 로직

- strip 유틸
- `computeUninstall`
- 플랜 테스트

### PR-3 — CLI + 문서 + E2E

- `omh uninstall` command
- dry-run/confirm/yes/purge
- README
- tmux 통합 QA

단일 PR도 가능하지만, sync 시 사용자 훅 clobber는 uninstall과 독립적인 선재 버그이므로 PR-1을 먼저 내는 것이 안전하다.
