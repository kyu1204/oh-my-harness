export type Installer =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "volta"
  | "npx"
  | "unknown";

export interface InstallerInfo {
  installer: Installer;
  updateCommand: string;
  isEphemeral: boolean;
  notes?: string;
}

const PKG = "oh-my-harness";

function parseYarnMajor(ua: string): number | null {
  const match = ua.match(/yarn\/(\d+)/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isFinite(major) ? major : null;
}

function yarnInfo(ua: string): InstallerInfo {
  const major = parseYarnMajor(ua);
  if (major !== null && major >= 2) {
    return {
      installer: "yarn",
      updateCommand: `yarn dlx ${PKG}@latest`,
      isEphemeral: false,
      notes:
        "Yarn 2+ removed `yarn global` — `yarn dlx` runs the package on demand. Install globally with npm if you want a persistent binary.",
    };
  }
  return {
    installer: "yarn",
    updateCommand: `yarn global add ${PKG}@latest`,
    isEphemeral: false,
  };
}

export function detectInstaller(
  env: NodeJS.ProcessEnv = process.env,
): InstallerInfo {
  const ua = env.npm_config_user_agent ?? "";
  const execPath = env.npm_execpath ?? "";

  if (ua.includes("npx") || execPath.includes("npx")) {
    return {
      installer: "npx",
      updateCommand: `npm install -g ${PKG}@latest`,
      isEphemeral: true,
      notes: "Detected npx run — install globally to keep updates persistent.",
    };
  }

  if (env.VOLTA_HOME) {
    return {
      installer: "volta",
      updateCommand: `volta install ${PKG}`,
      isEphemeral: false,
    };
  }

  if (ua.includes("pnpm/")) {
    return {
      installer: "pnpm",
      updateCommand: `pnpm add -g ${PKG}@latest`,
      isEphemeral: false,
    };
  }
  if (ua.includes("yarn/")) {
    return yarnInfo(ua);
  }
  if (ua.includes("bun/")) {
    return {
      installer: "bun",
      updateCommand: `bun add -g ${PKG}@latest`,
      isEphemeral: false,
    };
  }
  if (ua.includes("npm/")) {
    return {
      installer: "npm",
      updateCommand: `npm install -g ${PKG}@latest`,
      isEphemeral: false,
    };
  }

  return {
    installer: "npm",
    updateCommand: `npm install -g ${PKG}@latest`,
    isEphemeral: false,
  };
}
