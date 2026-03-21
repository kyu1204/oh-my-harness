import type { BuildingBlock } from "../types.js";

export const configAudit: BuildingBlock = {
  id: "config-audit",
  name: "Config Audit",
  description: "Logs configuration changes for audit trail",
  category: "audit",
  event: "ConfigChange",
  matcher: "",
  canBlock: false,
  params: [
    {
      name: "logFile",
      type: "string",
      description: "Path to the audit log file",
      default: ".claude/hooks/.state/config-audit.log",
      required: false,
    },
  ],
  tags: ["audit", "config", "logging"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
LOG_FILE="{{{logFile}}}"
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
SOURCE=$(echo "$INPUT" | jq -r '.source // "unknown"' 2>/dev/null)
FILE=$(echo "$INPUT" | jq -r '.file_path // "unknown"' 2>/dev/null)
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "{\\"ts\\":\\"$TS\\",\\"source\\":\\"$SOURCE\\",\\"file\\":\\"$FILE\\"}" >> "$LOG_FILE"
exit 0`,
};
