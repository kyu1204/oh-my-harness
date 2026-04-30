import updateNotifier, { type UpdateNotifier, type Package } from "update-notifier";

export interface VersionNotifierResult {
  notifier: UpdateNotifier | null;
  skipped: boolean;
  skipReason?: string;
}

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

function shouldSkip(env: NodeJS.ProcessEnv): string | null {
  const v = env.OMH_SKIP_VERSION_CHECK;
  if (v === "1" || v === "true") {
    return "OMH_SKIP_VERSION_CHECK";
  }
  return null;
}

export function notifyIfUpdateAvailable(
  pkg: Package,
  env: NodeJS.ProcessEnv = process.env,
): VersionNotifierResult {
  const skipReason = shouldSkip(env);
  if (skipReason) {
    return { notifier: null, skipped: true, skipReason };
  }

  try {
    const notifier = updateNotifier({
      pkg,
      updateCheckInterval: ONE_DAY_MS,
    });
    notifier.notify({ defer: false, isGlobal: true });
    return { notifier, skipped: false };
  } catch {
    return { notifier: null, skipped: true, skipReason: "error" };
  }
}
