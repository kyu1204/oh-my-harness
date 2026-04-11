import type { BuildingBlock } from "../types.js";

export const tddGuard: BuildingBlock = {
  id: "tdd-guard",
  name: "TDD Guard",
  description: "Blocks source file edits unless corresponding test file was modified first",
  category: "quality",
  event: "PreToolUse",
  matcher: "Edit|Write",
  canBlock: true,
  params: [
    {
      name: "srcPattern",
      type: "string",
      description: "Regex pattern for source files to guard (default: .ts/.tsx/.js/.jsx)",
      required: false,
      default: "\\.(ts|tsx|js|jsx)$",
    },
    {
      name: "testPattern",
      type: "string",
      description: "Regex pattern for test files (default: .test.ts/.spec.ts etc.)",
      required: false,
      default: "\\.(test|spec)\\.(ts|tsx|js|jsx)$",
    },
  ],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
FILE_PATH=$(echo "\$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
[[ -z "\$FILE_PATH" ]] && exit 0

# 비코드 파일은 통과
case "\$FILE_PATH" in
  *.json|*.yaml|*.yml|*.md|*.sh|*.css|*.html|*.svg|*.png|*.jpg) exit 0 ;;
esac

# edit-history 상태 파일
STATE_DIR=".claude/hooks/.state"
HISTORY_FILE="\$STATE_DIR/edit-history.json"
mkdir -p "\$STATE_DIR" 2>/dev/null || true

TEST_RE='{{{testPattern}}}'
SRC_RE='{{{srcPattern}}}'
# Normalize double backslashes to single for [[ =~ ]] compatibility
TEST_RE="\${TEST_RE//\\\\\\\\/\\\\}"
SRC_RE="\${SRC_RE//\\\\\\\\/\\\\}"
if [[ "\$FILE_PATH" =~ \$TEST_RE ]]; then
  # 테스트 파일 수정 → 기록 + 통과 (flock으로 원자적 읽기/쓰기)
  (
    flock -x 200
    if [[ ! -f "\$HISTORY_FILE" ]]; then
      echo '{"edits":[]}' > "\$HISTORY_FILE"
    fi
    UPDATED=$(jq --arg f "\$FILE_PATH" '.edits += [$f] | .edits |= unique' "\$HISTORY_FILE" 2>/dev/null) || true
    if [[ -n "\$UPDATED" ]]; then
      echo "\$UPDATED" > "\$HISTORY_FILE"
    fi
  ) 200>"\$HISTORY_FILE.lock"
  exit 0
fi

# 소스 파일이 아니면 통과
if [[ ! "\$FILE_PATH" =~ \$SRC_RE ]]; then
  exit 0
fi

# 대응 테스트 파일 확인 — 확장자 제거
BASENAME=$(basename "\$FILE_PATH" | sed -E 's/\\.[^.]+$//')
TEST_SUFFIX=".test."

if [[ ! -f "\$HISTORY_FILE" ]]; then
  _log_event "block" "oh-my-harness: TDD — \${BASENAME}\${TEST_SUFFIX}* 테스트 파일을 먼저 수정하세요"
  echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: TDD — \${BASENAME}\${TEST_SUFFIX}* 테스트 파일을 먼저 수정하세요\\"}"
  exit 0
fi

# edit-history에서 테스트 파일 검색 (flock으로 원자적 읽기/쓰기)
DECISION=$(
  (
    flock -x 200
    if jq -e --arg b "\$BASENAME" '.edits[] | select(contains($b) and (contains(".test.") or contains(".spec.") or contains("test_")))' "\$HISTORY_FILE" >/dev/null 2>&1; then
      # 테스트 먼저 수정됨 → 매칭 테스트 기록 소비(제거) + 소스 기록 + 통과
      UPDATED=$(jq --arg b "\$BASENAME" --arg f "\$FILE_PATH" '
        .edits |= [.[] | select((contains($b) and (contains(".test.") or contains(".spec.") or contains("test_"))) | not)]
        | .edits += [$f] | .edits |= unique
      ' "\$HISTORY_FILE" 2>/dev/null) || true
      if [[ -n "\$UPDATED" ]]; then
        echo "\$UPDATED" > "\$HISTORY_FILE"
      fi
      echo "allow"
    else
      echo "block"
    fi
  ) 200>"\$HISTORY_FILE.lock"
)

if [[ "\$DECISION" == "allow" ]]; then
  exit 0
fi

_log_event "block" "oh-my-harness: TDD — \${BASENAME}\${TEST_SUFFIX}* 테스트 파일을 먼저 수정하세요"
echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: TDD — \${BASENAME}\${TEST_SUFFIX}* 테스트 파일을 먼저 수정하세요\\"}"
exit 0`,
  tags: ["tdd", "workflow", "quality"],
};
