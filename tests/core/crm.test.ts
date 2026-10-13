import { randomBytes, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { API_ROUTES } from "@/core/api/contracts";
import * as crm from "@/core/api/crm";
import { type ApiCall, type ApiDeps, handleApiRoute } from "@/core/api/handler";
import { API_KEY_PREFIX, hashApiKey } from "@/core/credentials/api-keys";
import { handleMcpWorkspaceRequest } from "@/core/mcp/server";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { withContext } from "@/lib/prisma/with-context";
import {
  createContact,
  getContact,
  listContacts,
  updateContact,
} from "@/modules/crm/server";
import { AppError } from "@/shared/errors";

import { contextA, contextB, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const viewerCtx = { ...contextA, userId: ids.userMultiOrg };

describeDatabase("F4c: CRM module — contacts", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  let sessionUser: string | null = null;
  const deps: ApiDeps = {
    prisma,
    redis: null,
    session: async () => {
      if (!sessionUser) throw new Error("no session");
      return { userId: sessionUser, mfaSatisfied: true };
    },
  };
  const keys: string[] = [];

  async function createKey(scopes: string[], user: string = ids.userA) {
    const raw = `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
    const id = randomUUID();
    await admin.$executeRawUnsafe(
      `insert into public.api_keys
         (id, organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, expires_at)
       values ('${id}', '${ids.organizationA}', '${ids.workspaceA}', '${user}', 'F4c',
               '${raw.slice(0, 16)}', '${hashApiKey(raw)}', $1::text[], now() + interval '1 day')`,
      scopes,
    );
    keys.push(id);
    return raw;
  }

  type Route = keyof typeof API_ROUTES;
  const RUN: Partial<
    Record<Route, (p: PrismaClient, c: ApiCall) => Promise<unknown>>
  > = {
    listCrmContacts: crm.listCrmContacts,
    createCrmContact: crm.createCrmContact,
    getCrmContact: crm.getCrmContact,
    updateCrmContact: crm.updateCrmContact,
  };

  async function rest(
    route: Route,
    options: Readonly<{
      key?: string;
      body?: unknown;
      contactId?: string;
      query?: string;
      contentType?: string;
      origin?: string;
    }> = {},
  ) {
    const def = API_ROUTES[route];
    const headers = new Headers({ host: "localhost:3000" });
    if (options.key) headers.set("authorization", `Bearer ${options.key}`);
    if (options.origin) headers.set("origin", options.origin);
    if (options.body !== undefined) {
      headers.set("content-type", options.contentType ?? "application/json");
    }
    const path = def.path
      .replace("{id}", ids.workspaceA)
      .replace("{contactId}", options.contactId ?? "");
    const request = new Request(
      `http://localhost:3000/api/v1${path}${options.query ?? ""}`,
      {
        method: def.method,
        headers,
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
      },
    );
    const response = await handleApiRoute(
      request,
      def,
      { id: ids.workspaceA, contactId: options.contactId },
      deps,
      (call) => RUN[route]!(prisma, call),
    );
    return { status: response.status, body: await response.json() };
  }

  async function mcpTools(key: string): Promise<string[]> {
    const response = await handleMcpWorkspaceRequest(
      new Request("http://localhost:3000/mcp/workspace", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      }),
      deps,
    );
    const body = (await response.json()) as {
      result: { tools: { name: string }[] };
    };
    return body.result.tools.map((t) => t.name);
  }

  async function setModule(
    workspace: string,
    organization: string,
    user: string,
    status: string,
  ) {
    await admin.$executeRawUnsafe(
      `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
       values ('${organization}', '${workspace}', 'crm', '${status}', '${user}')
       on conflict (workspace_id, module_key) do update set status = excluded.status`,
    );
  }

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.crm_contacts where workspace_id in ('${ids.workspaceA}', '${ids.workspaceB}')`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.workspace_modules where module_key = 'crm'`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await setModule(ids.workspaceA, ids.organizationA, ids.userA, "enabled");
  });

  afterAll(async () => {
    await cleanup();
    if (keys.length) {
      await admin.$executeRawUnsafe(
        `delete from public.api_keys where id in (${keys.map((k) => `'${k}'`).join(",")})`,
      );
    }
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("creates, edits, finds and lists contacts through the services", async () => {
    const created = await withContext(prisma, contextA, (tx) =>
      createContact(tx, contextA, {
        name: "  Maria Souza ",
        email: "MARIA@Cliente.test",
        phone: "",
        companyName: "Cliente Ltda",
      }),
    );
    expect(created).toMatchObject({
      name: "Maria Souza",
      email: "maria@cliente.test",
      phone: null,
      companyName: "Cliente Ltda",
      createdBy: ids.userA,
    });
    const updated = await withContext(prisma, contextA, (tx) =>
      updateContact(tx, contextA, created.id, { jobTitle: "Compras" }),
    );
    expect(updated).toMatchObject({
      jobTitle: "Compras",
      companyName: "Cliente Ltda",
    });

    await withContext(prisma, contextA, (tx) =>
      createContact(tx, contextA, { name: "João Lima" }),
    );
    const found = await withContext(prisma, contextA, (tx) =>
      listContacts(tx, contextA, { search: "cliente" }),
    );
    expect(found.items.map((c) => c.name)).toEqual(["Maria Souza"]);
    const firstPage = await withContext(prisma, contextA, (tx) =>
      listContacts(tx, contextA, { limit: 1 }),
    );
    expect(firstPage.items).toHaveLength(1);
    const secondPage = await withContext(prisma, contextA, (tx) =>
      listContacts(tx, contextA, {
        limit: 1,
        cursor: firstPage.nextCursor ?? undefined,
      }),
    );
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);

    await expect(
      withContext(prisma, contextA, (tx) =>
        createContact(tx, contextA, { name: "X", email: "nope" }),
      ),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      withContext(prisma, contextA, (tx) =>
        createContact(tx, contextA, { name: "" }),
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("lets the viewer read but not write", async () => {
    const list = await withContext(prisma, viewerCtx, (tx) =>
      listContacts(tx, viewerCtx),
    );
    expect(list.items.length).toBeGreaterThan(0);
    await expect(
      withContext(prisma, viewerCtx, (tx) =>
        createContact(tx, viewerCtx, { name: "Viewer" }),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("blocks screens, API and MCP while the module is not enabled (AC08)", async () => {
    await expect(
      withContext(prisma, contextB, (tx) => listContacts(tx, contextB)),
    ).rejects.toThrow();
    const key = await createKey(["crm:read"]);
    expect(await mcpTools(key)).toEqual(
      expect.arrayContaining(["list_contacts", "get_contact"]),
    );
    await setModule(ids.workspaceA, ids.organizationA, ids.userA, "disabled");
    try {
      expect((await rest("listCrmContacts", { key })).status).toBe(503);
      expect(await mcpTools(key)).not.toContain("list_contacts");
    } finally {
      await setModule(ids.workspaceA, ids.organizationA, ids.userA, "enabled");
    }
  });

  it("serves contacts on the REST API with the crm scopes", async () => {
    const writer = await createKey(["crm:read", "crm:write"]);
    const created = await rest("createCrmContact", {
      key: writer,
      body: { name: "Ana API", email: "ana@api.test" },
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const patched = await rest("updateCrmContact", {
      key: writer,
      contactId: id,
      body: { phone: "11988887777" },
    });
    expect(patched.body.data).toMatchObject({
      name: "Ana API",
      phone: "11988887777",
    });
    expect(
      (await rest("getCrmContact", { key: writer, contactId: id })).body.data
        .id,
    ).toBe(id);
    const list = await rest("listCrmContacts", {
      key: writer,
      query: "?search=api",
    });
    expect(list.body.data.map((c: { id: string }) => c.id)).toContain(id);

    expect(
      (
        await rest("updateCrmContact", {
          key: writer,
          contactId: id,
          body: { foo: 1 },
        })
      ).status,
    ).toBe(422);
    expect(
      (await rest("getCrmContact", { key: writer, contactId: randomUUID() }))
        .status,
    ).toBe(404);

    const reader = await createKey(["crm:read"]);
    expect(
      (await rest("createCrmContact", { key: reader, body: { name: "Não" } }))
        .status,
    ).toBe(403);
    // A viewer's key with write scope is refused as a whole.
    const viewerWriter = await createKey(
      ["crm:read", "crm:write"],
      ids.userMultiOrg,
    );
    expect((await rest("listCrmContacts", { key: viewerWriter })).status).toBe(
      401,
    );
  });

  it("accepts session writes only as JSON from the same site (CSRF)", async () => {
    sessionUser = ids.userA;
    try {
      const form = await rest("createCrmContact", {
        body: { name: "Formulário" },
        contentType: "application/x-www-form-urlencoded",
        origin: "http://localhost:3000",
      });
      expect(form.status).toBe(403);
      const crossSite = await rest("createCrmContact", {
        body: { name: "Outro site" },
        origin: "https://atacante.test",
      });
      expect(crossSite.status).toBe(403);
      // Browsers always send Origin on a write, so its absence is refused.
      const noOrigin = await rest("createCrmContact", {
        body: { name: "Sem origem" },
      });
      expect(noOrigin.status).toBe(403);
      const json = await rest("createCrmContact", {
        body: { name: "Sessão JSON" },
        origin: "http://localhost:3000",
      });
      expect(json.status).toBe(201);
    } finally {
      sessionUser = null;
    }
  });

  it("finds no contact of another workspace", async () => {
    const other = randomUUID();
    await setModule(ids.workspaceB, ids.organizationB, ids.userB, "enabled");
    await admin.$executeRawUnsafe(
      `insert into public.crm_contacts (id, organization_id, workspace_id, name, created_by)
       values ('${other}', '${ids.organizationB}', '${ids.workspaceB}', 'De B', '${ids.userB}')`,
    );
    await expect(
      withContext(prisma, contextA, (tx) => getContact(tx, contextA, other)),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      withContext(prisma, contextA, (tx) =>
        updateContact(tx, contextA, other, { name: "Hack" }),
      ),
    ).rejects.toBeInstanceOf(AppError);
  });
});
