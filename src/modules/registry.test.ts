import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getModulePermissionRoles,
  getRegisteredModule,
  listRegisteredModules,
} from "./registry";

describe("module registry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers the initial modules and the reference module", () => {
    expect(listRegisteredModules().map((m) => m.manifest.moduleKey)).toEqual([
      "catalog",
      "google-business",
      "ai-agents",
      "hello-world",
    ]);
  });

  it("keeps ai-agents and hello-world off unless their flag is exactly 'true'", () => {
    const aiAgents = getRegisteredModule("ai-agents");
    const helloWorld = getRegisteredModule("hello-world");
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "");
    vi.stubEnv("GUIDU_MODULE_HELLO_WORLD_ENABLED", "1");
    expect(aiAgents?.technicalGate()).toBe(false);
    expect(helloWorld?.technicalGate()).toBe(false);

    vi.stubEnv("GUIDU_MODULE_HELLO_WORLD_ENABLED", "true");
    expect(helloWorld?.technicalGate()).toBe(true);
    expect(getRegisteredModule("catalog")?.technicalGate()).toBe(true);
  });

  it("resolves module permission defaults and denies unknown ones", () => {
    expect(getModulePermissionRoles("hello_world.records.write")).toEqual([
      "owner",
      "admin",
      "editor",
    ]);
    expect(getModulePermissionRoles("hello_world.unknown")).toBeNull();
  });

  it("returns null for unknown modules", () => {
    expect(getRegisteredModule("unknown")).toBeNull();
  });
});
