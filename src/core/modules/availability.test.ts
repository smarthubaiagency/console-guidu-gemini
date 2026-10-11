import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertModuleAvailable,
  isModuleTechnicallyAvailable,
  ModuleUnavailableError,
} from "./availability";

describe("Module Availability", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("isModuleTechnicallyAvailable", () => {
    it("returns false for ai-agents by default (when GUIDU_MODULE_AI_AGENTS_ENABLED is unset)", () => {
      delete process.env.GUIDU_MODULE_AI_AGENTS_ENABLED;
      expect(isModuleTechnicallyAvailable("ai-agents")).toBe(false);
    });

    it("returns true for ai-agents when GUIDU_MODULE_AI_AGENTS_ENABLED === 'true'", () => {
      vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "true");
      expect(isModuleTechnicallyAvailable("ai-agents")).toBe(true);
    });

    it("returns false for ai-agents when GUIDU_MODULE_AI_AGENTS_ENABLED is any other value", () => {
      for (const val of ["false", "1", "TRUE", "yes", "enabled", ""]) {
        vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", val);
        expect(isModuleTechnicallyAvailable("ai-agents")).toBe(false);
      }
    });

    it("returns false for coming-soon google-business and true for the portfolio", () => {
      vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "true");
      expect(isModuleTechnicallyAvailable("google-business")).toBe(false);
      expect(isModuleTechnicallyAvailable("portfolio")).toBe(true);
    });
  });

  describe("assertModuleAvailable", () => {
    it("throws ModuleUnavailableError when module is not available", () => {
      delete process.env.GUIDU_MODULE_AI_AGENTS_ENABLED;
      expect(() => assertModuleAvailable("ai-agents")).toThrow(
        ModuleUnavailableError,
      );
      expect(() => assertModuleAvailable("google-business")).toThrow(
        ModuleUnavailableError,
      );
    });

    it("does not throw when module is available", () => {
      vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "true");
      expect(() => assertModuleAvailable("ai-agents")).not.toThrow();
    });
  });
});
