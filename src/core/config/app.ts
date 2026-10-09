import "server-only";

import { parseAppOrigin } from "@/core/auth/origin";

export interface AppConfig {
  readonly name: string;
  readonly url: string;
}

function resolveAppName(): string {
  const isProduction = process.env.NODE_ENV === "production";
  const name = process.env.APP_NAME?.trim();

  if (isProduction && !name) {
    throw new Error("APP_NAME é obrigatório em ambiente de produção.");
  }

  return name || "GUIDU";
}

function resolveAppUrl(): string {
  const isProduction = process.env.NODE_ENV === "production";
  const rawUrl = process.env.APP_URL?.trim();

  if (isProduction && !rawUrl) {
    throw new Error("APP_URL é obrigatório em ambiente de produção.");
  }

  return parseAppOrigin(rawUrl || "http://localhost:3000");
}

export const appConfig: AppConfig = {
  get name(): string {
    return resolveAppName();
  },
  get url(): string {
    return resolveAppUrl();
  },
};
