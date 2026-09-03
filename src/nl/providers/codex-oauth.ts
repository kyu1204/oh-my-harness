import { spawn } from "node:child_process";
import type { LLMProvider } from "../provider-registry.js";

const DEFAULT_COMMAND = "codex";
const DEFAULT_MODEL = "gpt-5.6-sol";
const DEFAULT_TIMEOUT_MS = 120_000;

export interface CodexOauthProviderOptions {
  timeoutMs?: number;
}

export function createCodexOauthProvider(
  command: string = DEFAULT_COMMAND,
  model: string = DEFAULT_MODEL,
  options: CodexOauthProviderOptions = {},
): LLMProvider {
  return {
    name: "codex",
    run: async (prompt: string): Promise<string> => {
      return new Promise((resolve, reject) => {
        let settled = false;
        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        let timeout: NodeJS.Timeout | undefined;
        const finalize = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          fn();
        };

        const args = [
          "--ask-for-approval",
          "never",
          "exec",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--color",
          "never",
          "-m",
          model,
          "-",
        ];

        const proc = spawn(command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
        });

        timeout = setTimeout(() => {
          proc.kill("SIGTERM");
          finalize(() => {
            reject(new Error(`${command} timed out after ${Math.ceil(timeoutMs / 1000)} seconds`));
          });
        }, timeoutMs);

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "ENOENT") {
            finalize(() => reject(
              new Error(
                `${command} Codex CLI not found. Install Codex and sign in with ChatGPT using: codex login`,
              ),
            ));
          } else {
            finalize(() => reject(err));
          }
        });

        proc.on("close", (code) => {
          if (code === 0) {
            finalize(() => resolve(stdout.trim()));
            return;
          }

          const details = (stderr || stdout).trim();
          finalize(() => reject(
            new Error(
              `${command} exited with code ${code}: ${details || "no output"}\n` +
                "Codex OAuth mode uses your Codex CLI ChatGPT login. Run `codex login` and retry.",
            ),
          ));
        });

        proc.stdin.write(prompt);
        proc.stdin.end();
      });
    },
  };
}
