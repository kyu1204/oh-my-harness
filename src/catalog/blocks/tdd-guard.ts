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

if echo "\$FILE_PATH" | grep -qE '\\.(test|spec)\\.(ts|tsx|js|jsx)$'; then
  # 테스트 파일 수정 → 기록 + 통과
  if [[ ! -f "\$HISTORY_FILE" ]]; then
    echo '{"edits":[]}' > "\$HISTORY_FILE"
  fi
  UPDATED=$(jq --arg f "\$FILE_PATH" '.edits += [$f] | .edits |= unique' "\$HISTORY_FILE" 2>/dev/null) || true
  if [[ -n "\$UPDATED" ]]; then
    echo "\$UPDATED" > "\$HISTORY_FILE"
  fi
  exit 0
fi

# 소스 파일 (.ts/.tsx/.js/.jsx) 이 아니면 통과
if ! echo "\$FILE_PATH" | grep -qE '\\.(ts|tsx|js|jsx)$'; then
  exit 0
fi

# 대응 테스트 파일 확인
BASENAME=$(basename "\$FILE_PATH" | sed -E 's/\\.(ts|tsx|js|jsx)$//')
TEST_SUFFIX=".test."

if [[ ! -f "\$HISTORY_FILE" ]]; then
  echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: TDD — \${BASENAME}\${TEST_SUFFIX}* 테스트 파일을 먼저 수정하세요\\"}"
  exit 0
fi

# edit-history에서 테스트 파일 검색
if jq -e --arg b "\$BASENAME" '.edits[] | select(contains($b + ".test.") or contains($b + ".spec."))' "\$HISTORY_FILE" >/dev/null 2>&1; then
  # 테스트 먼저 수정됨 → 소스 기록 + 통과
  UPDATED=$(jq --arg f "\$FILE_PATH" '.edits += [$f] | .edits |= unique' "\$HISTORY_FILE" 2>/dev/null) || true
  if [[ -n "\$UPDATED" ]]; then
    echo "\$UPDATED" > "\$HISTORY_FILE"
  fi
  exit 0
fi

echo "{\\"decision\\": \\"block\\", \\"reason\\": \\"oh-my-harness: TDD — \${BASENAME}\${TEST_SUFFIX}* 테스트 파일을 먼저 수정하세요\\"}"
exit 0`,
  tags: ["tdd", "workflow", "quality"],
};
