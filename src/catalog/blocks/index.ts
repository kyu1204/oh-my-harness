import type { BuildingBlock } from "../types.js";

import { branchGuard } from "./branch-guard.js";
import { commitTestGate } from "./commit-test-gate.js";
import { commitTypecheckGate } from "./commit-typecheck-gate.js";
import { commandGuard } from "./command-guard.js";
import { pathGuard } from "./path-guard.js";
import { lockfileGuard } from "./lockfile-guard.js";
import { lintOnSave } from "./lint-on-save.js";
import { formatOnSave } from "./format-on-save.js";
import { autoPr } from "./auto-pr.js";
import { secretFileGuard } from "./secret-file-guard.js";
import { tddGuard } from "./tdd-guard.js";
import { sqlGuard } from "./sql-guard.js";
import { testOnSave } from "./test-on-save.js";
import { desktopNotify } from "./desktop-notify.js";
import { configAudit } from "./config-audit.js";
import { compactContext } from "./compact-context.js";
import { worktreeSetup } from "./worktree-setup.js";

export const builtinBlocks: BuildingBlock[] = [
  branchGuard,
  commitTestGate,
  commitTypecheckGate,
  commandGuard,
  pathGuard,
  lockfileGuard,
  lintOnSave,
  formatOnSave,
  autoPr,
  secretFileGuard,
  tddGuard,
  sqlGuard,
  testOnSave,
  desktopNotify,
  configAudit,
  compactContext,
  worktreeSetup,
];
