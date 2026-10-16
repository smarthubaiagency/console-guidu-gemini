import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("keeps a design-system font size next to a text colour", () => {
    expect(cn("text-12 text-text-subtle", "text-text")).toBe(
      "text-12 text-text",
    );
  });

  it("still merges conflicting font sizes", () => {
    expect(cn("text-12", "text-14")).toBe("text-14");
    expect(cn("text-sm text-muted-foreground", "text-xs")).toBe(
      "text-muted-foreground text-xs",
    );
  });

  it("lets the model-card radii and shadow replace the stock ones", () => {
    expect(cn("rounded-md shadow-sm", "rounded-inner shadow-card")).toBe(
      "rounded-inner shadow-card",
    );
    expect(cn("rounded-card", "rounded-panel")).toBe("rounded-panel");
  });
});
