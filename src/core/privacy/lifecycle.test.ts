import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CloudflareError } from "@/core/domains/cloudflare";
import { workspaceDomainsLifecycle } from "@/core/domains/lifecycle";
import { googleConnectionLifecycle } from "@/core/integrations/google/lifecycle";
import { encryptSecret } from "@/core/credentials/crypto";
import type { ContextTransaction } from "@/lib/prisma/with-context";

import type { ExternalPurgeIO } from "./contract";
import {
  type HookRecord,
  type PhaseStore,
  pendingHooks,
  runLifecyclePhase,
} from "./lifecycle";
import { listLifecycleHooks } from "./lifecycle-registry";

function memoryStore(initial: Record<string, HookRecord> = {}) {
  const records: Record<string, HookRecord> = { ...initial };
  const writes: string[] = [];
  const store: PhaseStore = {
    read: async () => ({ ...records }),
    write: async (key, record) => {
      writes.push(key);
      records[key] = record;
    },
  };
  return { store, records, writes };
}

const at = () => new Date("2026-10-17T12:00:00Z");

describe("lifecycle hooks of a workspace deletion (WS1)", () => {
  it("runs every hook in order and records each result", async () => {
    const order: string[] = [];
    const { store, records } = memoryStore();
    const result = await runLifecyclePhase(
      [
        { key: "a", run: async () => void order.push("a") },
        {
          key: "b",
          run: async () => {
            order.push("b");
            return { removed: 2 };
          },
        },
      ],
      store,
      at,
    );
    expect(order).toEqual(["a", "b"]);
    expect(result).toMatchObject({ ok: true, failed: [], ran: 2 });
    expect(records.b).toEqual({
      status: "ok",
      at: "2026-10-17T12:00:00.000Z",
      attempts: 1,
      result: { removed: 2 },
    });
  });

  it("keeps going after a failure and reports the phase as not done", async () => {
    const order: string[] = [];
    const { store, records } = memoryStore();
    const result = await runLifecyclePhase(
      [
        {
          key: "rooms",
          run: async () => {
            order.push("rooms");
            throw new Error("synapse offline");
          },
        },
        { key: "cdn", run: async () => void order.push("cdn") },
      ],
      store,
      at,
    );
    expect(order).toEqual(["rooms", "cdn"]);
    expect(result.ok).toBe(false);
    expect(result.failed).toEqual(["rooms"]);
    expect(records.rooms).toMatchObject({
      status: "failed",
      attempts: 1,
      error: "Error: synapse offline",
    });
    expect(pendingHooks([{ key: "rooms" }, { key: "cdn" }], records)).toEqual([
      "rooms",
    ]);
  });

  it("on retry runs only what is not done yet, counting the attempts", async () => {
    const calls: string[] = [];
    const { store, records, writes } = memoryStore({
      rooms: { status: "failed", at: "x", attempts: 2, error: "e" },
      cdn: { status: "ok", at: "x", attempts: 1 },
    });
    const result = await runLifecyclePhase(
      [
        { key: "rooms", run: async () => void calls.push("rooms") },
        { key: "cdn", run: async () => void calls.push("cdn") },
      ],
      store,
      at,
    );
    expect(calls).toEqual(["rooms"]);
    expect(writes).toEqual(["rooms"]);
    expect(result).toMatchObject({ ok: true, ran: 1 });
    expect(records.rooms).toMatchObject({ status: "ok", attempts: 3 });
    expect(pendingHooks([{ key: "rooms" }, { key: "cdn" }], records)).toEqual(
      [],
    );
  });

  it("lists the core resources after the modules, with unique keys", () => {
    const keys = listLifecycleHooks().map((hook) => hook.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.slice(-3)).toEqual([
      "core.google_connection",
      "core.workspace_domains",
      "core.matrix",
    ]);
    expect(keys.filter((key) => !key.startsWith("core."))).toEqual(
      keys.slice(0, keys.length - 3),
    );
  });
});

/** An io whose queries answer the rows given. */
function ioWith(rows: unknown[]): ExternalPurgeIO {
  const tx = {
    $queryRaw: async () => rows,
  } as unknown as ContextTransaction;
  return { transaction: (operation) => operation(tx) };
}

describe("first external hooks (WS1)", () => {
  it("revokes the Google token, tolerating one already gone", async () => {
    const revoked: string[] = [];
    const row = {
      access_token_encrypted: encryptSecret("access").encryptedPayload,
      refresh_token_encrypted: encryptSecret("refresh").encryptedPayload,
    };
    const hook = googleConnectionLifecycle({
      revoke: async (token) => {
        revoked.push(token);
        return "already_gone";
      },
    });
    expect(await hook.purgeExternal!("ws", ioWith([row]))).toEqual({
      revoked: "already_gone",
    });
    expect(revoked).toEqual(["refresh"]);
    expect(await hook.purgeExternal!("ws", ioWith([]))).toEqual({
      revoked: "none",
    });
    await expect(
      googleConnectionLifecycle({
        revoke: async () => {
          throw new Error("network");
        },
      }).purgeExternal!("ws", ioWith([row])),
    ).rejects.toThrow("network");
  });

  it("removes the Cloudflare hostnames, a 404 counting as removed", async () => {
    const removed: string[] = [];
    const client = {
      upsert: vi.fn(),
      refresh: vi.fn(),
      async remove(id: string) {
        if (id === "gone") throw new CloudflareError(404);
        if (id === "down") throw new CloudflareError(503);
        removed.push(id);
      },
    };
    const hook = workspaceDomainsLifecycle({ client });
    expect(
      await hook.purgeExternal!(
        "ws",
        ioWith([
          { id: "1", cloudflare_hostname_id: "cf-1" },
          { id: "2", cloudflare_hostname_id: "gone" },
        ]),
      ),
    ).toEqual({ removed: 1, alreadyGone: 1 });
    expect(removed).toEqual(["cf-1"]);
    await expect(
      hook.purgeExternal!(
        "ws",
        ioWith([{ id: "3", cloudflare_hostname_id: "down" }]),
      ),
    ).rejects.toBeInstanceOf(CloudflareError);
    expect(
      await workspaceDomainsLifecycle({ client: null }).purgeExternal!(
        "ws",
        ioWith([{ id: "4", cloudflare_hostname_id: "cf-4" }]),
      ),
    ).toEqual({ removed: 0, alreadyGone: 0, cloudflare: "off" });
  });
});
