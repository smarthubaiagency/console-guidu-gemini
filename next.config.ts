import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { staticSecurityHeaders } from "./src/core/security/headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `*.localhost` serves partner domains in development (ADR 0012).
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.localhost"],
  // Security headers on every response (F6a); the CSP comes from src/proxy.ts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: staticSecurityHeaders({
          production: process.env.NODE_ENV === "production",
        }),
      },
    ];
  },
};

// Languages of the dashboard (I1): src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
