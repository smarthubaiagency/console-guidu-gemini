import { randomBytes, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ApiDeps } from "@/core/api/handler";
import { API_KEY_PREFIX, hashApiKey } from "@/core/credentials/api-keys";
import type { JobDefinition } from "@/core/jobs/definition";
import { handleMcpWorkspaceRequest } from "@/core/mcp/server";
import { PermissionDeniedError } from "@/core/permissions/guard";
import {
  approveProposal,
  createProposal,
  executeProposal,
  listProposals,
  proposalExecuteJob,
  rejectProposal,
} from "@/core/proposals/service";
import { withContext, type RequestContext } from "@/lib/prisma/with-context";
import { createContact, updateContact } from "@/modules/crm/server";
import { AppError } from "@/shared/errors";
import { createJobWorker } from "@/worker/runtime";

import { contextA, ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const workerUrl = process.env.WORKER_DATABASE_URL;
const requiredVars = {
  DATABASE_URL: databaseUrl,
  ADMIN_URL: adminUrl,
  WORKER_DATABASE_URL: workerUrl,
};

const owner: RequestContext = { ...contextA, principalType: "user" };
const viewer: RequestContext = { ...owner, userId: ids.userMultiOrg };
const mfa = { mfaVerified: true };

describeDatabase("F4d: proposals with human approval", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });
  const deps: ApiDeps = {
    prisma,
    redis: null,
    session: async () => {
      throw new Error("no session");
    },
  };
  let raw = "";
  let keyCtx: RequestContext;
  const run = `f4d-${Date.now().toString(36)}`;
  let seq = 0;
  const idem = () => `${run}-${++seq}`;

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.execution_proposals where workspace_id = '${ids.workspaceA}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.job_runs where kind = 'core.proposal-execute' and workspace_id = '${ids.workspaceA}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.crm_contacts where workspace_id = '${ids.workspaceA}'`,
    );
  }

  async function setModule(status: string) {
    await admin.$executeRawUnsafe(
      `insert into public.workspace_modules (organization_id, workspace_id, module_key, status, updated_by)
       values ('${ids.organizationA}', '${ids.workspaceA}', 'crm', '${status}', '${ids.userA}')
       on conflict (workspace_id, module_key) do update set status = excluded.status`,
    );
  }

  /** Changes a stored proposal behind the guard trigger (tests only). */
  async function tamper(id: string, set: string) {
    await admin.$transaction([
      admin.$executeRawUnsafe(
        "alter table public.execution_proposals disable trigger execution_proposals_guard_update",
      ),
      admin.$executeRawUnsafe(
        `update public.execution_proposals set ${set} where id = '${id}'`,
      ),
      admin.$executeRawUnsafe(
        "alter table public.execution_proposals enable trigger execution_proposals_guard_update",
      ),
    ]);
  }

  async function contactsNamed(name: string) {
    return admin.crmContact.count({
      where: { workspaceId: ids.workspaceA, name },
    });
  }

  async function propose(input: Record<string, unknown>) {
    return withContext(prisma, keyCtx, (tx) =>
      createProposal(tx, keyCtx, { idempotencyKey: idem(), ...input }),
    );
  }

  async function approve(id: string, hash: string) {
    return withContext(prisma, owner, (tx) =>
      approveProposal(tx, owner, id, { payloadHash: hash }, mfa),
    );
  }

  async function execute(id: string) {
    return withContext(prisma, owner, (tx) => executeProposal(tx, owner, id));
  }

  async function mcp(method: string, params: Record<string, unknown>) {
    const response = await handleMcpWorkspaceRequest(
      new Request("http://localhost:3000/mcp/workspace", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          authorization: `Bearer ${raw}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
      deps,
    );
    return (await response.json()) as {
      result: {
        tools?: { name: string; annotations?: { readOnlyHint?: boolean } }[];
        isError?: boolean;
        structuredContent?: Record<string, unknown>;
        content?: { text: string }[];
      };
    };
  }

  beforeAll(async () => {
    await cleanup();
    await setModule("enabled");
    raw = `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
    const keyId = randomUUID();
    await admin.$executeRawUnsafe(
      `insert into public.api_keys
         (id, organization_id, workspace_id, user_id, name, prefix, key_hash, scopes, expires_at)
       values ('${keyId}', '${ids.organizationA}', '${ids.workspaceA}', '${ids.userA}', 'F4d',
               '${raw.slice(0, 16)}', '${hashApiKey(raw)}',
               array['proposals:write', 'crm:read'], now() + interval '1 day')`,
    );
    keyCtx = { ...contextA, principalType: "api_key", grantId: keyId };
  });

  afterAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `delete from public.workspace_modules where module_key = 'crm' and workspace_id = '${ids.workspaceA}'`,
    );
    await admin.$executeRawUnsafe(
      `delete from public.api_keys where workspace_id = '${ids.workspaceA}' and name = 'F4d'`,
    );
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("proposes through the MCP without running anything, idempotently", async () => {
    const list = await mcp("tools/list", {});
    const tools = list.result.tools ?? [];
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["propose_operation", "get_proposal"]),
    );
    expect(
      tools.find((t) => t.name === "propose_operation")?.annotations
        ?.readOnlyHint,
    ).toBe(false);

    const args = {
      operation: "crm.contacts.create",
      payload: { name: "Ana Proposta", email: "ANA@Cliente.test" },
      idempotencyKey: `${run}-mcp`,
      reason: "Lead da conversa de hoje",
    };
    const first = await mcp("tools/call", {
      name: "propose_operation",
      arguments: args,
    });
    expect(first.result.isError).toBeFalsy();
    const created = first.result.structuredContent!;
    expect(created).toMatchObject({
      status: "pending",
      created: true,
      payload: { name: "Ana Proposta", email: "ana@cliente.test" },
    });
    expect(String(created.reviewUrl)).toBe(
      `http://localhost:3000/app/workspace-a/proposals/${created.proposalId}`,
    );
    expect(await contactsNamed("Ana Proposta")).toBe(0);

    const again = await mcp("tools/call", {
      name: "propose_operation",
      arguments: args,
    });
    expect(again.result.structuredContent).toMatchObject({
      proposalId: created.proposalId,
      created: false,
    });
    const other = await mcp("tools/call", {
      name: "propose_operation",
      arguments: { ...args, payload: { name: "Outra Pessoa" } },
    });
    expect(other.result.isError).toBe(true);
    expect(other.result.content?.[0]?.text).toContain("different content");

    const status = await mcp("tools/call", {
      name: "get_proposal",
      arguments: { proposalId: created.proposalId },
    });
    expect(status.result.structuredContent).toMatchObject({
      status: "pending",
    });
    // The workspace can only be the key's: a forged field is refused.
    const forged = await mcp("tools/call", {
      name: "propose_operation",
      arguments: { ...args, workspaceId: ids.workspaceB },
    });
    expect(forged.result.isError).toBe(true);
  });

  it("refuses invalid proposals and approvals made by a key, without MFA or by a viewer", async () => {
    await expect(
      propose({ operation: "crm.contacts.delete", payload: {} }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      propose({ operation: "crm.contacts.create", payload: { name: "" } }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      propose({
        operation: "crm.contacts.update",
        payload: { name: "Sem alvo" },
      }),
    ).rejects.toBeInstanceOf(AppError);
    // A session does not create proposals.
    await expect(
      withContext(prisma, owner, (tx) =>
        createProposal(tx, owner, {
          operation: "crm.contacts.create",
          payload: { name: "Tela" },
          idempotencyKey: idem(),
        }),
      ),
    ).rejects.toBeInstanceOf(AppError);

    const { proposal } = await propose({
      operation: "crm.contacts.create",
      payload: { name: "Bruno Aprovação" },
    });
    await expect(
      withContext(prisma, keyCtx, (tx) =>
        approveProposal(
          tx,
          keyCtx,
          proposal.id,
          { payloadHash: proposal.payloadHash },
          mfa,
        ),
      ),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      withContext(prisma, owner, (tx) =>
        approveProposal(
          tx,
          owner,
          proposal.id,
          { payloadHash: proposal.payloadHash },
          { mfaVerified: false },
        ),
      ),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      withContext(prisma, viewer, (tx) =>
        approveProposal(
          tx,
          viewer,
          proposal.id,
          { payloadHash: proposal.payloadHash },
          mfa,
        ),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      withContext(prisma, viewer, (tx) => listProposals(tx, viewer)),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    // The approval is bound to the hash shown.
    await expect(approve(proposal.id, "0".repeat(64))).rejects.toThrow(
      /não é o que estava na tela/,
    );

    const rejected = await withContext(prisma, owner, (tx) =>
      rejectProposal(tx, owner, proposal.id),
    );
    expect(rejected.status).toBe("rejected");
    await expect(approve(proposal.id, proposal.payloadHash)).rejects.toThrow(
      /já foi decidida/,
    );
    expect(await contactsNamed("Bruno Aprovação")).toBe(0);
  });

  it("executes an approved proposal once, through the worker (AC11)", async () => {
    const { proposal } = await propose({
      operation: "crm.contacts.create",
      payload: { name: "Carla Worker", companyName: "Cliente" },
    });
    const approved = await approve(proposal.id, proposal.payloadHash);
    expect(approved.status).toBe("approved");

    const worker = createJobWorker({
      databaseUrl: workerUrl ?? "",
      definitions: [
        proposalExecuteJob,
      ] as unknown as readonly JobDefinition<unknown>[],
      schedules: [],
      dispatchIntervalMs: 200,
      pollingIntervalSeconds: 0.5,
      instanceName: "f4d-test",
      log: () => {},
    });
    await worker.start();
    try {
      const deadline = Date.now() + 20_000;
      for (;;) {
        const row = await admin.executionProposal.findUniqueOrThrow({
          where: { id: proposal.id },
        });
        if (row.status !== "approved") {
          expect(row.status).toBe("executed");
          break;
        }
        if (Date.now() > deadline) throw new Error("timeout");
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    } finally {
      await worker.stop();
    }
    expect(await contactsNamed("Carla Worker")).toBe(1);

    // Running it again does nothing.
    const second = await execute(proposal.id);
    expect(second.status).toBe("executed");
    expect(await contactsNamed("Carla Worker")).toBe(1);
  });

  it("does not execute a changed or expired proposal (AC11)", async () => {
    const changed = await propose({
      operation: "crm.contacts.create",
      payload: { name: "Davi Original" },
    });
    await approve(changed.proposal.id, changed.proposal.payloadHash);
    await tamper(changed.proposal.id, `payload = '{"name":"Davi Trocado"}'`);
    expect(await execute(changed.proposal.id)).toMatchObject({
      status: "failed",
      error: "tampered",
    });
    expect(await contactsNamed("Davi Trocado")).toBe(0);
    expect(await contactsNamed("Davi Original")).toBe(0);

    const late = await propose({
      operation: "crm.contacts.create",
      payload: { name: "Eva Vencida" },
    });
    await approve(late.proposal.id, late.proposal.payloadHash);
    await tamper(late.proposal.id, "expires_at = now() - interval '1 minute'");
    expect(await execute(late.proposal.id)).toMatchObject({
      status: "failed",
      error: "expired",
    });
    expect(await contactsNamed("Eva Vencida")).toBe(0);

    // An expired pending proposal cannot be approved.
    const old = await propose({
      operation: "crm.contacts.create",
      payload: { name: "Fábio Antigo" },
    });
    await tamper(old.proposal.id, "expires_at = now() - interval '1 minute'");
    await expect(
      approve(old.proposal.id, old.proposal.payloadHash),
    ).rejects.toThrow(/venceu/);
  });

  it("edits a contact only on the version the person saw", async () => {
    const contact = await withContext(prisma, owner, (tx) =>
      createContact(tx, owner, { name: "Gabi Edição" }),
    );
    const edit = await propose({
      operation: "crm.contacts.update",
      targetId: contact.id,
      payload: { jobTitle: "Compras" },
    });
    // The record changes after the proposal: approval is refused.
    await withContext(prisma, owner, (tx) =>
      updateContact(tx, owner, contact.id, { phone: "11911112222" }),
    );
    await expect(
      approve(edit.proposal.id, edit.proposal.payloadHash),
    ).rejects.toThrow(/mudou depois da proposta/);

    const fresh = await propose({
      operation: "crm.contacts.update",
      targetId: contact.id,
      payload: { jobTitle: "Compras" },
    });
    await approve(fresh.proposal.id, fresh.proposal.payloadHash);
    // Changed between approval and execution: not executed.
    await withContext(prisma, owner, (tx) =>
      updateContact(tx, owner, contact.id, { notes: "mudou" }),
    );
    expect(await execute(fresh.proposal.id)).toMatchObject({
      status: "failed",
      error: "stale",
    });

    const last = await propose({
      operation: "crm.contacts.update",
      targetId: contact.id,
      payload: { jobTitle: "Diretoria" },
    });
    await approve(last.proposal.id, last.proposal.payloadHash);
    expect(await execute(last.proposal.id)).toMatchObject({
      status: "executed",
    });
    const row = await admin.crmContact.findUniqueOrThrow({
      where: { id: contact.id },
    });
    expect(row).toMatchObject({ jobTitle: "Diretoria", notes: "mudou" });
  });

  it("records the module refusal when the module is disabled after approval", async () => {
    const { proposal } = await propose({
      operation: "crm.contacts.create",
      payload: { name: "Hugo Desligado" },
    });
    await approve(proposal.id, proposal.payloadHash);
    await setModule("disabled");
    try {
      expect(await execute(proposal.id)).toMatchObject({
        status: "failed",
        error: "unavailable",
      });
      await expect(
        propose({
          operation: "crm.contacts.create",
          payload: { name: "Iris Desligado" },
        }),
      ).rejects.toThrow();
    } finally {
      await setModule("enabled");
    }
    expect(await contactsNamed("Hugo Desligado")).toBe(0);
  });
});
