import type { BuildingBlock } from "../types.js";

export const desktopNotify: BuildingBlock = {
  id: "desktop-notify",
  name: "Desktop Notify",
  description: "Sends desktop notification when Claude needs attention",
  category: "notification",
  event: "Notification",
  matcher: "",
  canBlock: false,
  params: [],
  tags: ["notification", "desktop", "alert"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
MESSAGE=$(echo "$INPUT" | jq -r '.message // "Claude Code needs your attention"' 2>/dev/null)
if [[ "$(uname)" == "Darwin" ]]; then
  osascript -e "display notification \\"$MESSAGE\\" with title \\"Claude Code\\"" 2>/dev/null || true
elif command -v notify-send &>/dev/null; then
  notify-send "Claude Code" "$MESSAGE" 2>/dev/null || true
fi
exit 0`,
};
