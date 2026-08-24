import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { computeUninstall } from "../../src/core/uninstall.js";

describe("uninstall removes loop assets", () => {
  it("deletes the omh-loop skill directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omh-unins-"));
    const skillDir = path.join(dir, ".claude", "skills", "omh-loop");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "x", "utf-8");
    const plan = await computeUninstall({ projectDir: dir });
    expect(plan.delete).toContain(skillDir);
  });
});
