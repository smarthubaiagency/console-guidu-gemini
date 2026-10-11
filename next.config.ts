import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `*.localhost` serves partner domains in development (ADR 0012).
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.localhost"],
};

// Languages of the dashboard (I1): src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
