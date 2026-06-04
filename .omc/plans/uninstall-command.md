# `omh uninstall` + 훅 병합/제거 안전화 작업 계획서

작성: 2026-06-02 · 재작성: 2026-06-04
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
4. Codex `.codex/config.toml`은 사용자 설정과 OMH feature flags가 섞인 머지형 파일이다. uninstall 시 `[features].hooks/goals` 제거는 사용자가 직접 켠 값을 지우는 오탐이 될 수 있고, TOML parser round-trip은 in-file comments를 제거할 수 있다.

### 목표

1. `omh uninstall` 추가
   - 생성물을 안전하게 제거한다.
   - 사용자 콘텐츠는 보존한다.
   - 기본 dry-run 친화적 출력 + 확인 후 실행을 제공한다.
   - destructive flow이므로 plan/dry-run/confirm 출력에 **백업 후 실행 권장** 문구를 포함한다.
   - 자동화 호출자를 위해 `--skip-backup-warning`으로 백업 경고만 숨길 수 있게 한다. `--yes`는 확인 프롬프트만 생략하며, 백업 경고 숨김은 `--skip-backup-warning`이 있을 때만 허용한다.
2. Claude hooks 병합 수정
   - sync 시 `.omh/hooks`를 가리키지 않는 사용자 훅 엔트리를 보존한다.
   - `.omh/hooks`를 가리키는 기존 OMH 훅만 새 생성물로 교체한다.
3. Codex hooks 소유권 결정 및 구현
   - 권장: `.codex/hooks.json`도 병합형으로 승격해 사용자 훅 보존.
   - 최소안: `.codex/hooks.json`을 OMH 전용 파일로 명시하고, 사용자 Codex 훅은 `.codex/config.toml` inline `[hooks]` 또는 `~/.codex/hooks.json`에 두도록 문서화.
4. Pi uninstall 안전성 보장
   - `.pi/extensions/omh-harness.ts`만 제거한다.
   - `.pi/extensions/custom.ts` 같은 사용자 확장은 보존한다.
5. Codex TOML 사용자 콘텐츠 보존 강화
   - `.codex/config.toml` dry-run에는 `[features].hooks/goals` 제거 예정과 “사용자가 직접 설정한 경우 복원이 필요할 수 있음”을 명시한다.
   - `.codex/config.toml` 수정은 comment loss 가능성을 사용자에게 경고한다.
   - T4에서 comment-preserving TOML 대안 또는 최소 변경 보존 전략을 평가/구현하는 명시 작업을 둔다.

### 완료 기준

- lint green
- 전체 test green
- 실 tmux 통합 QA 통과
  - Claude 사용자 훅이 있는 `settings.json`에서 `sync` 후 사용자 훅 보존
  - Codex 사용자 훅 케이스가 선택한 정책대로 동작
    - 병합형 선택 시: `.codex/hooks.json` 사용자 훅 보존
    - 전용 파일 선택 시: 문서와 dry-run 경고가 명확함
  - Codex `.codex/config.toml` feature-key 오탐 가능성과 TOML comment-loss 경고가 dry-run에 표시됨
  - uninstall 후 생성물 제거, 사용자 콘텐츠 보존, `harness.yaml` 기본 보존

---

## 2. 훅 소유권 원칙

### 2.1 OMH 훅 식별 기준

OMH가 만든 runtime hook command는 전부 생성된 `.omh/hooks/*.sh`를 실행한다. 따라서 다음 기준으로 OMH 훅을 식별한다.

```ts
isOmhHookCommand(command, projectDir) === true
```

true 조건:

- command에서 실행 대상 script path를 추출한다. 지원 형식은 최소 `bash '<path>'`, `bash "<path>"`, unquoted absolute path, shell command 안의 quoted path다.
- 추출한 path와 `projectDir/.omh/hooks`를 모두 `realpath`로 canonicalize한다.
- hook script realpath가 `realpath(projectDir/.omh/hooks)`의 **strict descendant**일 때만 true다.
- `projectDir/.omh/hooks` 자체가 없거나 realpath 확인에 실패하면 true로 추정하지 않고 false다.

보수 원칙:

- 불확실하면 사용자 훅으로 보고 보존한다.
- 문자열에 `.omh/hooks`가 포함되어도 canonical hooks dir 하위 realpath가 아니면 OMH 훅으로 보지 않는다.
- path traversal(`../..`)이나 symlink가 프로젝트 밖을 가리키는 경우 false다.

### 2.2 파일별 소유권

| 파일 | 소유권 | sync 전략 | uninstall 전략 |
|---|---|---|---|
| `.claude/settings.json` | 병합형 | 사용자 hooks/permissions/기타 키 보존, OMH hooks/permissions만 갱신 | OMH hooks/permissions/meta만 제거 |
| `.codex/hooks.json` | **결정 필요** | 권장: 병합형. 최소안: OMH 전용 | 권장: OMH command만 제거. 최소안: 파일 삭제 + non-OMH 경고 |
| `.codex/config.toml` | 병합형 | 사용자 테이블 보존, `[features].hooks/goals`만 보장 | OMH가 추가한 feature keys 제거 전 경고. 사용자 inline hooks/MCP 보존. comments 보존 전략 필요 |
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
| `.codex/hooks.json` | 정책 결정에 따름. 병합형 승격 시 통째 삭제 금지, OMH 훅만 제거. 전용 계약 유지 시 통째 삭제하되 non-OMH command가 있으면 dry-run/실행 출력에 강한 경고 |

### B. 머지형 파일 — 외과적 제거

| 경로 | 제거 방법 | 보존 |
|---|---|---|
| `CLAUDE.md` | managed section만 제거 | 사용자 본문 |
| `AGENTS.md` | managed section만 제거 | 사용자 본문 |
| `.claude/settings.json` | OMH permissions/hooks/meta만 제거 | 사용자 permissions/hooks/기타 키 |
| `.codex/config.toml` | OMH feature keys + deprecated key만 제거. 제거 전 feature-key 오탐 경고와 comment-loss 경고 표시 | inline hooks, MCP 서버, 사용자 TOML 설정, 가능하면 comments |
| `.codex/hooks.json` | 병합형 선택 시 OMH command hook만 제거. event별 사용자 hook order 보존 | 사용자 Codex hooks |
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
  modify: { path: string; content: string; backupPath?: string }[]
  removeDirs: string[]
  keptHarnessYaml: boolean
  warnings: string[]
  destructiveWarnings: string[]
}

applyUninstallPlan(plan, opts) => UninstallResult {
  modified: string[]
  deleted: string[]
  removedDirs: string[]
  restored: string[]
  failed: { path: string; op: "modify" | "delete" | "removeDir" | "restore"; message: string }[]
  warnings: string[]
}
```

- `omh uninstall --dry-run`: 플랜만 출력, 쓰기 없음. 항상 `백업 후 실행 권장`을 표시한다.
- `omh uninstall`: 플랜 출력 → 백업 권장 표시 → 확인 → 실행.
- `omh uninstall --yes`: 확인 프롬프트만 생략한다. 백업 권장은 계속 표시한다.
- `omh uninstall --skip-backup-warning`: 백업 권장 문구를 숨긴다. `--yes`와 별개다.
- `omh uninstall --purge`: `harness.yaml`까지 삭제.
- `omh uninstall --continue-on-error`: 가능한 작업을 계속하고 post-run summary에 실패 목록을 남긴다. 기본은 stop-on-error.

### 적용 순서와 부분 실패 복구

1. **prepare backups**: modify 대상 원본을 임시 백업 파일에 저장한다.
2. **modify**: 머지형 파일을 먼저 안전하게 수정한다. 실패하면 기본 정책은 즉시 중단하고 이미 수정된 파일을 백업에서 복원한다.
3. **delete**: 전용 파일/디렉터리를 삭제한다.
4. **removeDirs**: 빈 디렉터리만 마지막에 정리한다.
5. **post-run summary**: 성공/실패/복원/잔여 파일을 모두 출력한다.

정책:

- 기본 `stop-on-error`: 첫 실패 시 중단, 수정된 머지형 파일은 restore 시도, 실패 상세 출력.
- `--continue-on-error`: 각 op 실패를 `UninstallResult.failed`에 기록하고 다음 op 진행. modify 실패 시 해당 파일만 건너뛰며 delete/removeDirs는 계속 가능.
- critical failure 후에는 “일부 파일이 제거되었고 일부는 남았음”을 명확히 출력하고 재실행/수동 복구 경로를 안내한다.

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
- TOML parser(`smol-toml`) 또는 comment-preserving 대안

---

## 5. 명령 표면

```bash
omh uninstall [options]
  -d, --project-dir <dir>
  --dry-run
  -y, --yes
  --purge
  --skip-backup-warning
  --continue-on-error
```

기본 plan 출력은 dry-run과 실제 실행이 같은 renderer를 사용한다.

```text
oh-my-harness uninstall plan
- delete: N files/directories
- modify: M files
- keep: harness.yaml
- warnings: K

Safety:
- 백업 후 실행 권장: uninstall은 파일을 수정/삭제하는 파괴적 작업입니다.
- .codex/config.toml: [features].hooks/goals 제거 예정. 사용자가 직접 설정한 값이면 복원이 필요할 수 있습니다.
- .codex/config.toml: 수정 시 TOML in-file comments가 제거될 수 있습니다.
```

출력 규칙:

- `--dry-run`: 위 plan + `백업 후 실행 권장` + Codex hook/config warnings를 표시하고 종료한다.
- `--yes`: 확인 프롬프트만 건너뛴다. `--skip-backup-warning` 없이는 백업 권장 문구를 표시한다.
- `--skip-backup-warning`: 백업 권장 문구만 숨긴다. Codex data-loss 가능성 경고는 숨기지 않는다.
- 실행 후 summary는 `modified/deleted/removedDirs/restored/failed/remaining`을 출력한다.

Codex 정책별 출력:

- 병합형 선택 시: `.codex/hooks.json`: remove OMH hook entries, keep user entries.
- 전용 계약 유지 시: `.codex/hooks.json`: delete whole file; warn if file contains non-OMH hook commands.

---

## 6. 작업 분해 — TDD 순서

> 편집-시점 tdd-guard 활성. 소스 편집 전 대응 테스트 먼저 작성한다.

### T0. 훅 소유권 유틸 추가

- `src/core/managed-hooks.ts` 또는 `src/core/uninstall.ts`에 공유 유틸 추가.
- `isOmhHookCommand(command, projectDir)` 구현.
- 구현 요구:
  - command에서 후보 path를 추출한다.
  - 후보 path와 `projectDir/.omh/hooks`를 realpath로 정규화한다.
  - 후보 realpath가 canonical hooks dir의 strict descendant인지 확인한다.
  - symlink가 프로젝트 밖을 가리키면 false다.
- 테스트:
  - `bash '<project>/.omh/hooks/foo.sh'` true
  - quoted/unquoted true
  - realpath-normalized path가 `projectDir/.omh/hooks` 내부면 true
  - `.omh/hooks` 바깥 경로 false
  - `node myhook.js`, `python3 ~/.codex/hooks/foo.py` false
  - `../..` traversal로 프로젝트 밖 `.omh/hooks`를 가리키면 false
  - symlink가 프로젝트 밖 script를 가리키면 false
  - `.omh/hooks` 문자열만 포함된 non-path command는 false

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
  - Codex hook schema를 검증/정규화한다.
  - event 값이 single object면 array로 정규화한다. 정규화 불가능한 scalar/unknown schema는 overwrite하지 않고 명확한 에러를 surface한다.
  - 동일 event는 `사용자 hooks → 새 OMH hooks` 순서로 ordered array 병합한다.
  - OMH command만 제거한 뒤 새 OMH hooks를 추가한다.
  - malformed JSON이면 overwrite하지 말고 에러를 surface한다.
- `stripCodexHooksJson(json, projectDir)` 추가.
- 테스트:
  - 사용자 `.codex/hooks.json` 훅 보존
  - 이전 OMH 훅 교체
  - 사용자 inline `[hooks]` in `config.toml` 보존
  - malformed hooks.json에서 사용자 내용 보호를 위해 실패
  - 사용자 event가 array이고 OMH event가 array일 때 순서 보존(user first, OMH second)
  - 사용자 event가 single object일 때 array로 정규화 후 병합
  - 동일 event에 여러 사용자 훅이 있을 때 원래 순서 유지
  - future schema처럼 hooks event가 scalar/비객체/비배열이면 실패하고 overwrite 금지

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
  - `.codex/config.toml` inline `[hooks]`와 MCP server 보존
  - `[features].hooks/goals` 제거 예정 warning 생성
  - TOML comments 보존 전략이 구현된 경우 comments 유지, 구현 전이면 dry-run warning 존재

### T4. `computeUninstall` 플랜

- 전용 경로 수집:
  - `.omh`
  - `.claude/oh-my-harness.json`
  - `.pi/extensions/omh-harness.ts`
  - `.codex/hooks.json`은 정책에 따라 delete 또는 modify
- 머지형 strip 결과를 `modify` 또는 `delete`로 반영.
- destructive warning 수집:
  - 백업 권장
  - `.codex/config.toml` feature-key 오탐 가능성
  - `.codex/config.toml` TOML comment-loss 가능성
  - `.codex/hooks.json` 전용 계약 선택 시 non-OMH command 삭제 위험
- comment-preserving TOML 대안 평가/구현:
  - 우선 최소 변경 가능한 preservation strategy를 검토한다.
  - parser round-trip이 불가피하면 dry-run/README에 comments 제거 가능성을 명시하고 테스트로 warning을 고정한다.
- 빈 디렉터리 정리 후보:
  - `.pi/extensions`
  - `.pi`
  - `.codex`는 사용자 `config.toml`/기타 파일이 있으면 보존
  - `.claude`는 사용자 파일이 있으면 보존
- `harness.yaml`은 기본 보존, `--purge`면 delete.
- 테스트:
  - 합성 프로젝트에서 delete/modify/removeDirs 정확
  - warnings/destructiveWarnings 정확
  - `--purge` 동작
  - 비-OMH 프로젝트 무해 동작
  - 사용자가 직접 `[features].hooks/goals`를 둔 config에서 dry-run warning 생성

### T5. uninstall 실행기 + CLI

- `src/cli/commands/uninstall.ts`
  - plan 출력: dry-run과 실제 실행이 같은 renderer 사용
  - 백업 권장 출력 + `--skip-backup-warning`
  - dry-run
  - confirm prompt
  - `--yes`
  - `--continue-on-error`
  - modify backup 생성, 실패 시 restore
  - delete/modify/removeDirs 실행
  - post-run summary 출력
- CLI index 와이어링.
- 테스트:
  - command 등록
  - dry-run은 쓰기 없음
  - dry-run에 `백업 후 실행 권장` 포함
  - `--skip-backup-warning`은 백업 권장만 숨기고 Codex data-loss warning은 유지
  - `--yes`는 confirm만 생략하고 백업 권장은 유지
  - confirm no는 실행 안 함
  - modify 실패 시 stop-on-error + restore 시도 + failed summary
  - `--continue-on-error`는 실패 기록 후 가능한 op 계속 진행

### T6. 안전장치

- malformed JSON/TOML은 overwrite/delete하지 않고 경고 또는 실패.
- manifest 기반 삭제는 경로 검증.
- `.omh/hooks` 경로 식별이 애매하면 사용자 훅으로 보존.
- `.pi/extensions`와 `.codex`는 비어 있을 때만 디렉터리 삭제.
- `.codex/config.toml`에서 사용자가 직접 `hooks = true`/`goals = true`를 원했을 가능성은 추적 불가. uninstall은 OMH가 추가한 feature로 보고 제거하되, dry-run/실행 출력에 복원 필요 가능성을 명시하고 다른 `[features]` 키는 보존한다.
- `.codex/config.toml` 수정은 comments 제거 가능성을 경고하고, comment-preserving 전략이 구현될 때까지 사용자 콘텐츠 손실 리스크로 관리한다.

### T7. 실 tmux 통합 QA

빌드된 `omh`로 임시 프로젝트에서 수행한다. 각 검증은 pass/fail 기준이 모호하지 않게 아래 형식을 따른다.

1. `omh sync`
2. 사용자 콘텐츠 추가
   - `CLAUDE.md` 사용자 본문
   - `.claude/settings.json` 사용자 permission + 사용자 hook(`custom-hook.sh`)
   - `.codex/config.toml` inline `[hooks]` + MCP server + 사용자가 직접 둔 `[features].hooks/goals`
   - 권장안 A 선택 시 `.codex/hooks.json` 사용자 hook(`python3 user-codex-hook.py`)
   - `.pi/extensions/custom.ts`
3. `omh sync` 재실행
4. sync 후 보존 검증
   - 검증 항목: Claude 사용자 hook 보존
     - 검증 방법: `.claude/settings.json`을 열어 `hooks` 배열/객체를 확인한다.
     - 예상 결과: 사용자 `custom-hook.sh` entry가 존재하고 OMH `.omh/hooks/*.sh` entry도 함께 존재한다.
   - 검증 항목: Codex 사용자 hook 보존/경고
     - 검증 방법: `.codex/hooks.json`과 `.codex/config.toml`을 확인한다.
     - 예상 결과: 권장안 A면 `python3 user-codex-hook.py`가 보존되고 OMH hook은 뒤에 병합된다. 최소안 B면 sync/dry-run 문서와 경고가 `.codex/hooks.json` 전용 계약을 명확히 알린다. `.codex/config.toml` inline `[hooks]`와 MCP server는 항상 보존된다.
   - 검증 항목: Pi custom extension 보존
     - 검증 방법: `.pi/extensions/custom.ts` 내용을 sync 전후로 비교한다.
     - 예상 결과: 파일이 존재하고 내용이 변경되지 않는다. `.pi/extensions/omh-harness.ts`는 OMH bridge로 생성/갱신된다.
5. `omh uninstall --dry-run`
6. dry-run 출력 검증
   - 검증 항목: destructive backup warning
     - 검증 방법: stdout을 확인한다.
     - 예상 결과: `백업 후 실행 권장`이 포함된다.
   - 검증 항목: Codex feature-key 오탐 경고
     - 검증 방법: stdout warnings를 확인한다.
     - 예상 결과: `.codex/config.toml`의 `[features].hooks/goals` 제거 예정과 사용자가 직접 설정한 경우 복원이 필요할 수 있음이 표시된다.
   - 검증 항목: TOML comment-loss 경고
     - 검증 방법: stdout warnings를 확인한다.
     - 예상 결과: `.codex/config.toml` 수정 시 in-file comments가 제거될 수 있음이 표시된다.
7. `omh uninstall -y`
8. uninstall 후 파일시스템 검증
   - 검증 항목: OMH 전용 생성물 제거
     - 검증 방법: `find . -maxdepth 3` 또는 `test ! -e`로 확인한다.
     - 예상 결과: `.omh`와 `.pi/extensions/omh-harness.ts`가 없다.
   - 검증 항목: Pi 사용자 확장 보존
     - 검증 방법: `.pi/extensions/custom.ts` 존재/내용을 확인한다.
     - 예상 결과: 파일이 존재하고 uninstall 전 사용자 내용과 같다.
   - 검증 항목: Markdown 사용자 본문 보존
     - 검증 방법: `CLAUDE.md`/`AGENTS.md` 내용을 확인한다.
     - 예상 결과: 사용자 본문은 남고 OMH managed section은 제거된다.
   - 검증 항목: Claude settings 사용자 콘텐츠 보존
     - 검증 방법: `.claude/settings.json`을 JSON parse해 permissions/hooks/기타 키를 확인한다.
     - 예상 결과: 사용자 permission과 `custom-hook.sh`는 남고 OMH permission/hook/meta는 제거된다.
   - 검증 항목: Codex config 사용자 콘텐츠 보존
     - 검증 방법: `.codex/config.toml`을 확인한다.
     - 예상 결과: inline `[hooks]`, MCP server, 사용자 다른 keys는 남는다. `[features].hooks/goals` 제거 여부는 dry-run warning과 일치한다.
   - 검증 항목: harness.yaml 기본 보존
     - 검증 방법: `test -f harness.yaml`.
     - 예상 결과: 파일이 존재한다.
9. `omh uninstall -y --purge` 1회 추가 검증
   - 검증 항목: purge deletes harness source
     - 검증 방법: `test ! -e harness.yaml`.
     - 예상 결과: `harness.yaml`이 삭제된다.
10. 실패/복구 검증
    - 검증 항목: modify 실패 시 restore/post-run summary
      - 검증 방법: 임시 프로젝트에서 대상 파일 권한 또는 mock fs로 modify 실패를 유발한다.
      - 예상 결과: 기본 모드는 중단 + 가능한 restore + failed summary를 출력한다. `--continue-on-error`는 실패를 기록하고 가능한 후속 op를 계속한다.

### T8. 문서

- README:
  - `omh uninstall` 사용법
  - `--dry-run`, `--yes`, `--purge`, `--skip-backup-warning`, `--continue-on-error`
  - uninstall vs purge
  - 백업 권장과 부분 실패 복구 정책
  - Claude/Codex/Pi 훅 보존 정책
  - Codex `.codex/config.toml` feature-key 제거/주석 손실 가능성
- Codex 정책 문서화:
  - 권장안 A면 `.codex/hooks.json` 사용자 훅 보존 명시
  - 최소안 B면 `.codex/hooks.json`은 OMH 전용이고 사용자 훅은 inline `[hooks]` 또는 user-level hooks로 안내

---

## 7. 테스트 전략

| 레벨 | 범위 |
|---|---|
| 단위 | `isOmhHookCommand`, realpath/symlink/traversal, strip 유틸, Claude/Codex hook merge, Codex schema normalization |
| 통합 | `computeUninstall` 플랜, warning rendering, apply order, restore/continue-on-error, 실행 후 디스크 상태 |
| E2E(tmux) | sync → 사용자 편집 → sync → dry-run warning 검증 → uninstall → 보존/제거/복구 검증 |

완료: `npm run lint` + `npm test` + T7 통과.

---

## 8. 리스크 / 결정 필요 항목

1. **Codex `.codex/hooks.json` 소유권**
   - 최대 결정 사항.
   - 사용자 안전 우선이면 병합형 승격(A).
   - 구현 단순성과 기존 가정 유지면 전용 계약(B), 대신 경고/문서가 필수.
2. **사용자 콘텐츠 오삭제**
   - 모든 제거는 마커/메타/`.omh/hooks` canonical realpath 기반.
   - 불확실하면 보존.
3. **한 matcher group에 사용자 hook과 OMH hook이 섞인 경우**
   - hook command 단위 partition 필요.
   - entry 단위 삭제만 하면 사용자 hook까지 지울 수 있다.
4. **OMH hook path traversal/symlink bypass**
   - 문자열 매칭만으로 `.omh/hooks`를 판정하면 프로젝트 밖 script를 OMH 소유로 오인할 수 있다.
   - `realpath(projectDir/.omh/hooks)` strict descendant 검증과 symlink-outside false 테스트가 필수다.
5. **Codex TOML 주석 손실 — 높은 우선순위 사용자 콘텐츠 리스크**
   - 기존 parser round-trip은 comments를 보존하지 않는다.
   - uninstall dry-run은 `.codex/config.toml` 수정 시 in-file comments가 제거될 수 있음을 경고해야 한다.
   - T4에서 comment-preserving TOML 대안 또는 최소 변경 preservation strategy를 평가/구현한다.
6. **Codex `[features].hooks/goals` 사용자 설정 오탐**
   - 현재 메타가 없어 OMH가 추가한 값과 사용자가 직접 설정한 값을 구분할 수 없다.
   - dry-run은 제거 예정과 복원 필요 가능성을 명시해야 한다.
   - T7에는 사용자가 직접 설정한 feature keys 케이스를 포함한다.
7. **부분 실패 시 복구 전략**
   - modify → delete → removeDirs 순서와 modify backup/restore가 필요하다.
   - post-run summary는 성공/실패/복원/잔여 파일을 명확히 보여야 한다.
   - 기본은 stop-on-error, 자동화는 `--continue-on-error`를 선택할 수 있다.
8. **Pi generated file 직접 편집**
   - `.pi/extensions/omh-harness.ts`는 전용 파일로 명시.
   - 사용자 커스터마이징은 별도 `.pi/extensions/*.ts` 파일로 안내.
9. **manifest 없는 레거시 프로젝트**
   - 마커/경로 기반 best-effort 제거.
10. **명령 이름**
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
- destructive warning renderer
- 부분 실패/복구 전략
- 플랜 테스트

### PR-3 — CLI + 문서 + E2E

- `omh uninstall` command
- dry-run/confirm/yes/purge/skip-backup-warning/continue-on-error
- README
- tmux 통합 QA

단일 PR도 가능하지만, sync 시 사용자 훅 clobber는 uninstall과 독립적인 선재 버그이므로 PR-1을 먼저 내는 것이 안전하다.
