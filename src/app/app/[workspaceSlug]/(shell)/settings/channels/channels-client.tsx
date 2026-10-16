"use client";

import { Plug, RefreshCw, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";

import { useStatus } from "@/components/feedback/status-context";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type ChannelActionState,
  checkChannelConnectionAction,
  createChatwootConnectionAction,
  deleteChannelConnectionAction,
} from "@/core/channels/actions";
import type { ChannelConnectionDto } from "@/core/channels/connections";
import type { InboxOwner } from "@/core/channels/registry";

import { ServiceSettingsForm } from "./service-form";

type FormState = ChannelActionState & { formKey?: number };

const INITIAL: ChannelActionState = {};
/** Codes with a text under `channels.health`. */
const HEALTH_CODES = {
  invalid_url: 1,
  private_address: 1,
  timeout: 1,
  network: 1,
  too_large: 1,
  unauthorized: 1,
  not_found: 1,
  http_error: 1,
  invalid_response: 1,
} as const;
const HEALTH_BADGE = {
  ok: "default",
  failed: "destructive",
  unknown: "secondary",
} as const;

export function ChannelsClient({
  workspaceSlug,
  connections,
  owners,
  canManage,
}: Readonly<{
  workspaceSlug: string;
  connections: readonly ChannelConnectionDto[];
  /** Who answers each inbox, by `connectionId:inboxId` (A5c). */
  owners: Readonly<Record<string, InboxOwner>>;
  canManage: boolean;
}>) {
  const t = useTranslations("channels");
  return (
    <div className="space-y-6" data-testid="channels">
      <p className="text-12 text-text-secondary">{t("intro")}</p>
      {connections.length === 0 ? (
        <p className="text-12 text-text-secondary" data-testid="channels-empty">
          {canManage ? t("emptyManage") : t("empty")}
        </p>
      ) : (
        <div className="space-y-4">
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              workspaceSlug={workspaceSlug}
              connection={connection}
              owners={owners}
              canManage={canManage}
            />
          ))}
        </div>
      )}
      {canManage ? <ChatwootForm workspaceSlug={workspaceSlug} /> : null}
    </div>
  );
}

function ConnectionCard({
  workspaceSlug,
  connection,
  owners,
  canManage,
}: Readonly<{
  workspaceSlug: string;
  connection: ChannelConnectionDto;
  owners: Readonly<Record<string, InboxOwner>>;
  canManage: boolean;
}>) {
  const t = useTranslations("channels");
  const format = useFormatter();
  const when = (iso: string | null) =>
    iso
      ? format.dateTime(new Date(iso), {
          dateStyle: "short",
          timeStyle: "short",
        })
      : t("never");
  return (
    <Card data-testid="channel-connection">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {connection.name}
          <Badge variant="outline">{t(`kinds.${connection.kind}`)}</Badge>
          <Badge
            variant={HEALTH_BADGE[connection.healthStatus]}
            data-testid="channel-health"
          >
            {t(`healthStatus.${connection.healthStatus}`)}
          </Badge>
        </CardTitle>
        <CardDescription>
          {[
            connection.baseUrl,
            connection.accountId !== null
              ? t("account", { id: connection.accountId })
              : null,
            t("token", { masked: connection.maskedSecret }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {connection.healthStatus === "failed" ? (
          <p className="text-12 text-destructive" role="alert">
            {t(`health.${connection.healthError ?? "unknown"}`)}
          </p>
        ) : null}
        <div className="space-y-1">
          <p className="text-12 text-text font-medium">{t("inboxes")}</p>
          {connection.inboxes.length === 0 ? (
            <p className="text-12 text-text-secondary">{t("noInboxes")}</p>
          ) : (
            <ul
              className="text-12 text-text-secondary"
              data-testid="channel-inboxes"
            >
              {connection.inboxes.map((inbox) => {
                const owner = owners[`${connection.id}:${inbox.id}`];
                const name = owner?.name ?? t("owner.unnamed");
                return (
                  <li key={inbox.id}>
                    {[
                      inbox.name,
                      inbox.channel_type,
                      owner
                        ? owner.active
                          ? name
                          : t("owner.paused", { name })
                        : t("owner.none"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="text-12 text-text-secondary">
          {[
            t("lastEvent", { date: when(connection.lastEventAt) }),
            t("checked", { date: when(connection.healthCheckedAt) }),
            connection.unroutedEvents > 0
              ? t("unrouted", { count: connection.unroutedEvents })
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="space-y-1" data-testid="channel-activity">
          <p className="text-12 text-text font-medium">{t("activity.title")}</p>
          <p className="text-12 text-text-secondary">
            {[
              t("activity.sent", { count: connection.activity.sent }),
              connection.activity.failedDeliveries > 0
                ? t("activity.failedDeliveries", {
                    count: connection.activity.failedDeliveries,
                  })
                : null,
              connection.activity.failedEvents > 0
                ? t("activity.failedEvents", {
                    count: connection.activity.failedEvents,
                  })
                : null,
              t("activity.lastSent", {
                date: when(connection.activity.lastSentAt),
              }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {connection.activity.lastDeliveryError ? (
            <p className="text-12 text-destructive">
              {t("activity.lastError", {
                reason: t(
                  `health.${connection.activity.lastDeliveryError in HEALTH_CODES ? connection.activity.lastDeliveryError : "unknown"}`,
                ),
              })}
            </p>
          ) : null}
        </div>
        {canManage && connection.inboxes.length > 0 ? (
          <ServiceSettingsForm
            workspaceSlug={workspaceSlug}
            connection={connection}
          />
        ) : null}
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <CheckButton
              workspaceSlug={workspaceSlug}
              connectionId={connection.id}
            />
            <DeleteButton
              workspaceSlug={workspaceSlug}
              connection={connection}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CheckButton({
  workspaceSlug,
  connectionId,
}: Readonly<{ workspaceSlug: string; connectionId: string }>) {
  const t = useTranslations("channels");
  const [state, setState] = useState<ChannelActionState>(INITIAL);
  const [pending, startTransition] = useTransition();
  useActionStatus(state);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      data-testid="check-channel"
      onClick={() =>
        startTransition(async () => {
          const formData = new FormData();
          formData.append("workspaceSlug", workspaceSlug);
          formData.append("connectionId", connectionId);
          setState(await checkChannelConnectionAction({}, formData));
        })
      }
    >
      <RefreshCw />
      {t("check")}
    </Button>
  );
}

function DeleteButton({
  workspaceSlug,
  connection,
}: Readonly<{ workspaceSlug: string; connection: ChannelConnectionDto }>) {
  const t = useTranslations("channels");
  const tCommon = useTranslations("common");
  const { confirmStatus } = useStatus();
  const [state, setState] = useState<ChannelActionState>(INITIAL);
  const [pending, startTransition] = useTransition();
  useActionStatus(state);

  async function onDelete() {
    const confirmed = await confirmStatus({
      title: t("deleteTitle"),
      message: t("deleteMessage", { name: connection.name }),
      checkboxLabel: tCommon("confirmIrreversible"),
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      tone: "destructive",
    });
    if (!confirmed) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("connectionId", connection.id);
      setState(await deleteChannelConnectionAction({}, formData));
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={onDelete}
      data-testid="delete-channel"
    >
      <Trash2 />
      {t("delete")}
    </Button>
  );
}

function ChatwootForm({ workspaceSlug }: Readonly<{ workspaceSlug: string }>) {
  const t = useTranslations("channels");
  const [state, action, pending] = useActionState(
    async (prev: FormState, formData: FormData): Promise<FormState> => {
      const result = await createChatwootConnectionAction(prev, formData);
      // A new key only after success: it clears the form, keeping the
      // typed values when the provider refused them.
      const formKey = result.success ? Date.now() : prev.formKey;
      return formKey === undefined ? result : { ...result, formKey };
    },
    INITIAL as FormState,
  );
  useActionStatus(state);
  const errors = state.fieldErrors ?? {};
  const field = (
    name: string,
    label: string,
    props: React.ComponentProps<typeof Input>,
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`chatwoot-${name}`} className="text-12">
        {label}
      </Label>
      <Input
        id={`chatwoot-${name}`}
        name={name}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `chatwoot-${name}-error` : undefined}
        {...props}
      />
      {errors[name] ? (
        <p id={`chatwoot-${name}-error`} className="text-11 text-destructive">
          {errors[name]}
        </p>
      ) : null}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4" />
          {t("new.title")}
        </CardTitle>
        <CardDescription>{t("new.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          key={state.formKey ?? "form"}
          action={action}
          className="grid gap-4 sm:grid-cols-2"
          data-testid="create-chatwoot"
        >
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          {field("name", t("new.name"), {
            required: true,
            maxLength: 80,
            placeholder: t("new.namePlaceholder"),
          })}
          {field("baseUrl", t("new.baseUrl"), {
            required: true,
            type: "url",
            placeholder: "https://chat.suaempresa.com.br",
          })}
          {field("accountId", t("new.accountId"), {
            required: true,
            inputMode: "numeric",
            placeholder: "1",
          })}
          {field("accessToken", t("new.accessToken"), {
            required: true,
            type: "password",
            autoComplete: "off",
          })}
          <p className="text-11 text-text-secondary sm:col-span-2">
            {t("new.accessTokenHint")}
          </p>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {t("new.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
