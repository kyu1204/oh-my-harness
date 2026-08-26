import path from "node:path";
import type { MergedConfig } from "../core/merged-config.js";
import type { PlannedFile } from "../core/plan.js";
import { renderSkill } from "../loop/protocol.js";

/**
 * Generated loop assets. There is exactly one: the skill that turns "run
 * this as a loop" into the setup steps. The supervisor itself is code
 * (src/loop), not a generated script, and is reached through `omh loop`.
 */
export interface LoopAssetOptions {
  projectDir: string;
  config: MergedConfig;
}

function skillDir(projectDir: string): string {
  return path.join(projectDir, ".claude", "skills", "omh-loop");
}

/** Paths a disable or uninstall removes; the skill directory as a whole. */
export function loopAssetPaths(projectDir: string): string[] {
  return [skillDir(projectDir)];
}

export async function computeLoopAssets(options: LoopAssetOptions): Promise<PlannedFile[]> {
  const { projectDir, config } = options;
  if (!config.loop) return [];
  return [{ path: path.join(skillDir(projectDir), "SKILL.md"), content: renderSkill(config.loop) }];
}
