import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    env: {
      ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ENCRYPTION_KEY_ID: "k1",
      // Seal of the Event Hub (H1); CI generates its own.
      EVENTS_HMAC_KEY: process.env.EVENTS_HMAC_KEY || "vitest-events-hmac-key-0123456789abcdef",
      EVENTS_HMAC_KEY_ID: process.env.EVENTS_HMAC_KEY_ID || "k1",
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/unit/**/*.test.ts"],
          environment: "node",
          testTimeout: 30_000,
          hookTimeout: 30_000,
          sequence: { concurrent: false },
          fileParallelism: false,
        },
      },
    ],
  },
});
