import { generateKeyPairSync } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { encryptSecret } from "@/core/credentials/crypto";
import type { JobSession } from "@/core/jobs/definition";
import { matrixConfig } from "@/core/matrix/config";
import { processPendingEvents } from "@/core/matrix/events";
import type { SynapseClient } from "@/core/matrix/synapse";
import {
  TranslationError,
  type TranslationErrorCode,
  type Translator,
} from "@/core/translation/types";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { runTranslateMessage } from "@/modules/inbox/server/translate-job";
import {
  loadMessageTranslations,
  saveTranslationSettings,
} from "@/modules/inbox/server/translation";

import { contextA, contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * TR2 against the local database (no Synapse: the core's client is a
 * double that serves the room's events). The core enqueues the translation
 * of the messages of the contact and of the GUIDS in another language than
 * the team's (only the room and the event in the payload), the job writes
 * it as the person who saved the Inbox settings, the fallback is marked,
 * two failing engines leave `failed` after three attempts, a short message
 * is not translated, RLS keeps each workspace to itself and deleting the
 * room deletes its translations.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const MATRIX_ENV = {
  MATRIX_HOMESERVER_URL: "https://hs.tr2.test",
  MATRIX_SERVER_NAME: "hs.tr2.test",
  MATRIX_AS_TOKEN: "as-token",
  MATRIX_HS_TOKEN: "hs-token",
  MATRIX_JWT_PRIVATE_KEY: privateKey,
};
const config = matrixConfig(MATRIX_ENV)!;

const ROOM_A = "!tr2-a:hs.tr2.test";
const ROOM_B = "!tr2-b:hs.tr2.test";
const CONSUMER = "@cliente-tr2:hs.tr2.test";
const TEAM = "@u_aaaaaaaaaaaaaaaaaaaaaaaa:hs.tr2.test";
const AGENT = "@_guidu_a_aaaaaaaaaaaaaaaa:hs.tr2.test";
const LABEL = "Chave TR2";

type Said = { id: string; sender: string; ts: number; body: string };

const SAID: Said[] = [
  {
    id: "$tr2-es",
    sender: CONSUMER,
    ts: 1_000,
    body: "Hola, ¿tienen habitación para dos personas esta noche?",
  },
  {
    id: "$tr2-pt",
    sender: CONSUMER,
    ts: 2_000,
    body: "Também queria saber o preço do café da manhã",
  },
  {
    id: "$tr2-team",
    sender: TEAM,
    ts: 3_000,
    body: "Sí, tenemos una habitación doble disponible.",
  },
  {
    id: "$tr2-agent",
    sender: AGENT,
    ts: 4_000,
    body: "¡Claro! El desayuno está incluido en la tarifa.",
  },
  {
    id: "$tr2-fail",
    sender: CONSUMER,
    ts: 5_000,
    body: "¿Y el estacionamiento es gratis para los huéspedes?",
  },
  { id: "$tr2-short", sender: CONSUMER, ts: 6_000, body: "ok 👍" },
];

/** The core's client: serves the events of the room and its history. */
const client: SynapseClient = {
  config,
  async request<T>(method: string, path: string) {
    const event = /\/rooms\/[^/]+\/event\/(.+)$/.exec(path);
    if (method === "GET" && event?.[1]) {
      const said = SAID.find((s) => s.id === decodeURIComponent(event[1]!));
      if (!said) throw new Error("not found");
      return {
        type: "m.room.message",
        event_id: said.id,
        sender: said.sender,
        origin_server_ts: said.ts,
        content: { msgtype: "m.text", body: said.body },
      } as T;
    }
    if (method === "GET" && path.endsWith("/messages")) {
      return {
        chunk: [...SAID].reverse().map((s) => ({
          type: "m.room.message",
          event_id: s.id,
          sender: s.sender,
          origin_server_ts: s.ts,
          content: { msgtype: "m.text", body: s.body },
        })),
      } as T;
    }
    throw new Error(`unexpected ${method} ${path}`);
  },
};

function engine(
  name: "ai" | "google",
  answer: string | TranslationErrorCode,
  seen: string[] = [],
): Translator {
  return {
    engine: name,
    model: name === "ai" ? "gpt-5-nano" : null,
    async translate(input) {
      seen.push(input.text);
      if (["key", "quota", "timeout", "refusal", "error"].includes(answer)) {
        throw new TranslationError(answer as TranslationErrorCode);
      }
      return {
        text: answer,
        engine: name,
        model: name === "ai" ? "gpt-5-nano" : null,
      };
    },
  };
}

describeDatabase(
  "TR2: translation of the messages of the Inbox",
  {
    DATABASE_URL: databaseUrl,
    ADMIN_URL: adminUrl,
    WORKER_DATABASE_URL: workerUrl,
  },
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl ?? "" } },
    });
    const admin = new PrismaClient({
      datasources: { db: { url: adminUrl ?? "" } },
    });
    const workerDb = new PrismaClient({
      datasources: { db: { url: workerUrl ?? "" } },
    });
    let aiCredentialId = "";

    const asWorker = <T>(fn: (tx: ContextTransaction) => Promise<T>) =>
      workerDb.$transaction(fn, { timeout: 60_000, maxWait: 30_000 });

    /** The worker's session, from the web's client (app_runtime). */
    const session = (jobRunId: string, ctx: RequestContext): JobSession => ({
      jobRunId,
      transaction: <T>(op: (tx: ContextTransaction) => Promise<T>) =>
        withContext(prisma, ctx, op),
    });

    /** The run of an event, marked running as the worker does. */
    async function runOf(eventId: string): Promise<string> {
      const rows = await admin.$queryRaw<{ id: string }[]>`
        update public.job_runs set status = 'running', started_at = now()
        where kind = 'inbox.translate-message' and payload->>'eventId' = ${eventId}
        returning id
      `;
      if (!rows[0]) throw new Error(`no run for ${eventId}`);
      return rows[0].id;
    }

    const row = (eventId: string) =>
      admin.inboxMessageTranslation.findFirst({ where: { eventId } });

    async function cleanup() {
      await admin.$executeRawUnsafe(
        `delete from public.job_runs where kind = 'inbox.translate-message'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.matrix_events where room_id in ('${ROOM_A}', '${ROOM_B}')`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.matrix_as_transactions where txn_id = 'tr2-txn'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.matrix_rooms where room_id in ('${ROOM_A}', '${ROOM_B}')`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.credentials where label in ('${LABEL}', 'Google Translate')
           and workspace_id = '${ids.workspaceA}'`,
      );
    }

    beforeAll(async () => {
      // The Inbox module is on only with Matrix configured.
      for (const [key, value] of Object.entries(MATRIX_ENV)) {
        vi.stubEnv(key, value);
      }
      await cleanup();
      for (const [ws, org, user] of [
        [ids.workspaceA, ids.organizationA, ids.userA],
        [ids.workspaceB, ids.organizationB, ids.userB],
      ] as const) {
        await admin.$executeRawUnsafe(
          `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by, config)
           values ('${org}', '${ws}', 'inbox', 'enabled', '${user}', '{}')
           on conflict (workspace_id, module_key) do update
             set status = 'enabled', updated_by = '${user}', config = '{}'`,
        );
      }
      await admin.$executeRawUnsafe(
        `update public.workspaces set default_locale = null where id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
      );
      const sealed = encryptSecret("sk-proj-0123456789abcdef0123456789");
      aiCredentialId = (
        await admin.credential.create({
          data: {
            organizationId: ids.organizationA,
            workspaceId: ids.workspaceA,
            provider: "openai",
            purpose: "all",
            label: LABEL,
            maskedValue: sealed.maskedValue,
            encryptedPayload: sealed.encryptedPayload,
          },
        })
      ).id;
      for (const [id, roomId, ws, org] of [
        [
          "2e200000-0000-4000-8000-0000000000c1",
          ROOM_A,
          ids.workspaceA,
          ids.organizationA,
        ],
        [
          "2e200000-0000-4000-8000-0000000000c2",
          ROOM_B,
          ids.workspaceB,
          ids.organizationB,
        ],
      ] as const) {
        await admin.$executeRawUnsafe(
          `insert into public.matrix_rooms
             (id, organization_id, workspace_id, room_id, origin, state, status, consumer_mxid,
              contact_locale, contact_locale_source, contact_locale_confidence)
           values ('${id}', '${org}', '${ws}', '${roomId}', 'matrix', 'active', 'open', '${CONSUMER}',
                   'es', 'detected', 0.9)`,
        );
      }
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      await cleanup();
      await admin.$executeRawUnsafe(
        `update public.workspace_modules set config = '{}'
         where workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}') and module_key = 'inbox'`,
      );
      await Promise.all([
        prisma.$disconnect(),
        admin.$disconnect(),
        workerDb.$disconnect(),
      ]);
    });

    it("turns on only with an engine ready, and keeps no secret", async () => {
      await expect(
        withContext(prisma, contextA, (tx) =>
          saveTranslationSettings(tx, contextA, {
            enabled: true,
            primary: "google",
            fallback: null,
            ai: { credential_id: null, model: null },
            glossary: [],
          }),
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
      await expect(
        withContext(prisma, contextA, (tx) =>
          saveTranslationSettings(tx, contextA, {
            enabled: true,
            primary: null,
            fallback: null,
            ai: { credential_id: null, model: null },
            glossary: [],
          }),
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
      // A Google key in the vault, then AI as main and Google as fallback.
      const sealed = encryptSecret("AIzaSyTr2-0123456789abcdefghij");
      await admin.credential.create({
        data: {
          organizationId: ids.organizationA,
          workspaceId: ids.workspaceA,
          provider: "google_translate",
          purpose: "all",
          label: "Google Translate",
          maskedValue: sealed.maskedValue,
          encryptedPayload: sealed.encryptedPayload,
        },
      });
      await withContext(prisma, contextA, (tx) =>
        saveTranslationSettings(tx, contextA, {
          enabled: true,
          primary: "ai",
          fallback: "google",
          ai: { credential_id: aiCredentialId, model: "gpt-5-nano" },
          glossary: [{ term: "Geribá", translation: null }],
        }),
      );
      const stored = await admin.workspaceModule.findFirst({
        where: { workspaceId: ids.workspaceA, moduleKey: "inbox" },
        select: { config: true },
      });
      expect(stored?.config).toMatchObject({
        translation: {
          enabled: true,
          primary: "ai",
          fallback: "google",
          ai: { credential_id: aiCredentialId, model: "gpt-5-nano" },
        },
      });
      expect(JSON.stringify(stored?.config)).not.toContain("AIza");
    });

    it("enqueues the contact's and the GUIDS's messages in another language only", async () => {
      await admin.$executeRawUnsafe(
        `insert into public.matrix_as_transactions (txn_id, event_count, stored) values ('tr2-txn', 6, 6)`,
      );
      const locales: Record<string, string | null> = {
        "$tr2-es": "es",
        "$tr2-pt": "pt-BR",
        "$tr2-team": "es",
        "$tr2-agent": "es",
        "$tr2-fail": "es",
        "$tr2-short": null,
      };
      for (const said of SAID) {
        const locale = locales[said.id];
        await admin.matrixEvent.create({
          data: {
            eventId: said.id,
            txnId: "tr2-txn",
            roomId: ROOM_A,
            type: "m.room.message",
            sender: said.sender,
            originServerTs: BigInt(said.ts),
            content: locale
              ? { msgtype: "m.text", locale, locale_confidence: "0.9" }
              : { msgtype: "m.text" },
          },
        });
      }
      // The same message in B, where the translation is off.
      await admin.matrixEvent.create({
        data: {
          eventId: "$tr2-b",
          txnId: "tr2-txn",
          roomId: ROOM_B,
          type: "m.room.message",
          sender: CONSUMER,
          originServerTs: BigInt(1_000),
          content: { msgtype: "m.text", locale: "es", locale_confidence: "1" },
        },
      });
      const result = await asWorker((tx) => processPendingEvents(tx, client));
      expect(result.processed).toBe(7);
      const runs = await admin.jobRun.findMany({
        where: { kind: "inbox.translate-message" },
        select: { payload: true, requestedBy: true, workspaceId: true },
      });
      const events = runs
        .map((run) => (run.payload as { eventId: string }).eventId)
        .sort();
      // Not the Portuguese one (the team's), not the team's own, not B.
      expect(events).toEqual([
        "$tr2-agent",
        "$tr2-es",
        "$tr2-fail",
        "$tr2-short",
      ]);
      for (const run of runs) {
        expect(run.requestedBy).toBe(ids.userA);
        expect(run.workspaceId).toBe(ids.workspaceA);
        expect(Object.keys(run.payload as object).sort()).toEqual([
          "eventId",
          "roomId",
        ]);
      }
      expect((await row("$tr2-es"))?.status).toBe("pending");
    });

    it("writes the translation of the main engine", async () => {
      const seen: string[] = [];
      const jobRunId = await runOf("$tr2-es");
      const result = await runTranslateMessage(
        session(jobRunId, contextA),
        contextA,
        { roomId: ROOM_A, eventId: "$tr2-es" },
        {
          client,
          override: {
            ai: engine(
              "ai",
              "Olá, vocês têm quarto para duas pessoas esta noite?",
              seen,
            ),
            google: engine("google", "error"),
          },
        },
      );
      expect(result).toMatchObject({ status: "translated", engine: "ai" });
      expect(seen).toEqual([SAID[0]!.body]);
      expect(await row("$tr2-es")).toMatchObject({
        status: "done",
        sourceLocale: "es",
        targetLocale: "pt-BR",
        translatedText: "Olá, vocês têm quarto para duas pessoas esta noite?",
        engine: "ai",
        model: "gpt-5-nano",
        fallback: false,
        primaryError: null,
      });
    });

    it("marks the fallback (a GUIDS answer)", async () => {
      const jobRunId = await runOf("$tr2-agent");
      await runTranslateMessage(
        session(jobRunId, contextA),
        contextA,
        { roomId: ROOM_A, eventId: "$tr2-agent" },
        {
          client,
          override: {
            ai: engine("ai", "quota"),
            google: engine("google", "Claro! O café da manhã está incluído."),
          },
        },
      );
      expect(await row("$tr2-agent")).toMatchObject({
        status: "done",
        engine: "google",
        model: null,
        fallback: true,
        primaryError: "quota",
        translatedText: "Claro! O café da manhã está incluído.",
      });
    });

    it("records failed after three attempts with both engines failing", async () => {
      const jobRunId = await runOf("$tr2-fail");
      const deps = {
        client,
        override: {
          ai: engine("ai", "key"),
          google: engine("google", "error"),
        },
      };
      const run = () =>
        runTranslateMessage(
          session(jobRunId, contextA),
          contextA,
          { roomId: ROOM_A, eventId: "$tr2-fail" },
          deps,
        );
      await expect(run()).rejects.toThrow(/nova tentativa/);
      expect(await row("$tr2-fail")).toMatchObject({
        status: "failed",
        attempts: 1,
        primaryError: "key",
        translatedText: null,
      });
      await expect(run()).rejects.toThrow();
      expect(await run()).toMatchObject({ status: "failed", attempts: 3 });
      expect((await row("$tr2-fail"))?.status).toBe("failed");
    });

    it("does not translate a short message", async () => {
      const jobRunId = await runOf("$tr2-short");
      const seen: string[] = [];
      const result = await runTranslateMessage(
        session(jobRunId, contextA),
        contextA,
        { roomId: ROOM_A, eventId: "$tr2-short" },
        { client, override: { ai: engine("ai", "x", seen) } },
      );
      expect(result).toEqual({ status: "short" });
      expect(seen).toEqual([]);
      expect(await row("$tr2-short")).toBeNull();
    });

    it("keeps each workspace's translations to itself", async () => {
      const eventIds = ["$tr2-es", "$tr2-agent", "$tr2-fail"];
      const inA = await withContext(prisma, contextA, (tx) =>
        loadMessageTranslations(tx, contextA, { roomId: ROOM_A, eventIds }),
      );
      expect(
        inA.map((t) => [t.eventId, t.status, t.engine, t.fallback]).sort(),
      ).toEqual([
        ["$tr2-agent", "done", "google", true],
        ["$tr2-es", "done", "ai", false],
        ["$tr2-fail", "failed", null, false],
      ]);
      const inB = await withContext(prisma, contextB, (tx) =>
        tx.inboxMessageTranslation.findMany({ where: { roomId: ROOM_A } }),
      );
      expect(inB).toEqual([]);
      // The web cannot record a translation, even with a running run.
      const jobRunId = (
        await admin.jobRun.findFirstOrThrow({
          where: {
            kind: "inbox.translate-message",
            payload: { path: ["eventId"], equals: "$tr2-es" },
          },
        })
      ).id;
      await expect(
        withContext(
          prisma,
          contextB,
          (tx) =>
            tx.$queryRaw`select private.inbox_translation_record(
              ${jobRunId}::uuid, ${"$tr2-es"}::text, 'done', 'es', 'falso', 'ai', null, false, null)`,
        ),
      ).rejects.toThrow();
    });

    it("deletes the translations with the room", async () => {
      expect(
        await admin.inboxMessageTranslation.count({
          where: { roomId: ROOM_A },
        }),
      ).toBeGreaterThan(0);
      await admin.$executeRawUnsafe(
        `delete from public.matrix_rooms where room_id = '${ROOM_A}'`,
      );
      expect(
        await admin.inboxMessageTranslation.count({
          where: { roomId: ROOM_A },
        }),
      ).toBe(0);
    });
  },
);
