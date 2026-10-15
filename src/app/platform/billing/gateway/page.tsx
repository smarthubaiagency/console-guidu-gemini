import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { BillingTabs } from "@/components/billing/billing-tabs";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { InfoList } from "@/components/settings/info-list";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { appOrigin } from "@/core/auth/origin";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import {
  reprocessStripeWebhooksAction,
  saveStripeCredentialsAction,
  saveStripeSettingsAction,
  sendStripeTestWebhookAction,
} from "@/core/billing/gateway/actions";
import {
  gatewayHistory,
  getStripeGateway,
  webhookHealth,
} from "@/core/billing/gateway/service";
import {
  GATEWAY_MODES,
  STRIPE_WEBHOOK_PATH,
} from "@/core/billing/gateway/stripe";
import { platformGrants } from "@/core/module-runtime/loaders";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gateway");
  return { title: t("metaTitle") };
}

const HISTORY_ACTIONS = [
  "settings",
  "credentials",
  "test_webhook",
  "reprocess",
] as const;

function historyKey(action: string): string {
  const suffix = action.replace("platform.billing.gateway.", "");
  return (HISTORY_ACTIONS as readonly string[]).includes(suffix)
    ? suffix
    : "other";
}

function webhookUrl(): string | null {
  try {
    return `${appOrigin()}${STRIPE_WEBHOOK_PATH}`;
  } catch {
    return null;
  }
}

/**
 * Cobrança › Gateway (CF7): Stripe Connect only. On/off, default and mode,
 * the credentials (masked only), the webhook (address from APP_URL, health,
 * test and reprocessing) and the history of changes from the audit trail.
 * Real charging stays off until P6 (D-PA-14). Owner and billing only.
 */
export default async function PlatformBillingGatewayPage() {
  const identity = await requirePlatformAdminPage("/platform/billing/gateway");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  if (!platformGrants(role)("platform.billing.manage")) {
    return <ModuleNotice variant="denied" />;
  }
  const actor = { userId: identity.userId, platformRole: role };
  const partner = await getRequestPartner();
  const data = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      gateway: await getStripeGateway(tx, actor),
      health: await webhookHealth(tx, actor),
      history: await gatewayHistory(tx, actor),
    }),
    { partnerId: partner?.partnerId ?? null },
  );
  const { gateway, health, history } = data;
  const t = await getTranslations("gateway");
  const tb = await getTranslations("billing.platform");
  const format = await getFormatter();
  const dateTime = (date: Date) =>
    format.dateTime(date, { dateStyle: "short", timeStyle: "medium" });
  const url = webhookUrl();
  const caps = gateway.capabilities;
  const capabilityTags = [
    caps.split ? "split" : null,
    caps.recurring ? "recurring" : null,
    caps.hostedCheckout ? "hostedCheckout" : null,
    caps.recipientOnboarding ? "recipientOnboarding" : null,
  ].filter((tag): tag is string => tag !== null);

  return (
    <div className="w-full space-y-6" data-testid="platform-billing-gateway">
      <ModulePageHeader
        title={tb("title")}
        description={t("description")}
        icon={<CreditCard className="h-5 w-5" />}
      />
      <BillingTabs active="gateway" showGateway />

      <SettingsCard
        title={t("stripe.title")}
        description={t("stripe.description")}
        testId="gateway-stripe"
      >
        <div
          className="flex flex-wrap gap-2"
          data-testid="gateway-capabilities"
        >
          {capabilityTags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {t(`capabilities.${tag}`)}
            </Badge>
          ))}
          {caps.methods.map((method) => (
            <Badge key={method} variant="outline">
              {t(`methods.${method}`)}
            </Badge>
          ))}
        </div>
        <InfoList
          items={[
            {
              label: t("stripe.status"),
              value: gateway.enabled ? t("stripe.on") : t("stripe.off"),
              testId: "gateway-status",
            },
            {
              label: t("stripe.charging"),
              value: t("stripe.chargingOff"),
              testId: "gateway-charging",
            },
          ]}
        />
        <ActionForm
          action={saveStripeSettingsAction}
          submitLabel={t("save")}
          className="flex flex-col items-start gap-4"
          testId="gateway-settings-form"
        >
          <Label className="text-14 gap-2 font-normal">
            <Checkbox name="enabled" defaultChecked={gateway.enabled} />
            {t("stripe.enable")}
          </Label>
          <Label className="text-14 gap-2 font-normal">
            <Checkbox name="isDefault" defaultChecked={gateway.isDefault} />
            {t("stripe.default")}
          </Label>
          <div className="space-y-1">
            <Label htmlFor="gateway-mode" className="text-12">
              {t("mode.label")}
            </Label>
            <NativeSelect
              id="gateway-mode"
              name="mode"
              defaultValue={gateway.mode}
            >
              {GATEWAY_MODES.map((mode) => (
                <NativeSelectOption key={mode} value={mode}>
                  {t(`mode.${mode}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </ActionForm>
      </SettingsCard>

      <SettingsCard
        title={t("credentials.title")}
        description={t("credentials.description")}
        testId="gateway-credentials"
      >
        <InfoList
          items={[
            {
              label: t("credentials.secretKey"),
              value: gateway.secretKeyMasked ?? t("credentials.notSet"),
              mono: true,
              testId: "gateway-secret-key",
            },
            {
              label: t("credentials.webhookSecret"),
              value: gateway.webhookSecretMasked ?? t("credentials.notSet"),
              mono: true,
              testId: "gateway-webhook-secret",
            },
          ]}
        />
        <ActionForm
          action={saveStripeCredentialsAction}
          submitLabel={t("save")}
          className="flex w-full flex-col items-start gap-4"
          testId="gateway-credentials-form"
        >
          <div className="grid w-full gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="gateway-secret-key-input" className="text-12">
                {t("credentials.secretKeyInput")}
              </Label>
              <Input
                id="gateway-secret-key-input"
                name="secretKey"
                type="password"
                autoComplete="off"
                maxLength={260}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gateway-webhook-secret-input" className="text-12">
                {t("credentials.webhookSecretInput")}
              </Label>
              <Input
                id="gateway-webhook-secret-input"
                name="webhookSecret"
                type="password"
                autoComplete="off"
                maxLength={220}
              />
            </div>
          </div>
          <p className="text-11 text-text-secondary">{t("credentials.hint")}</p>
        </ActionForm>
      </SettingsCard>

      <SettingsCard
        title={t("webhook.title")}
        description={t("webhook.description")}
        testId="gateway-webhook"
      >
        <div className="space-y-1">
          <Label htmlFor="gateway-webhook-url" className="text-12">
            {t("webhook.url")}
          </Label>
          <Input
            id="gateway-webhook-url"
            readOnly
            value={url ?? t("webhook.noAppUrl")}
            className="font-mono"
            data-testid="gateway-webhook-url"
          />
        </div>
        <InfoList
          items={[
            {
              label: t("webhook.received", { days: health.days }),
              value: format.number(health.received),
              testId: "gateway-received",
            },
            {
              label: t("webhook.failed"),
              value: format.number(health.failed),
              testId: "gateway-failed",
            },
            {
              label: t("webhook.last"),
              value: health.lastReceivedAt
                ? dateTime(health.lastReceivedAt)
                : t("webhook.never"),
              testId: "gateway-last",
            },
            {
              label: t("webhook.latency"),
              value:
                health.averageMs === null
                  ? t("webhook.never")
                  : t("webhook.latencyValue", {
                      average: health.averageMs,
                      max: health.maxMs ?? health.averageMs,
                    }),
              testId: "gateway-latency",
            },
          ]}
        />
        <div className="flex flex-wrap gap-3">
          <ActionForm
            action={sendStripeTestWebhookAction}
            submitLabel={t("webhook.sendTest")}
            tone="neutral"
            disabled={!gateway.enabled}
            testId="gateway-test-form"
          />
          <ActionForm
            action={reprocessStripeWebhooksAction}
            submitLabel={t("webhook.reprocess")}
            tone="neutral"
            disabled={health.failed === 0}
            testId="gateway-reprocess-form"
          />
        </div>
        {!gateway.enabled ? (
          <p className="text-12 text-text-secondary">{t("webhook.offHint")}</p>
        ) : null}
        {health.recent.length > 0 ? (
          <Table data-testid="gateway-events">
            <TableHeader>
              <TableRow>
                <TableHead>{t("events.received")}</TableHead>
                <TableHead>{t("events.type")}</TableHead>
                <TableHead>{t("events.status")}</TableHead>
                <TableHead>{t("events.attempts")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.recent.map((event) => (
                <TableRow key={event.id} data-testid="gateway-event">
                  <TableCell className="text-12">
                    {dateTime(event.receivedAt)}
                  </TableCell>
                  <TableCell className="text-12 font-mono">
                    {event.eventType}
                    {event.isTest ? (
                      <Badge variant="outline" className="ml-2">
                        {t("events.test")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-12">
                    {t(`events.statuses.${event.status}`)}
                    {event.lastError ? (
                      <span className="text-text-secondary">
                        {" "}
                        ({event.lastError})
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-12">{event.attempts}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-12 text-text-secondary">{t("events.none")}</p>
        )}
      </SettingsCard>

      <SettingsCard
        title={t("history.title")}
        description={t("history.description")}
        testId="gateway-history"
      >
        {history.length > 0 ? (
          <ul className="divide-border divide-y">
            {history.map((row) => (
              <li
                key={row.id}
                className="text-12 flex flex-wrap justify-between gap-2 py-2"
                data-testid="gateway-history-row"
              >
                <span className="text-text font-medium">
                  {t(`history.actions.${historyKey(row.action)}`)}
                  {row.fields.length > 0 ? (
                    <span className="text-text-secondary font-normal">
                      {" · "}
                      {row.fields
                        .map((field) =>
                          t.has(`history.fields.${field}`)
                            ? t(`history.fields.${field}`)
                            : field,
                        )
                        .join(", ")}
                    </span>
                  ) : null}
                </span>
                <span className="text-text-secondary">
                  {dateTime(row.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-12 text-text-secondary">{t("history.none")}</p>
        )}
      </SettingsCard>
    </div>
  );
}
