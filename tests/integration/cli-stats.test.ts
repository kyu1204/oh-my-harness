import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("omh stats CLI", () => {
  it("omh stats --help shows description", () => {
    const output = execSync("npx oh-my-harness stats --help", {
      encoding: "utf-8",
      timeout: 10000,
    });
    expect(output).toContain("dashboard");
  });
});
