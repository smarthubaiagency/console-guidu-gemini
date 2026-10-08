import { expect, it } from "vitest";
import { describeDatabase } from "./describe-database.js";

describeDatabase(
  "DATABASE_REQUIRED contract (SMA-113): proves absence of DATABASE_URL fails under DATABASE_REQUIRED=1",
  { DATABASE_URL: process.env.DATABASE_URL, DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL },
  () => {
    it("passes when DATABASE_URL and DIRECT_DATABASE_URL are present", () => {
      if (process.env.DATABASE_REQUIRED === "1") {
        expect(process.env.DATABASE_URL).toBeTruthy();
        expect(process.env.DIRECT_DATABASE_URL).toBeTruthy();
      }
    });
  },
);