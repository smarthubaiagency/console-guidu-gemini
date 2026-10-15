import "server-only";

import { recordAudit } from "@/core/audit/record";
import {
  type BillingActor,
  canManagePlatformBilling,
  requireAllowed,
} from "@/core/billing/access";
import { stripeProvider } from "@/core/billing/providers/planned";
import type { ProviderCapabilities } from "@/core/billing/provider";
import { decryptSecret, encryptSecret } from "@/core/credentials/crypto";
import { adminAuditContext } from "@/core/module-runtime/settings";
import type { ContextTransaction } from "@/lib/prisma/with-context";
import { AppError } from "@/shared/errors";

import {
  checkSecretKey,
  checkWebhookSecret,
  type CredentialProblem,
  type GatewayMode,
  isGatewayMode,
  maskStripeSecret,
  processStripeEvent,
  secretKeyMode,
} from "./stripe";

/**
 * Cobrança › Gateway of the platform (CF7): Stripe Connect only. Read and
 * written by platform billing (owner and billing); RLS repeats the check.
 * Every change is audited (`platform.billing.gateway.*`), which is also the
 * history shown on the page. Credentials leave this module masked only.
 */

const PROVIDER = "stripe";

export type GatewayView = Readonly<{
  provider: "stripe";
  enabled: boolean;
  isDefault: boolean;
  mode: GatewayMode;
  secretKeyMasked: string | null;
  webhookSecretMasked: string | null;
  updatedAt: Date | null;
  capabilities: ProviderCapabilities;
}>;

function gatewayError(key: string, message: string): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    messageKey: `gateway.errors.${key}`,
  });
}

const CREDENTIAL_MESSAGES: Readonly<Record<CredentialProblem, string>> = {
  secretKeyFormat: "Informe uma chave secreta do Stripe (sk_ ou rk_).",
  secretKeyMode: "A chave secreta é de outro modo (teste ou produção).",
  webhookSecretFormat: "Informe o segredo de assinatura do webhook (whsec_).",
};

function credentialError(problem: CredentialProblem): AppError {
  return gatewayError(problem, CREDENTIAL_MESSAGES[problem]);
}

function requireManager(actor: BillingActor): void {
  requireAllowed(canManagePlatformBilling(actor));
}

type GatewayWrite = Readonly<{
  enabled?: boolean;
  isDefault?: boolean;
  mode?: GatewayMode;
  secretKeyMasked?: string;
  secretKeyEncrypted?: string;
  webhookSecretMasked?: string;
  webhookSecretEncrypted?: string;
  updatedBy: string;
}>;

/**
 * Update or create, never an upsert: Postgres checks the constraints of the
 * proposed insert (on needs both credentials) before seeing the conflict.
 */
async function writeGateway(
  tx: ContextTransaction,
  data: GatewayWrite,
): Promise<void> {
  const updated = await tx.paymentGateway.updateMany({
    where: { provider: PROVIDER },
    data,
  });
  if (updated.count === 0) {
    await tx.paymentGateway.create({ data: { provider: PROVIDER, ...data } });
  }
}

export async function getStripeGateway(
  tx: ContextTransaction,
  actor: BillingActor,
): Promise<GatewayView> {
  requireManager(actor);
  const row = await tx.paymentGateway.findUnique({
    where: { provider: PROVIDER },
    select: {
      enabled: true,
      isDefault: true,
      mode: true,
      secretKeyMasked: true,
      webhookSecretMasked: true,
      updatedAt: true,
    },
  });
  return {
    provider: PROVIDER,
    enabled: row?.enabled ?? false,
    isDefault: row?.isDefault ?? false,
    mode: isGatewayMode(row?.mode) ? row.mode : "test",
    secretKeyMasked: row?.secretKeyMasked ?? null,
    webhookSecretMasked: row?.webhookSecretMasked ?? null,
    updatedAt: row?.updatedAt ?? null,
    capabilities: stripeProvider.capabilities,
  };
}

export type GatewaySettingsInput = Readonly<{
  enabled: boolean;
  isDefault: boolean;
  mode: GatewayMode;
}>;

/**
 * On/off, default and mode. On needs both credentials; the default must be
 * on; the mode must match the saved secret key (`sk_test_` in test).
 */
export async function saveStripeSettings(
  tx: ContextTransaction,
  actor: BillingActor,
  input: GatewaySettingsInput,
): Promise<void> {
  requireManager(actor);
  const current = await getStripeGateway(tx, actor);
  if (
    input.enabled &&
    (!current.secretKeyMasked || !current.webhookSecretMasked)
  ) {
    throw gatewayError(
      "credentialsRequired",
      "Cadastre a chave secreta e o segredo do webhook antes de ligar.",
    );
  }
  if (input.isDefault && !input.enabled) {
    throw gatewayError(
      "defaultNeedsEnabled",
      "Só um gateway ligado pode ser o padrão.",
    );
  }
  const keyMode = secretKeyMode(current.secretKeyMasked);
  if (keyMode && keyMode !== input.mode) {
    throw credentialError("secretKeyMode");
  }
  const fields = (["enabled", "isDefault", "mode"] as const).filter(
    (field) => current[field] !== input[field],
  );
  if (fields.length === 0) return;
  await writeGateway(tx, { ...input, updatedBy: actor.userId });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "platform.billing.gateway.settings",
    resourceType: "payment_gateway",
    resourceId: PROVIDER,
    result: "success",
    origin: "admin",
    metadata: {
      provider: PROVIDER,
      fields: [...fields],
      mode: input.mode,
      status: input.enabled ? "enabled" : "disabled",
    },
  });
}

export type GatewayCredentialsInput = Readonly<{
  secretKey: string | null;
  webhookSecret: string | null;
}>;

/** Replaces one or both credentials; an empty field keeps the saved one. */
export async function saveStripeCredentials(
  tx: ContextTransaction,
  actor: BillingActor,
  input: GatewayCredentialsInput,
): Promise<void> {
  requireManager(actor);
  if (!input.secretKey && !input.webhookSecret) {
    throw gatewayError("nothingToSave", "Informe ao menos uma credencial.");
  }
  const current = await getStripeGateway(tx, actor);
  const data: {
    secretKeyMasked?: string;
    secretKeyEncrypted?: string;
    webhookSecretMasked?: string;
    webhookSecretEncrypted?: string;
  } = {};
  const fields: string[] = [];
  if (input.secretKey) {
    const problem = checkSecretKey(input.secretKey, current.mode);
    if (problem) throw credentialError(problem);
    data.secretKeyEncrypted = encryptSecret(input.secretKey).encryptedPayload;
    data.secretKeyMasked = maskStripeSecret(input.secretKey);
    fields.push("secretKey");
  }
  if (input.webhookSecret) {
    const problem = checkWebhookSecret(input.webhookSecret);
    if (problem) throw credentialError(problem);
    data.webhookSecretEncrypted = encryptSecret(
      input.webhookSecret,
    ).encryptedPayload;
    data.webhookSecretMasked = maskStripeSecret(input.webhookSecret);
    fields.push("webhookSecret");
  }
  await writeGateway(tx, { ...data, updatedBy: actor.userId });
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "platform.billing.gateway.credentials",
    resourceType: "payment_gateway",
    resourceId: PROVIDER,
    result: "success",
    origin: "admin",
    metadata: { provider: PROVIDER, fields, mode: current.mode },
  });
}

/** Signing secret and mode for "Enviar webhook de teste"; never shown. */
export async function loadTestWebhookSecret(
  tx: ContextTransaction,
  actor: BillingActor,
): Promise<Readonly<{ secret: string; mode: GatewayMode }>> {
  requireManager(actor);
  const row = await tx.paymentGateway.findUnique({
    where: { provider: PROVIDER },
    select: { enabled: true, mode: true, webhookSecretEncrypted: true },
  });
  if (!row?.enabled || !row.webhookSecretEncrypted) {
    throw gatewayError(
      "notEnabled",
      "Ligue o Stripe e cadastre o segredo do webhook antes do teste.",
    );
  }
  return {
    secret: decryptSecret(row.webhookSecretEncrypted),
    mode: isGatewayMode(row.mode) ? row.mode : "test",
  };
}

export async function auditTestWebhook(
  tx: ContextTransaction,
  actor: BillingActor,
  delivered: boolean,
): Promise<void> {
  requireManager(actor);
  await recordAudit(tx, adminAuditContext(actor.userId), {
    action: "platform.billing.gateway.test_webhook",
    resourceType: "payment_gateway",
    resourceId: PROVIDER,
    result: delivered ? "success" : "error",
    origin: "admin",
    metadata: {
      provider: PROVIDER,
      status: delivered ? "delivered" : "failed",
    },
  });
}

export type WebhookEventRow = Readonly<{
  id: string;
  eventId: string;
  eventType: string;
  livemode: boolean;
  isTest: boolean;
  status: string;
  attempts: number;
  lastError: string | null;
  receivedAt: Date;
  processingMs: number | null;
}>;

export type WebhookHealth = Readonly<{
  days: number;
  received: number;
  processed: number;
  failed: number;
  pending: number;
  lastReceivedAt: Date | null;
  averageMs: number | null;
  maxMs: number | null;
  recent: readonly WebhookEventRow[];
}>;

/** Deliveries of the last `days` days and the latest events. */
export async function webhookHealth(
  tx: ContextTransaction,
  actor: BillingActor,
  days = 7,
  now: Date = new Date(),
): Promise<WebhookHealth> {
  requireManager(actor);
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const where = { provider: PROVIDER, receivedAt: { gte: since } };
  // One transaction: the queries run one after the other.
  const byStatus = await tx.paymentWebhookEvent.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });
  const timing = await tx.paymentWebhookEvent.aggregate({
    where,
    _avg: { processingMs: true },
    _max: { processingMs: true },
  });
  const last = await tx.paymentWebhookEvent.findFirst({
    where: { provider: PROVIDER },
    orderBy: { receivedAt: "desc" },
    select: { receivedAt: true },
  });
  const recent = await tx.paymentWebhookEvent.findMany({
    where: { provider: PROVIDER },
    orderBy: { receivedAt: "desc" },
    take: 20,
    select: {
      id: true,
      eventId: true,
      eventType: true,
      livemode: true,
      isTest: true,
      status: true,
      attempts: true,
      lastError: true,
      receivedAt: true,
      processingMs: true,
    },
  });
  const count = (status: string) =>
    byStatus.find((row) => row.status === status)?._count._all ?? 0;
  const processed = count("processed");
  const failed = count("failed");
  const pending = count("received");
  return {
    days,
    received: processed + failed + pending,
    processed,
    failed,
    pending,
    lastReceivedAt: last?.receivedAt ?? null,
    averageMs:
      timing._avg.processingMs === null
        ? null
        : Math.round(timing._avg.processingMs),
    maxMs: timing._max.processingMs,
    recent,
  };
}

/**
 * "Reprocessar": every failed event is processed again from its stored
 * body. Idempotent: only a `failed` row changes, and processing only
 * records the event in this step.
 */
export async function reprocessFailedEvents(
  tx: ContextTransaction,
  actor: BillingActor,
): Promise<Readonly<{ processed: number; failed: number }>> {
  requireManager(actor);
  const gateway = await getStripeGateway(tx, actor);
  const failedRows = await tx.paymentWebhookEvent.findMany({
    where: { provider: PROVIDER, status: "failed" },
    orderBy: { receivedAt: "asc" },
    take: 100,
    select: { id: true, rawBody: true, attempts: true },
  });
  let processed = 0;
  let failed = 0;
  for (const row of failedRows) {
    const error = processStripeEvent(row.rawBody, gateway.mode);
    const result = await tx.paymentWebhookEvent.updateMany({
      where: { id: row.id, status: "failed" },
      data: {
        status: error ? "failed" : "processed",
        attempts: row.attempts + 1,
        lastError: error,
        processedAt: error ? null : new Date(),
      },
    });
    if (result.count === 0) continue;
    if (error) failed += 1;
    else processed += 1;
  }
  if (failedRows.length > 0) {
    await recordAudit(tx, adminAuditContext(actor.userId), {
      action: "platform.billing.gateway.reprocess",
      resourceType: "payment_gateway",
      resourceId: PROVIDER,
      result: failed === 0 ? "success" : "error",
      origin: "admin",
      metadata: { provider: PROVIDER, count: failedRows.length },
    });
  }
  return { processed, failed };
}

export type GatewayHistoryRow = Readonly<{
  id: string;
  occurredAt: Date;
  action: string;
  result: string;
  actorUserId: string | null;
  fields: readonly string[];
}>;

/** The audit events of the gateway, newest first. */
export async function gatewayHistory(
  tx: ContextTransaction,
  actor: BillingActor,
): Promise<GatewayHistoryRow[]> {
  requireManager(actor);
  const rows = await tx.$queryRaw<
    {
      id: string;
      occurred_at: Date;
      action: string;
      result: string;
      actor_user_id: string | null;
      metadata: Record<string, unknown> | null;
    }[]
  >`select * from private.payment_gateway_history(20)`;
  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    action: row.action,
    result: row.result,
    actorUserId: row.actor_user_id,
    fields: Array.isArray(row.metadata?.fields)
      ? (row.metadata.fields as unknown[]).filter(
          (field): field is string => typeof field === "string",
        )
      : [],
  }));
}
