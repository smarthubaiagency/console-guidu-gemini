import { describe, expect, it } from "vitest";
import { cn } from "../../src/lib/utils";
describe("cn", () => {
  it("merges conflicting Tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
