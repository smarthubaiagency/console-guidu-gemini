"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { useActionStatus } from "@/components/feedback/use-action-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  bindGuidInboxAction,
  type GuidActionState,
  unbindGuidInboxAction,
} from "@/modules/ai-agents/server/actions";
import type { GuidChannelsDto } from "@/modules/ai-agents/server/services/channels";

/**
 * Canais of a GUIDS (A5b): the inboxes of the workspace's connections and
 * which of them this agent answers. Only a GUIDS turned on, with its
 * current configuration tested, takes a free inbox; the integration's
 * settings (Configurações › Canais) say how it answers.
 */
export function GuidChannels({
  workspaceSlug,
  agentId,
  channels,
  ready,
  settingsHref,
}: Readonly<{
  workspaceSlug: string;
  agentId: string;
  /** Null: this person does not see the channels. */
  channels: GuidChannelsDto | null;
  /** Turned on and tested in the current configuration. */
  ready: boolean;
  settingsHref: string;
}>) {
  const t = useTranslations("aiAgents.guids.channels");
  return (
    <section className="space-y-2" data-testid="guid-channels">
      <div className="space-y-1">
        <h3 className="text-12 text-text font-medium">{t("title")}</h3>
        <p className="text-11 text-text-secondary">
          {t.rich("description", {
            link: (chunks) => (
              <a className="underline" href={settingsHref}>
                {chunks}
              </a>
            ),
          })}
        </p>
      </div>
      {channels === null ? (
        <p className="text-12 text-text-secondary">{t("noAccess")}</p>
      ) : channels.inboxes.length === 0 ? (
        <p className="text-12 text-text-secondary">{t("empty")}</p>
      ) : (
        <>
          {channels.canManage && !ready ? (
            <p className="text-12 text-text-secondary">{t("needsActive")}</p>
          ) : null}
          <ul className="divide-border border-border divide-y rounded-lg border">
            {channels.inboxes.map((inbox) => (
              <li
                key={`${inbox.connectionId}:${inbox.inboxId}`}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
                data-testid="guid-inbox"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-12 text-text font-medium">
                    {inbox.inboxName}
                  </p>
                  <p className="text-11 text-text-secondary">
                    {[inbox.connectionName, inbox.channelType]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={inbox.state === "mine" ? "default" : "outline"}
                    data-testid="guid-inbox-state"
                  >
                    {inbox.state === "other" && inbox.otherAgent
                      ? t("state.otherNamed", { name: inbox.otherAgent })
                      : t(`state.${inbox.state}`)}
                  </Badge>
                  {channels.canManage && inbox.state === "mine" ? (
                    <InboxButton
                      label={t("unbind")}
                      testId="unbind-inbox"
                      action={unbindGuidInboxAction}
                      fields={{
                        workspaceSlug,
                        agentId,
                        routeId: inbox.routeId ?? "",
                      }}
                    />
                  ) : null}
                  {channels.canManage && inbox.state === "free" ? (
                    <InboxButton
                      label={t("bind")}
                      testId="bind-inbox"
                      disabled={!ready}
                      action={bindGuidInboxAction}
                      fields={{
                        workspaceSlug,
                        agentId,
                        connectionId: inbox.connectionId,
                        inboxId: inbox.inboxId,
                      }}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function InboxButton({
  label,
  testId,
  action,
  fields,
  disabled = false,
}: Readonly<{
  label: string;
  testId: string;
  action: (
    prev: GuidActionState,
    formData: FormData,
  ) => Promise<GuidActionState>;
  fields: Readonly<Record<string, string>>;
  disabled?: boolean;
}>) {
  const [state, setState] = useState<GuidActionState>({});
  const [pending, startTransition] = useTransition();
  useActionStatus(state);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled || pending}
      data-testid={testId}
      onClick={() =>
        startTransition(async () => {
          const formData = new FormData();
          for (const [name, value] of Object.entries(fields)) {
            formData.append(name, value);
          }
          setState(await action({}, formData));
        })
      }
    >
      {label}
    </Button>
  );
}
