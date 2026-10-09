import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { appConfig } from "./app";

describe("appConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("produção (NODE_ENV=production)", () => {
    it("falha quando APP_NAME não está configurado", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_URL", "https://console.guidu.co");
      delete process.env.APP_NAME;

      expect(() => appConfig.name).toThrow(
        "APP_NAME é obrigatório em ambiente de produção.",
      );
    });

    it("falha quando APP_NAME é apenas espaços em branco", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_NAME", "   ");
      vi.stubEnv("APP_URL", "https://console.guidu.co");

      expect(() => appConfig.name).toThrow(
        "APP_NAME é obrigatório em ambiente de produção.",
      );
    });

    it("falha quando APP_URL não está configurado", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_NAME", "GUIDU");
      delete process.env.APP_URL;

      expect(() => appConfig.url).toThrow(
        "APP_URL é obrigatório em ambiente de produção.",
      );
    });

    it("falha quando APP_URL é apenas espaços em branco", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_NAME", "GUIDU");
      vi.stubEnv("APP_URL", "   ");

      expect(() => appConfig.url).toThrow(
        "APP_URL é obrigatório em ambiente de produção.",
      );
    });

    it("retorna os valores corretos quando ambos estão configurados", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_NAME", "Minha Marca");
      vi.stubEnv("APP_URL", "https://app.minhamarca.com");

      expect(appConfig.name).toBe("Minha Marca");
      expect(appConfig.url).toBe("https://app.minhamarca.com");
    });
  });

  describe("desenvolvimento e teste (NODE_ENV != production)", () => {
    it("usa os valores padrão quando variáveis não estão definidas", () => {
      vi.stubEnv("NODE_ENV", "test");
      delete process.env.APP_NAME;
      delete process.env.APP_URL;

      expect(appConfig.name).toBe("GUIDU");
      expect(appConfig.url).toBe("http://localhost:3000");
    });

    it("usa valores configurados quando fornecidos", () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("APP_NAME", "Custom Dev App");
      vi.stubEnv("APP_URL", "http://127.0.0.1:4000");

      expect(appConfig.name).toBe("Custom Dev App");
      expect(appConfig.url).toBe("http://127.0.0.1:4000");
    });
  });

  describe("validação de APP_URL via parseAppOrigin", () => {
    it.each([
      "https://console.guidu.co/auth",
      "https://console.guidu.co/auth/",
      "http://localhost:3000/nested/path",
      "https://console.guidu.co?param=value",
      "https://console.guidu.co#hash",
      "not-a-valid-url",
    ])("rejeita APP_URL com path, query, hash ou inválido: %s", (invalidUrl) => {
      vi.stubEnv("APP_URL", invalidUrl);

      expect(() => appConfig.url).toThrow();
    });

    it("normaliza origin com espaços e trailing slash no host", () => {
      vi.stubEnv("APP_URL", " https://console.guidu.co/ ");

      expect(appConfig.url).toBe("https://console.guidu.co");
    });
  });
});
