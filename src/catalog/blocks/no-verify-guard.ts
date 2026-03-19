import type { BuildingBlock } from "../types.js";

export const noVerifyGuard: BuildingBlock = {
  id: "no-verify-guard",
  name: "No-Verify Guard",
  description:
    "Blocks git commands that bypass hooks via --no-verify flags (powered by block-no-verify)",
  category: "security",
  event: "PreToolUse",
  matcher: "Bash",
  canBlock: true,
  params: [],
  tags: ["security", "git", "hooks", "guard"],
  template: `#!/bin/bash
set -euo pipefail
INPUT=$(cat)
echo "$INPUT" | npx --yes block-no-verify@1.1.2`,
};
