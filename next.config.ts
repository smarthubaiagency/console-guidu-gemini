import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `*.localhost` serves partner domains in development (ADR 0012).
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.localhost"],
};
export default nextConfig;
