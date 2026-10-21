import { generateKeyPairSync } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { encryptSecret } from "@/core/credentials/crypto";
import { matrixConfig } from "@/core/matrix/config";
import type { SynapseClient } from "@/core/matrix/synapse";
import {
  TranslationError,
  type TranslationErrorCode,
  type TranslateInput,
  type Translator,
} from "@/core/translation/types";
import { withContext } from "@/lib/prisma/with-context";
import {
  type OutboundRecordInput,
  previewOutboundTranslation,
  recordOutboundTranslation,
} from "@/modules/inbox/server/outbound-translation";
import { loadMessageTranslations } from "@/modules/inbox/server/translation";

import { contextA, contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * TR3 against the local database (no Synapse: the client is a double that
 * serves the events of the room). The preview of the team's answer
 * translates with the engines of the TR2 and writes nothing (no row, no job,
 * no request to Synapse); after the browser sent the message, the server
 * reads the event as the core and records the `outbound` row only for the
 * sender's own message with the body that was sent; who only reads neither
 * previews nor records; each workspace sees only its own rows and deleting
 * the room deletes them.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const MATRIX_ENV = {
  MATRIX_HOMESERVER_URL: "https://hs.tr3.test",
  MATRIX_SERVER_NAME: "hs.tr3.test",
  MATRIX_AS_TOKEN: "as-token",
  MATRIX_HS_TOKEN: "hs-token",
  MATRIX_JWT_PRIVATE_KEY: privateKey,
};
const config = matrixConfig(MATRIX_ENV)!;

const ANA = "3a3a0000-0000-4000-8000-0000000000f7";
const BIA = "3a3a0000-0000-4000-8000-0000000000f8";
const ANA_MXID = "@u_aaaaaaaaaaaaaaaaaaaaaaaa:hs.tr3.test";
const BIA_MXID = "@u_bbbbbbbbbbbbbbbbbbbbbbbb:hs.tr3.test";
const CONSUMER = "@cliente-tr3:hs.tr3.test";
const ROOM_ES = "!tr3-es:hs.tr3.test";
const ROOM_NONE = "!tr3-none:hs.tr3.test";
const ROOM_B = "!tr3-b:hs.tr3.test";
const LABEL = "Chave TR3";

const ctxOf = (userId: string) => ({ ...contextA, userId });

const WRITTEN = "Temos quarto disponível para duas pessoas esta noite.";
const SENT = "Tenemos una habitación disponible para dos personas esta noche.";

type Event = {
  sender: string;
  body: string;
  msgtype?: string;
  type?: string;
  /** Milliseconds ago; a fresh event by default. */
  ageMs?: number;
};
const EVENTS = new Map<string, Event>();
const requests: string[] = [];

/** The core's client: serves the events of the rooms. */
const client: SynapseClient = {
  config,
  async request<T>(method: string, path: string) {
    requests.push(`${method} ${path}`);
    const match = /\/rooms\/[^/]+\/event\/(.+)$/.exec(path);
    const event = match?.[1] ? EVENTS.get(decodeURIComponent(match[1])) : null;
    if (method !== "GET" || !event) throw new Error("not found");
    return {
      type: event.type ?? "m.room.message",
      sender: event.sender,
      origin_server_ts: Date.now() - (event.ageMs ?? 0),
      content: { msgtype: event.msgtype ?? "m.text", body: event.body },
    } as T;
  },
};

function engine(
  name: "ai" | "google",
  answer: string | TranslationErrorCode,
  seen: TranslateInput[] = [],
): Translator {
  return {
    engine: name,
    model: name === "ai" ? "gpt-5-nano" : null,
    async translate(input) {
      seen.push(input);
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
  "TR3: the team's answer with a translated preview",
  requiredVars,
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl ?? "" } },
    });
    const admin = new PrismaClient({
      datasources: { db: { url: adminUrl ?? "" } },
    });
    let aiCredentialId = "";

    const count = async (table: string) =>
      Number(
        (
          await admin.$queryRawUnsafe<{ n: bigint }[]>(
            `select count(*) as n from public.${table}`,
          )
        )[0]?.n ?? 0,
      );

    async function cleanup() {
      await admin.$executeRawUnsafe(
        `delete from public.matrix_rooms where room_id in ('${ROOM_ES}', '${ROOM_NONE}', '${ROOM_B}')`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.credentials where label in ('${LABEL}', 'Google Translate')
         and workspace_id = '${ids.workspaceA}'`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.matrix_accounts where profile_id in ('${ANA}', '${BIA}')`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.workspace_members where user_id in ('${ANA}', '${BIA}')`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.organization_members where user_id in ('${ANA}', '${BIA}')`,
      );
      await admin.$executeRawUnsafe(
        `delete from public.profiles where id in ('${ANA}', '${BIA}')`,
      );
      await admin.$executeRawUnsafe(
        `delete from auth.users where id in ('${ANA}', '${BIA}')`,
      );
    }

    const row = (eventId: string) =>
      admin.inboxMessageTranslation.findFirst({ where: { eventId } });

    const record = (
      userId: string,
      overrides: Partial<OutboundRecordInput> = {},
      ctx = ctxOf(userId),
    ) =>
      recordOutboundTranslation(
        prisma,
        ctx,
        {
          roomId: ROOM_ES,
          eventId: "$tr3-1",
          sourceText: WRITTEN,
          sentText: SENT,
          sourceLocale: "pt-BR",
          targetLocale: "es",
          engine: "ai",
          model: "gpt-5-nano",
          fallback: false,
          edited: false,
          ...overrides,
        },
        { client },
      );

    beforeAll(async () => {
      for (const [key, value] of Object.entries(MATRIX_ENV)) {
        vi.stubEnv(key, value);
      }
      await cleanup();
      for (const [id, name, mxid] of [
        [ANA, "Ana Atendente", ANA_MXID],
        [BIA, "Bia Atendente", BIA_MXID],
      ] as const) {
        await admin.$executeRawUnsafe(
          `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values ('${id}', '${id}@test.guidu.co', '', now(), '{}', '{}', now(), now())`,
        );
        await admin.$executeRawUnsafe(
          `insert into public.profiles (id, full_name, status) values ('${id}', '${name}', 'active')`,
        );
        await admin.$executeRawUnsafe(
          `insert into public.organization_members (organization_id, user_id, role, status)
         values ('${ids.organizationA}', '${id}', 'member', 'active')`,
        );
        await admin.$executeRawUnsafe(
          `insert into public.workspace_members (workspace_id, organization_id, user_id, role, status)
         values ('${ids.workspaceA}', '${ids.organizationA}', '${id}', 'attendant', 'active')`,
        );
        await admin.$executeRawUnsafe(
          `insert into public.matrix_accounts (profile_id, localpart, mxid, status)
         values ('${id}', '${mxid.slice(1, mxid.indexOf(":"))}', '${mxid}', 'active')`,
        );
      }
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
      const google = encryptSecret("AIzaSyTr3-0123456789abcdefghij");
      await admin.credential.create({
        data: {
          organizationId: ids.organizationA,
          workspaceId: ids.workspaceA,
          provider: "google_translate",
          purpose: "all",
          label: "Google Translate",
          maskedValue: google.maskedValue,
          encryptedPayload: google.encryptedPayload,
        },
      });
      const settings = JSON.stringify({
        translation: {
          enabled: true,
          primary: "ai",
          fallback: "google",
          ai: { credential_id: aiCredentialId, model: "gpt-5-nano" },
          glossary: [
            { term: "Geribá", translation: null },
            { term: "check-in", translation: "entrada" },
          ],
        },
      });
      await admin.$executeRawUnsafe(
        `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by, config)
       values ('${ids.organizationA}', '${ids.workspaceA}', 'inbox', 'enabled', '${ids.userA}', '${settings}')
       on conflict (workspace_id, module_key) do update
         set status = 'enabled', updated_by = '${ids.userA}', config = '${settings}'::jsonb`,
      );
      await admin.$executeRawUnsafe(
        `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by, config)
       values ('${ids.organizationB}', '${ids.workspaceB}', 'inbox', 'enabled', '${ids.userB}', '{}')
       on conflict (workspace_id, module_key) do update
         set status = 'enabled', updated_by = '${ids.userB}', config = '{}'`,
      );
      await admin.$executeRawUnsafe(
        `update public.workspaces set default_locale = null where id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
      );
      for (const [roomId, ws, org, locale] of [
        [ROOM_ES, ids.workspaceA, ids.organizationA, "es"],
        [ROOM_NONE, ids.workspaceA, ids.organizationA, null],
        [ROOM_B, ids.workspaceB, ids.organizationB, "es"],
      ] as const) {
        await admin.$executeRawUnsafe(
          `insert into public.matrix_rooms
           (organization_id, workspace_id, room_id, origin, state, status, consumer_mxid,
            contact_locale, contact_locale_source, contact_locale_confidence)
         values ('${org}', '${ws}', '${roomId}', 'matrix', 'active', 'open', '${CONSUMER}',
                 ${locale ? `'${locale}', 'detected', 0.9` : "null, null, null"})`,
        );
      }
      EVENTS.set("$tr3-1", { sender: ANA_MXID, body: SENT });
      EVENTS.set("$tr3-edited", {
        sender: ANA_MXID,
        body: `${SENT} ¡Gracias!`,
      });
      EVENTS.set("$tr3-other", { sender: BIA_MXID, body: SENT });
      EVENTS.set("$tr3-consumer", { sender: CONSUMER, body: SENT });
      EVENTS.set("$tr3-notice", {
        sender: ANA_MXID,
        body: SENT,
        msgtype: "m.notice",
      });
      EVENTS.set("$tr3-b", { sender: ANA_MXID, body: SENT });
      EVENTS.set("$tr3-old", {
        sender: ANA_MXID,
        body: SENT,
        ageMs: 10 * 60_000,
      });
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      await cleanup();
      await admin.$executeRawUnsafe(
        `update public.workspace_modules set config = '{}'
       where workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}') and module_key = 'inbox'`,
      );
      await Promise.all([prisma.$disconnect(), admin.$disconnect()]);
    });

    it("previews the translation and writes nothing: no row, no job, no request to Synapse", async () => {
      const rowsBefore = await count("inbox_message_translations");
      const jobsBefore = await count("job_runs");
      const outboundBefore = await count("matrix_outbound");
      const seen: TranslateInput[] = [];
      const preview = await previewOutboundTranslation(
        prisma,
        ctxOf(ANA),
        { roomId: ROOM_ES, text: `  ${WRITTEN}  ` },
        {
          override: {
            ai: engine("ai", SENT, seen),
            google: engine("google", "error"),
          },
        },
      );
      expect(preview).toEqual({
        kind: "preview",
        text: SENT,
        sourceLocale: "pt-BR",
        targetLocale: "es",
        engine: "ai",
        model: "gpt-5-nano",
        fallback: false,
      });
      // The text goes alone (no context) with the glossary the other way round.
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        text: WRITTEN,
        source: "pt-BR",
        target: "es",
        context: [],
        glossary: [
          { term: "Geribá", translation: null },
          { term: "entrada", translation: "check-in" },
        ],
      });
      expect(await count("inbox_message_translations")).toBe(rowsBefore);
      expect(await count("job_runs")).toBe(jobsBefore);
      expect(await count("matrix_outbound")).toBe(outboundBefore);
      expect(requests).toEqual([]);
    });

    it("goes to the fallback and marks it; with both failing it asks to try again", async () => {
      const rowsBefore = await count("inbox_message_translations");
      const viaGoogle = await previewOutboundTranslation(
        prisma,
        ctxOf(ANA),
        { roomId: ROOM_ES, text: WRITTEN },
        {
          override: {
            ai: engine("ai", "quota"),
            google: engine("google", "Tenemos una habitación."),
          },
        },
      );
      expect(viaGoogle).toMatchObject({
        kind: "preview",
        engine: "google",
        model: null,
        fallback: true,
      });
      const failed = await previewOutboundTranslation(
        prisma,
        ctxOf(ANA),
        { roomId: ROOM_ES, text: WRITTEN },
        {
          override: {
            ai: engine("ai", "key"),
            google: engine("google", "error"),
          },
        },
      );
      expect(failed).toEqual({
        kind: "unavailable",
        sourceLocale: "pt-BR",
        targetLocale: "es",
        code: "key",
      });
      expect(await count("inbox_message_translations")).toBe(rowsBefore);
    });

    it("sends direct (no preview) when there is nothing to translate", async () => {
      const override = {
        ai: engine("ai", "nunca"),
        google: engine("google", "nunca"),
      };
      // Already in the contact's language.
      expect(
        await previewOutboundTranslation(
          prisma,
          ctxOf(ANA),
          { roomId: ROOM_ES, text: SENT },
          { override },
        ),
      ).toEqual({ kind: "direct", reason: "already_in_contact_language" });
      // ...unless the ✦ asks for it.
      expect(
        await previewOutboundTranslation(
          prisma,
          ctxOf(ANA),
          { roomId: ROOM_ES, text: SENT, force: true },
          {
            override: {
              ai: engine("ai", SENT),
              google: engine("google", "error"),
            },
          },
        ),
      ).toMatchObject({ kind: "preview" });
      // The contact's language is not known.
      expect(
        await previewOutboundTranslation(
          prisma,
          ctxOf(ANA),
          { roomId: ROOM_NONE, text: WRITTEN },
          { override },
        ),
      ).toEqual({ kind: "direct", reason: "unknown_locale" });
      // The translation is off (B has no attendant: A's switch is turned off
      // and back on, whatever else is in the settings).
      const wsA = `workspace_id = '${ids.workspaceA}' and module_key = 'inbox'`;
      const setEnabled = (on: boolean) =>
        admin.$executeRawUnsafe(
          `update public.workspace_modules
             set config = jsonb_set(config, '{translation,enabled}', '${on}'::jsonb)
           where ${wsA}`,
        );
      await setEnabled(false);
      try {
        expect(
          await previewOutboundTranslation(
            prisma,
            ctxOf(ANA),
            { roomId: ROOM_ES, text: WRITTEN },
            { override },
          ),
        ).toMatchObject({ kind: "direct" });
      } finally {
        await setEnabled(true);
      }
    });

    it("refuses the preview to who only reads and to another workspace", async () => {
      const override = {
        ai: engine("ai", SENT),
        google: engine("google", SENT),
      };
      // The owner of A is not an attendant: level `read`.
      await expect(
        previewOutboundTranslation(
          prisma,
          contextA,
          { roomId: ROOM_ES, text: WRITTEN },
          { override },
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
      // The owner of B (no level either) asking about a room of A.
      await expect(
        previewOutboundTranslation(
          prisma,
          contextB,
          { roomId: ROOM_ES, text: WRITTEN },
          { override },
        ),
      ).rejects.toThrow();
      await expect(
        previewOutboundTranslation(
          prisma,
          ctxOf(ANA),
          { roomId: ROOM_ES, text: "   " },
          { override },
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
    });

    it("records the sending after reading the event on Synapse, with the original", async () => {
      expect(await record(ANA)).toEqual({ recorded: true });
      expect(requests.at(-1)).toContain("/event/%24tr3-1");
      expect(await row("$tr3-1")).toMatchObject({
        direction: "outbound",
        status: "done",
        roomId: ROOM_ES,
        workspaceId: ids.workspaceA,
        sourceText: WRITTEN,
        translatedText: SENT,
        sourceLocale: "pt-BR",
        targetLocale: "es",
        engine: "ai",
        model: "gpt-5-nano",
        fallback: false,
        edited: false,
      });
      // Once per event.
      expect(await record(ANA)).toEqual({ recorded: false });
      expect(
        await admin.inboxMessageTranslation.count({
          where: { eventId: "$tr3-1" },
        }),
      ).toBe(1);
      // An edited preview, sent through the fallback.
      expect(
        await record(ANA, {
          eventId: "$tr3-edited",
          sentText: `${SENT} ¡Gracias!`,
          engine: "google",
          model: null,
          fallback: true,
          edited: true,
        }),
      ).toEqual({ recorded: true });
      expect(await row("$tr3-edited")).toMatchObject({
        engine: "google",
        model: null,
        fallback: true,
        edited: true,
      });
      // An audit entry without the text.
      const audits = await admin.$queryRawUnsafe<{ metadata: unknown }[]>(
        `select metadata from public.audit_events where action = 'inbox.translation.outbound'
         and workspace_id = '${ids.workspaceA}'`,
      );
      expect(audits.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(audits)).not.toContain("quarto");
      expect(JSON.stringify(audits)).not.toContain("habitación");
    });

    it("refuses an event of another sender, with another body, another type or unknown", async () => {
      const before = await count("inbox_message_translations");
      // Bia's message, recorded as Ana's.
      await expect(
        record(ANA, { eventId: "$tr3-other" }),
      ).rejects.toMatchObject({
        code: "conflict",
      });
      // The consumer's message.
      await expect(
        record(ANA, { eventId: "$tr3-consumer" }),
      ).rejects.toMatchObject({ code: "conflict" });
      // A body other than the one declared.
      await expect(
        record(ANA, { eventId: "$tr3-other", sentText: "Otro texto." }),
      ).rejects.toMatchObject({ code: "conflict" });
      await expect(
        record(ANA, { eventId: "$tr3-notice" }),
      ).rejects.toMatchObject({ code: "conflict" });
      // An old event of her own: not the sending being recorded.
      await expect(
        record(ANA, { eventId: "$tr3-old" }),
      ).rejects.toMatchObject({ code: "conflict" });
      // An event Synapse does not know.
      await expect(
        record(ANA, { eventId: "$tr3-desconhecido" }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(await count("inbox_message_translations")).toBe(before);
    });

    it("refuses to record for who only reads and for a room of another workspace", async () => {
      // The owner of A reads only.
      await expect(
        record(ids.userA, { eventId: "$tr3-1" }, contextA),
      ).rejects.toMatchObject({ code: "forbidden" });
      // Ana is an attendant of A, not of B: the room of B is not hers.
      await expect(
        record(ANA, { roomId: ROOM_B, eventId: "$tr3-b" }),
      ).rejects.toThrow();
      expect(await row("$tr3-b")).toBeNull();
      // Someone with no Matrix account has no event to own.
      await admin.$executeRawUnsafe(
        `update public.matrix_accounts set status = 'deactivated', deactivated_at = now() where profile_id = '${BIA}'`,
      );
      await expect(
        record(BIA, { eventId: "$tr3-other" }),
      ).rejects.toMatchObject({
        code: "forbidden",
      });
      await admin.$executeRawUnsafe(
        `update public.matrix_accounts set status = 'active', deactivated_at = null where profile_id = '${BIA}'`,
      );
    });

    it("shows the team the original with how it was sent; B sees nothing", async () => {
      const inA = await withContext(prisma, ctxOf(BIA), (tx) =>
        loadMessageTranslations(tx, ctxOf(BIA), {
          roomId: ROOM_ES,
          eventIds: ["$tr3-1", "$tr3-edited"],
        }),
      );
      expect(
        inA.map((t) => [t.eventId, t.direction, t.original, t.text]).sort(),
      ).toEqual([
        ["$tr3-1", "outbound", WRITTEN, SENT],
        ["$tr3-edited", "outbound", WRITTEN, `${SENT} ¡Gracias!`],
      ]);
      expect(inA.find((t) => t.eventId === "$tr3-edited")).toMatchObject({
        targetLocale: "es",
        sourceLocale: "pt-BR",
        engine: "google",
        fallback: true,
        edited: true,
      });
      // The owner (reads only) reads them too.
      const owner = await withContext(prisma, contextA, (tx) =>
        loadMessageTranslations(tx, contextA, {
          roomId: ROOM_ES,
          eventIds: ["$tr3-1"],
        }),
      );
      expect(owner).toHaveLength(1);
      const inB = await withContext(prisma, contextB, (tx) =>
        tx.inboxMessageTranslation.findMany({ where: { roomId: ROOM_ES } }),
      );
      expect(inB).toEqual([]);
      // The web has no direct write on the table.
      await expect(
        withContext(prisma, ctxOf(ANA), (tx) =>
          tx.inboxMessageTranslation.update({
            where: {
              eventId_targetLocale: { eventId: "$tr3-1", targetLocale: "es" },
            },
            data: { sourceText: "falso" },
          }),
        ),
      ).rejects.toThrow();
    });

    it("deletes the outbound rows with the room", async () => {
      expect(
        await admin.inboxMessageTranslation.count({
          where: { roomId: ROOM_ES, direction: "outbound" },
        }),
      ).toBe(2);
      await admin.$executeRawUnsafe(
        `delete from public.matrix_rooms where room_id = '${ROOM_ES}'`,
      );
      expect(
        await admin.inboxMessageTranslation.count({
          where: { roomId: ROOM_ES },
        }),
      ).toBe(0);
    });
  },
);
