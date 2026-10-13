import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getPartnerAssistant,
  updatePartnerAssistant,
} from "@/core/ai/assistant-config";
import { registerPartnerCredential } from "@/core/ai/keys";
import {
  ConfigValidationError,
  createTemplate,
  listTemplates,
  updateTemplate,
} from "@/core/ai/templates";
import { PermissionDeniedError } from "@/core/permissions/guard";
import type { PartnerRoleKey } from "@/core/permissions/matrix";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { ids } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

/**
 * A3b: the partner's GUIDU Assistant, admin keys and GUIDS templates in
 * `/admin`. The Assistant is born with the prompt of the admin template
 * (migration of the A3b); the partner changes name, instructions and model
 * with a key of its vault; another partner sees nothing of it.
 */

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.ADMIN_URL;
const requiredVars = { DATABASE_URL: databaseUrl, ADMIN_URL: adminUrl };

const PARTNER = "b3b00000-0000-4000-8000-000000000001";
const OTHER = "b3b00000-0000-4000-8000-000000000002";
const SECRET = "sk-or-v1-0123456789abcdef0123456789";

describeDatabase("A3b: partner console AI", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "" } },
  });
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl ?? "" } },
  });

  const actorOf = (
    userId: string,
    partnerId: string,
    partnerRole: PartnerRoleKey,
  ) => ({ userId, partnerId, partnerRole });
  const owner = actorOf(ids.userA, PARTNER, "partner_owner");
  const support = actorOf(ids.userB, PARTNER, "partner_support");
  const otherOwner = actorOf(ids.userB, OTHER, "partner_owner");

  const inPartner = <T>(
    actor: { userId: string; partnerId: string },
    op: (tx: ContextTransaction) => Promise<T>,
  ) =>
    withIdentityContext(prisma, actor.userId, op, {
      partnerId: actor.partnerId,
    });

  async function cleanup() {
    await admin.$executeRawUnsafe(
      `delete from public.partners where id in ('${PARTNER}', '${OTHER}')`,
    );
  }

  beforeAll(async () => {
    await cleanup();
    await admin.$executeRawUnsafe(
      `insert into public.partners (id, slug, name) values
         ('${PARTNER}', 'agencia-a3b', 'Agência A3b'),
         ('${OTHER}', 'outra-a3b', 'Outra A3b')`,
    );
    await admin.$executeRawUnsafe(
      `insert into public.partner_members (partner_id, user_id, email, role) values
         ('${PARTNER}', '${ids.userA}', 'owner@a3b.test', 'partner_owner'),
         ('${PARTNER}', '${ids.userB}', 'support@a3b.test', 'partner_support'),
         ('${OTHER}', '${ids.userB}', 'owner@outra-a3b.test', 'partner_owner')`,
    );
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await admin.$disconnect();
  });

  it("creates the Assistant with the prompt of the admin template", async () => {
    const assistant = await inPartner(support, (tx) =>
      getPartnerAssistant(tx, support),
    );
    expect(assistant.status).toBe("draft");
    expect(assistant.config.overview.agent_name).toBe("Assistente Agência A3b");
    expect(assistant.config.overview.system_prompt).toContain("{{agent_name}}");
    expect(assistant.missing).toEqual([
      "model.credential_id",
      "model.model_name",
    ]);
    // The Assistants created before the A3b got the same prompt.
    const empty = await admin.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) as count from public.ai_agents
       where kind = 'assistant'
         and btrim(coalesce(config #>> '{overview,system_prompt}', '')) = ''`,
    );
    expect(Number(empty[0]?.count)).toBe(0);
  });

  it("lets the owner set the model with a key of its vault and turn it on", async () => {
    const key = await inPartner(owner, (tx) =>
      registerPartnerCredential(tx, owner, PARTNER, {
        provider: "openrouter",
        label: "Chave A3b",
        secret: SECRET,
      }),
    );
    const before = await inPartner(owner, (tx) =>
      getPartnerAssistant(tx, owner),
    );

    // Turning it on without a model is refused, field by field.
    const incomplete = await inPartner(owner, (tx) =>
      updatePartnerAssistant(tx, owner, {
        status: "active",
        config: before.config,
      }),
    ).catch((err: unknown) => err);
    expect(incomplete).toBeInstanceOf(ConfigValidationError);
    expect(
      Object.keys((incomplete as ConfigValidationError).fieldErrors),
    ).toEqual(["model.credential_id", "model.model_name"]);

    const saved = await inPartner(owner, (tx) =>
      updatePartnerAssistant(tx, owner, {
        status: "active",
        config: {
          ...before.config,
          overview: { ...before.config.overview, agent_name: "Ajudante" },
          // The tools are the template's: an unchanged copy is accepted.
          model: {
            credential_id: key.id,
            model_provider: "openai",
            model_name: "openai/gpt-4o-mini",
          },
        },
      }),
    );
    expect(saved.status).toBe("active");
    expect(saved.missing).toEqual([]);
    // The provider follows the key, not the submission.
    expect(saved.config.model.model_provider).toBe("openrouter");
    expect(saved.config.overview.agent_name).toBe("Ajudante");
    expect(saved.config.integration.tools).toEqual(
      before.config.integration.tools,
    );

    const row = await admin.aiAgent.findUniqueOrThrow({
      where: { id: saved.id },
    });
    expect(row.updatedBy).toBe(ids.userA);
    expect(row.updatedByPartnerId).toBe(PARTNER);
    const audit = await admin.auditEvent.findFirst({
      where: { action: "ai.assistant.update", resourceId: saved.id },
    });
    expect(audit?.metadata).toMatchObject({
      from: { status: "draft" },
      to: { status: "active" },
    });

    // Tools are not the partner's to change here.
    const tools = await inPartner(owner, (tx) =>
      updatePartnerAssistant(tx, owner, {
        status: "active",
        config: {
          ...saved.config,
          integration: { tools: ["think"] },
        },
      }),
    ).catch((err: unknown) => err);
    expect(tools).toBeInstanceOf(ConfigValidationError);
    expect(
      (tools as ConfigValidationError).fieldErrors["integration.tools"],
    ).toBeDefined();
  });

  it("refuses a key of another partner and changes by support", async () => {
    const foreign = await inPartner(otherOwner, (tx) =>
      registerPartnerCredential(tx, otherOwner, OTHER, {
        provider: "openrouter",
        label: "Chave da outra",
        secret: SECRET,
      }),
    );
    const current = await inPartner(owner, (tx) =>
      getPartnerAssistant(tx, owner),
    );
    const error = await inPartner(owner, (tx) =>
      updatePartnerAssistant(tx, owner, {
        status: "active",
        config: {
          ...current.config,
          model: { ...current.config.model, credential_id: foreign.id },
        },
      }),
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ConfigValidationError);

    await expect(
      inPartner(support, (tx) =>
        updatePartnerAssistant(tx, support, {
          status: "paused",
          config: current.config,
        }),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("keeps each partner's templates to itself", async () => {
    const created = await inPartner(owner, (tx) =>
      createTemplate(tx, owner, { name: "Modelo A3b" }),
    );
    const saved = await inPartner(owner, (tx) =>
      updateTemplate(tx, owner, created.id, {
        name: "Modelo A3b",
        description: "",
        segment: "Clínicas",
        published: true,
        config: { overview: { agent_name: "Clara" } },
      }),
    );
    expect(saved).toMatchObject({ published: true, version: 2 });
    const row = await admin.aiAgentTemplate.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.partnerId).toBe(PARTNER);

    const mine = await inPartner(owner, (tx) => listTemplates(tx, owner));
    expect(mine.map((t) => t.id)).toEqual([created.id]);
    const theirs = await inPartner(otherOwner, (tx) =>
      listTemplates(tx, otherOwner),
    );
    expect(theirs).toEqual([]);
    await expect(
      inPartner(support, (tx) => listTemplates(tx, support)),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
