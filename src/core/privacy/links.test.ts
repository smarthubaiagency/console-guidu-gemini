import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { privacySchedules } from "./maintenance";
import {
  EXPORT_LINK_TTL_MS,
  exportDownloadHref,
  signExportLink,
  verifyExportLink,
} from "./links";

const exportId = "00000000-0000-4000-8000-0000000000e1";
const user = "00000000-0000-4000-8000-0000000000a1";
const now = 1_800_000_000_000;

describe("short export links (F3e)", () => {
  it("is valid for the same export and person for 15 minutes", () => {
    const { expires, signature } = signExportLink(exportId, user, now);
    expect(expires - now).toBe(EXPORT_LINK_TTL_MS);
    expect(
      verifyExportLink(exportId, user, expires, signature, now + 60_000),
    ).toBe(true);
    expect(
      verifyExportLink(exportId, user, expires, signature, expires + 1),
    ).toBe(false);
  });

  it("refuses another person, another export, a longer expiry or a forged signature", () => {
    const { expires, signature } = signExportLink(exportId, user, now);
    expect(
      verifyExportLink(
        exportId,
        "00000000-0000-4000-8000-0000000000a2",
        expires,
        signature,
        now,
      ),
    ).toBe(false);
    expect(
      verifyExportLink(
        "00000000-0000-4000-8000-0000000000e2",
        user,
        expires,
        signature,
        now,
      ),
    ).toBe(false);
    expect(
      verifyExportLink(exportId, user, expires + 3_600_000, signature, now),
    ).toBe(false);
    expect(
      verifyExportLink(
        exportId,
        user,
        expires,
        `${signature.slice(0, -2)}xx`,
        now,
      ),
    ).toBe(false);
    expect(verifyExportLink(exportId, user, Number.NaN, signature, now)).toBe(
      false,
    );
  });

  it("builds the download path of the workspace", () => {
    expect(exportDownloadHref("loja-centro", exportId, user)).toMatch(
      /^\/app\/loja-centro\/settings\/data\/exports\/[0-9a-f-]{36}\?expires=\d+&signature=[\w-]+$/,
    );
  });
});

describe("privacy schedule", () => {
  it("runs once a day from 03:00 in Brasília", () => {
    const [daily] = privacySchedules;
    expect(daily?.due(new Date("2026-10-17T05:59:00Z"))).toBeNull();
    expect(daily?.due(new Date("2026-10-17T06:00:00Z"))).toEqual({
      key: "2026-10-17",
      payload: { date: "2026-10-17" },
    });
  });
});
