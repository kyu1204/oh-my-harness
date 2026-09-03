import { spawn as nodeSpawn } from "node:child_process";
import type { EventEmitter } from "node:events";

type SpawnLike = (cmd: string, args: string[], opts: { detached: boolean; stdio: "ignore" }) => EventEmitter & { unref(): void };

export function browserCommandFor(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
  return ["xdg-open", [url]];
}

/**
 * Best-effort: open the URL in the OS default browser. Never throws; returns
 * false so callers can tell the user to open it by hand (SSH, containers).
 */
export function openInBrowser(
  url: string,
  deps: { spawn?: SpawnLike; platform?: NodeJS.Platform } = {},
): Promise<boolean> {
  if (!/^https?:\/\//.test(url)) return Promise.resolve(false);
  const spawn = deps.spawn ?? (nodeSpawn as unknown as SpawnLike);
  const [cmd, args] = browserCommandFor(deps.platform ?? process.platform, url);
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
      child.once("error", () => resolve(false));
      child.once("spawn", () => resolve(true));
      child.unref();
    } catch {
      resolve(false);
    }
  });
}

/** OSC 8 terminal hyperlink: stays one clickable link even when soft-wrapped. */
export function hyperlink(url: string): string {
  const ESC = String.fromCharCode(27);
  return `${ESC}]8;;${url}${ESC}\\${url}${ESC}]8;;${ESC}\\`;
}
