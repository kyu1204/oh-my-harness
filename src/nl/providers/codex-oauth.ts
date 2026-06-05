import { spawn } from "node:child_process";
import type { LLMProvider } from "../provider-registry.js";

const DEFAULT_COMMAND = "codex";
const DEFAULT_MODEL = "gpt-5.5";

export function createCodexOauthProvider(
  command: string = DEFAULT_COMMAND,
  model: string = DEFAULT_MODEL,
): LLMProvider {
  return {
    name: "codex",
    run: async (prompt: string): Promise<string> => {
      return new Promise((resolve, reject) => {
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
            reject(
              new Error(
                `${command} Codex CLI not found. Install Codex and sign in with ChatGPT using: codex login`,
              ),
            );
          } else {
            reject(err);
          }
        });

        proc.on("close", (code) => {
          if (code === 0) {
            resolve(stdout.trim());
            return;
          }

          const details = (stderr || stdout).trim();
          reject(
            new Error(
              `${command} exited with code ${code}: ${details || "no output"}\n` +
                "Codex OAuth mode uses your Codex CLI ChatGPT login. Run `codex login` and retry.",
            ),
          );
        });

        proc.stdin.write(prompt);
        proc.stdin.end();
      });
    },
  };
}
