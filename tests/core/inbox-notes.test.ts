import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withContext } from "@/lib/prisma/with-context";
import { loadInboxViewer } from "@/modules/inbox/server/access";
import {
  createNote,
  deleteNote,
  listNotes,
  updateNote,
} from "@/modules/inbox/server/notes";

import { contextA, contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * IN5a through the web's role (app_runtime): two Attendants of workspace A
 * write, edit and delete their own private notes; the owner of A (not an
 * attendant) only reads; B sees nothing of A. Every change is audited
 * without the text, and nothing leaves for Synapse (no request, no job, no
 * outbound row): a note never goes to the room.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const ANA = "1a5a0000-0000-4000-8000-0000000000f5";
const BRUNO = "1a5a0000-0000-4000-8000-0000000000f6";
const ROOM_A = "!in5a-notes-a:matrix.test";
const ROOM_B = "!in5a-notes-b:matrix.test";
const SECRET = "Cliente pediu desconto de 15% — segredo";

const ctx = (userId: string) => ({ ...contextA, userId });

describeDatabase("Inbox: private notes (IN5a)", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  let jobsBefore = 0;
  let outboundBefore = 0;

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.inbox_notes where room_id in ('${ROOM_A}', '${ROOM_B}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.matrix_rooms where room_id in ('${ROOM_A}', '${ROOM_B}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.workspace_members where user_id in ('${ANA}', '${BRUNO}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.organization_members where user_id in ('${ANA}', '${BRUNO}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.profiles where id in ('${ANA}', '${BRUNO}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from auth.users where id in ('${ANA}', '${BRUNO}')`,
    );
  }

  const count = async (table: string) =>
    Number(
      (
        await admin.$queryRawUnsafe<{ n: bigint }[]>(
          `select count(*) as n from public.${table}`,
        )
      )[0]?.n ?? 0,
    );

  beforeAll(async () => {
    await cleanup();
    for (const [id, name] of [
      [ANA, "Ana Atendente"],
      [BRUNO, "Bruno Atendente"],
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
    }
    await admin.$executeRawUnsafe(
      `insert into public.matrix_rooms (organization_id, workspace_id, room_id, origin, state)
       values ('${ids.organizationA}', '${ids.workspaceA}', '${ROOM_A}', 'matrix', 'active'),
              ('${ids.organizationB}', '${ids.workspaceB}', '${ROOM_B}', 'matrix', 'active')`,
    );
    jobsBefore = await count("job_runs");
    outboundBefore = await count("matrix_outbound");
    fetchSpy.mockClear();
  });

  afterEach(() => {
    // Nothing of a note goes to Synapse (nor anywhere else over HTTP).
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  afterAll(async () => {
    expect(await count("job_runs")).toBe(jobsBefore);
    expect(await count("matrix_outbound")).toBe(outboundBefore);
    fetchSpy.mockRestore();
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  /** Runs a service as a person of workspace A, with their viewer. */
  const as = <T>(
    userId: string,
    fn: (
      tx: Parameters<Parameters<typeof withContext>[2]>[0],
      viewer: Awaited<ReturnType<typeof loadInboxViewer>>,
    ) => Promise<T>,
  ) =>
    withContext(prisma, ctx(userId), async (tx) =>
      fn(tx, await loadInboxViewer(tx, userId)),
    );

  let noteId = "";

  it("an Attendant writes a note; the team reads it with the author", async () => {
    const note = await as(ANA, (tx, viewer) =>
      createNote(tx, ctx(ANA), viewer, { roomId: ROOM_A, body: SECRET }),
    );
    noteId = note.id;
    expect(note).toMatchObject({
      roomId: ROOM_A,
      authorName: "Ana Atendente",
      body: SECRET,
      mine: true,
      deleted: false,
      editedAt: null,
    });

    // The owner of A (not an attendant) reads it, not as theirs.
    const seen = await as(ids.userA, (tx, viewer) =>
      listNotes(tx, contextA, viewer, ROOM_A),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      id: noteId,
      authorName: "Ana Atendente",
      mine: false,
    });
  });

  it("who only reads writes no note", async () => {
    await expect(
      as(ids.userA, (tx, viewer) =>
        createNote(tx, contextA, viewer, { roomId: ROOM_A, body: "Do dono" }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("a note is 1 to 4000 characters, in a room of the workspace", async () => {
    await expect(
      as(ANA, (tx, viewer) =>
        createNote(tx, ctx(ANA), viewer, { roomId: ROOM_A, body: "   " }),
      ),
    ).rejects.toThrow();
    await expect(
      as(ANA, (tx, viewer) =>
        createNote(tx, ctx(ANA), viewer, {
          roomId: ROOM_A,
          body: "a".repeat(4001),
        }),
      ),
    ).rejects.toThrow();
    await expect(
      as(ANA, (tx, viewer) =>
        createNote(tx, ctx(ANA), viewer, { roomId: ROOM_B, body: "Em B" }),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("another Attendant cannot edit nor delete it", async () => {
    await expect(
      as(BRUNO, (tx, viewer) =>
        updateNote(tx, ctx(BRUNO), viewer, { noteId, body: "Do Bruno" }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      as(BRUNO, (tx, viewer) => deleteNote(tx, ctx(BRUNO), viewer, noteId)),
    ).rejects.toMatchObject({ code: "forbidden" });
    // Not even around the service: the database refuses the same.
    const changed = await withContext(prisma, ctx(BRUNO), (tx) =>
      tx.inboxNote.updateMany({
        where: { id: noteId },
        data: { body: "Por fora", editedAt: new Date() },
      }),
    );
    expect(changed.count).toBe(0);
  });

  it("the author edits it (marked as edited) and deletes it softly", async () => {
    const edited = await as(ANA, (tx, viewer) =>
      updateNote(tx, ctx(ANA), viewer, { noteId, body: "Texto corrigido" }),
    );
    expect(edited.body).toBe("Texto corrigido");
    expect(edited.editedAt).not.toBeNull();

    await as(ANA, (tx, viewer) => deleteNote(tx, ctx(ANA), viewer, noteId));
    const [deleted] = await as(BRUNO, (tx, viewer) =>
      listNotes(tx, ctx(BRUNO), viewer, ROOM_A),
    );
    expect(deleted).toMatchObject({ id: noteId, deleted: true, body: "" });
    const row = await admin.inboxNote.findUnique({ where: { id: noteId } });
    expect(row?.body).toBe("");
    expect(row?.deletedAt).toBeInstanceOf(Date);

    // A deleted note stays deleted.
    await expect(
      as(ANA, (tx, viewer) =>
        updateNote(tx, ctx(ANA), viewer, { noteId, body: "De volta" }),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("each change is audited, without the text", async () => {
    const events = await admin.$queryRawUnsafe<
      { action: string; actor_user_id: string; metadata: unknown }[]
    >(
      `select action, actor_user_id::text, metadata from public.audit_events
       where resource_type = 'inbox_note' and resource_id = '${noteId}'
       order by occurred_at`,
    );
    expect(events.map((event) => event.action)).toEqual([
      "inbox.note.create",
      "inbox.note.update",
      "inbox.note.delete",
    ]);
    const dump = JSON.stringify(events);
    expect(dump).not.toContain("segredo");
    expect(dump).not.toContain("corrigido");
    expect(events[0]?.metadata).toMatchObject({ target: ROOM_A });
    expect(new Set(events.map((event) => event.actor_user_id))).toEqual(
      new Set([ANA]),
    );
  });

  it("workspace B sees nothing of A", async () => {
    const fromB = await withContext(prisma, contextB, (tx) =>
      tx.inboxNote.findMany({ where: { roomId: ROOM_A } }),
    );
    expect(fromB).toEqual([]);
    const listed = await withContext(prisma, contextB, async (tx) =>
      listNotes(tx, contextB, await loadInboxViewer(tx, ids.userB), ROOM_A),
    );
    expect(listed).toEqual([]);
  });
});
