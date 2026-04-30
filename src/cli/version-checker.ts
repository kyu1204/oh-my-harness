const NPM_REGISTRY = "https://registry.npmjs.org";

export interface FetchOptions {
  timeoutMs?: number;
  registry?: string;
}

export async function fetchLatestVersion(
  pkgName: string,
  options: FetchOptions = {},
): Promise<string | null> {
  const timeout = options.timeoutMs ?? 10_000;
  const rawRegistry = options.registry ?? NPM_REGISTRY;
  const registry = rawRegistry.endsWith("/")
    ? rawRegistry.slice(0, -1)
    : rawRegistry;
  const encodedPkg = encodeURIComponent(pkgName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${registry}/${encodedPkg}/latest`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
