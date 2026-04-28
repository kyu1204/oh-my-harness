import fs from "node:fs/promises";

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    // Permission/IO errors must NOT masquerade as "missing" — that would
    // silently skip migration steps for files that actually exist.
    throw err;
  }
}

export async function readFileOrDefault(filePath: string, fallback = ""): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

export async function endsWithNewline(filePath: string): Promise<boolean> {
  const fh = await fs.open(filePath, "r");
  try {
    const { size } = await fh.stat();
    if (size === 0) return true;
    const buf = Buffer.alloc(1);
    await fh.read(buf, 0, 1, size - 1);
    return buf[0] === 0x0a;
  } finally {
    await fh.close();
  }
}
