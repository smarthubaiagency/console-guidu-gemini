"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";

import { useActionStatus } from "@/components/feedback/use-action-status";
import { useStatus } from "@/components/feedback/status-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  type AiConsoleActionState,
  removeNoticeWebhookAction,
  saveNoticeWebhookAction,
} from "@/core/ai/console-actions";
import type { NoticeWebhookDto } from "@/core/ai/notices/webhook";

const INITIAL: AiConsoleActionState = {};

/**
 * The partner's webhook for the hot-lead notices of its customers' GUIDS
 * (A6a): the address, the signing secret (masked once saved) and on/off.
 */
export function NoticeWebhookForm({
  webhook,
}: Readonly<{ webhook: NoticeWebhookDto | null }>) {
  const t = useTranslations("aiConsole.noticeWebhook");
  const [state, action, pending] = useActionState(
    saveNoticeWebhookAction,
    INITIAL,
  );
  useActionStatus(state);
  return (
    <form action={action} className="space-y-3" data-testid="notice-webhook">
      <div className="space-y-1">
        <Label htmlFor="notice-webhook-url" className="text-12">
          {t("url")}
        </Label>
        <Input
          id="notice-webhook-url"
          name="url"
          type="url"
          required
          maxLength={2000}
          defaultValue={webhook?.url ?? ""}
          placeholder="https://"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="notice-webhook-secret" className="text-12">
          {t("secret")}
        </Label>
        <Input
          id="notice-webhook-secret"
          name="secret"
          type="password"
          autoComplete="off"
          minLength={16}
          maxLength={200}
          required={!webhook}
          placeholder={webhook?.maskedSecret ?? ""}
        />
        <p className="text-11 text-text-secondary">
          {webhook ? t("secretKeep") : t("secretHint")}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="notice-webhook-enabled" className="text-12 font-normal">
          {t("enabled")}
        </Label>
        <Switch
          id="notice-webhook-enabled"
          name="enabled"
          defaultChecked={webhook?.enabled ?? true}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={pending}
          data-testid="save-notice-webhook"
        >
          {t("save")}
        </Button>
        {webhook ? <RemoveNoticeWebhook /> : null}
      </div>
    </form>
  );
}

function RemoveNoticeWebhook() {
  const t = useTranslations("aiConsole.noticeWebhook");
  const tCommon = useTranslations("common");
  const { confirmStatus } = useStatus();
  const [state, setState] = useState<AiConsoleActionState>(INITIAL);
  const [pending, startTransition] = useTransition();
  useActionStatus(state);

  async function onRemove() {
    const confirmed = await confirmStatus({
      title: t("removeTitle"),
      message: t("removeMessage"),
      checkboxLabel: tCommon("confirmIrreversible"),
      confirmLabel: t("remove"),
      cancelLabel: t("cancel"),
      tone: "destructive",
    });
    if (!confirmed) return;
    startTransition(async () => {
      setState(await removeNoticeWebhookAction());
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={onRemove}
    >
      {t("remove")}
    </Button>
  );
}
