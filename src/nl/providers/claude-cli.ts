import { spawn } from "node:child_process";
import type { LLMProvider } from "../provider-registry.js";

export function createClaudeCliProvider(command: string = "claude"): LLMProvider {
  return {
    name: "claude",
    run: async (prompt: string): Promise<string> => {
      return new Promise((resolve, reject) => {
        const proc = spawn(command, ["-p", "-"], {
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
            reject(new Error(`${command} CLI not found. Install it with: npm install -g @anthropic-ai/claude-code`));
          } else {
            reject(err);
          }
        });

        proc.on("close", (code) => {
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
          }
        });

        proc.stdin.write(prompt);
        proc.stdin.end();
      });
    },
  };
}
