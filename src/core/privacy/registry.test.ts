import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listRegisteredModules } from "@/modules/registry";

import { listModuleDataContracts } from "./registry";

describe("module data contracts (F3e)", () => {
  it("covers exactly the modules that declare the export capability", () => {
    const exporting = listRegisteredModules()
      .filter((m) => m.manifest.capabilities.includes("export"))
      .map((m) => m.manifest.moduleKey)
      .sort();
    const contracts = listModuleDataContracts()
      .map((c) => c.moduleKey)
      .sort();
    expect(contracts).toEqual(exporting);
  });
});
