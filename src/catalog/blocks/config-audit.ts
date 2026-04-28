import type { BuildingBlock } from "../types.js";

export const configAudit: BuildingBlock = {
  id: "config-audit",
  name: "Config Audit",
  description: "Logs configuration changes into the unified events.jsonl audit trail",
  category: "audit",
  event: "ConfigChange",
  matcher: "",
  canBlock: false,
  params: [],
  tags: ["audit", "config", "logging"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
SOURCE=$(echo "$INPUT" | jq -r '.source // "unknown"' 2>/dev/null)
FILE=$(echo "$INPUT" | jq -r '.file_path // "unknown"' 2>/dev/null)
META=$(jq -nc --arg s "$SOURCE" --arg f "$FILE" '{source:$s,file:$f}' 2>/dev/null)
[ -z "$META" ] && META='{"source":"unknown","file":"unknown"}'
_log_event "allow" "" "$META"
exit 0`,
};
