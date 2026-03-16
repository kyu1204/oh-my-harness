import { describe, it, expect } from "vitest";

describe("intentional failure", () => {
  it("should fail", () => {
    expect(1).toBe(2);
  });
});
