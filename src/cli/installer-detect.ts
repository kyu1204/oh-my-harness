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

const COMMANDS: Record<Exclude<Installer, "unknown">, string> = {
  npm: `npm install -g ${PKG}@latest`,
  pnpm: `pnpm add -g ${PKG}@latest`,
  yarn: `yarn global add ${PKG}@latest`,
  bun: `bun add -g ${PKG}@latest`,
  volta: `volta install ${PKG}`,
  npx: `npm install -g ${PKG}@latest`,
};

export function detectInstaller(
  env: NodeJS.ProcessEnv = process.env,
): InstallerInfo {
  const ua = env.npm_config_user_agent ?? "";
  const execPath = env.npm_execpath ?? "";

  if (ua.includes("npx") || execPath.includes("npx")) {
    return {
      installer: "npx",
      updateCommand: COMMANDS.npx,
      isEphemeral: true,
      notes: "Detected npx run — install globally to keep updates persistent.",
    };
  }

  if (env.VOLTA_HOME) {
    return {
      installer: "volta",
      updateCommand: COMMANDS.volta,
      isEphemeral: false,
    };
  }

  if (ua.includes("pnpm/")) {
    return {
      installer: "pnpm",
      updateCommand: COMMANDS.pnpm,
      isEphemeral: false,
    };
  }
  if (ua.includes("yarn/")) {
    return {
      installer: "yarn",
      updateCommand: COMMANDS.yarn,
      isEphemeral: false,
    };
  }
  if (ua.includes("bun/")) {
    return {
      installer: "bun",
      updateCommand: COMMANDS.bun,
      isEphemeral: false,
    };
  }
  if (ua.includes("npm/")) {
    return {
      installer: "npm",
      updateCommand: COMMANDS.npm,
      isEphemeral: false,
    };
  }

  return {
    installer: "npm",
    updateCommand: COMMANDS.npm,
    isEphemeral: false,
  };
}
