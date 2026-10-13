import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BACKUP_WINDOW_MS, backupServes, isKeyFailure } from "./backup";
import { keyWatchSchedule } from "./key-watch";

describe("backup of the customer's key", () => {
  it("starts only on failures of the key or of the provider's limit", () => {
    expect(isKeyFailure("provider_auth")).toBe(true);
    expect(isKeyFailure("provider_limit")).toBe(true);
    for (const code of [
      "provider_error",
      "invalid_output",
      "timeout",
      "engine_error",
    ]) {
      expect(isKeyFailure(code)).toBe(false);
    }
  });

  it("serves only conversations opened before the failure, for 24 hours", () => {
    const started = new Date("2026-10-13T12:00:00Z");
    const before = new Date("2026-10-13T11:00:00Z");
    const after = new Date("2026-10-13T12:00:01Z");
    expect(backupServes(before, started, after)).toBe(true);
    expect(backupServes(started, started, after)).toBe(false);
    expect(backupServes(after, started, after)).toBe(false);
    const end = new Date(started.getTime() + BACKUP_WINDOW_MS);
    expect(backupServes(before, started, new Date(end.getTime() - 1))).toBe(
      true,
    );
    expect(backupServes(before, started, end)).toBe(false);
  });

  it("schedules the watch every 15 minutes", () => {
    const at = (iso: string) => keyWatchSchedule.due(new Date(iso))?.key;
    expect(at("2026-10-13T12:00:00Z")).toBe("2026-10-13T12:00:00.000Z");
    expect(at("2026-10-13T12:14:59Z")).toBe("2026-10-13T12:00:00.000Z");
    expect(at("2026-10-13T12:15:00Z")).toBe("2026-10-13T12:15:00.000Z");
  });
});
