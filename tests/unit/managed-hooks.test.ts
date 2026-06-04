import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { isOmhHookCommand } from "../../src/core/managed-hooks.js";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "omh-managed-hooks-"));
  await mkdir(join(projectDir, ".omh", "hooks"), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("isOmhHookCommand", () => {
  it("recognizes generated hook commands under project .omh/hooks", async () => {
    const script = join(projectDir, ".omh", "hooks", "guard.sh");
    await writeFile(script, "#!/usr/bin/env bash\n", "utf8");

    await expect(isOmhHookCommand(`bash '${script}'`, projectDir)).resolves.toBe(true);
    await expect(isOmhHookCommand(`bash \"${script}\"`, projectDir)).resolves.toBe(true);
    await expect(isOmhHookCommand(script, projectDir)).resolves.toBe(true);
  });

  it("does not classify user hook commands as managed", async () => {
    await expect(isOmhHookCommand("node myhook.js", projectDir)).resolves.toBe(false);
    await expect(isOmhHookCommand("python3 ~/.codex/hooks/foo.py", projectDir)).resolves.toBe(false);
  });

  it("rejects traversal paths that resolve outside project .omh/hooks", async () => {
    const outside = await mkdtemp(join(tmpdir(), "outside-omh-hooks-"));
    try {
      const outsideScript = join(outside, "evil.sh");
      await writeFile(outsideScript, "#!/usr/bin/env bash\n", "utf8");
      const hooksDir = join(projectDir, ".omh", "hooks");
      const outsideRelativeToHooks = relative(hooksDir, outsideScript);
      expect(outsideRelativeToHooks).toContain("..");
      const traversal = `${hooksDir}${sep}${outsideRelativeToHooks}`;

      await expect(isOmhHookCommand(`bash '${traversal}'`, projectDir)).resolves.toBe(false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects symlinks inside .omh/hooks that point outside the hooks directory", async () => {
    const outside = await mkdtemp(join(tmpdir(), "outside-hook-target-"));
    try {
      const outsideScript = join(outside, "target.sh");
      await writeFile(outsideScript, "#!/usr/bin/env bash\n", "utf8");
      const link = join(projectDir, ".omh", "hooks", "linked.sh");
      await symlink(outsideScript, link);

      await expect(isOmhHookCommand(`bash '${link}'`, projectDir)).resolves.toBe(false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("does not trust a plain string that merely mentions .omh/hooks", async () => {
    await expect(isOmhHookCommand("echo .omh/hooks/guard.sh", projectDir)).resolves.toBe(false);
  });
});
