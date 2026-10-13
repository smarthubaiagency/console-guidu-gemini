"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";

import { useActionStatus } from "@/components/feedback/use-action-status";
import { useStatus } from "@/components/feedback/status-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ReferralDto } from "@/core/ai/customer-guids";

/**
 * Referrals of a workspace (campos.md §4): who a GUIDS forwards the
 * out-of-scope leads to. Shared by the partner in `/admin` (A3c) and the
 * customer in `/app` (A4a); each console passes its actions.
 */

type ActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  requestId?: string;
  fieldErrors?: Record<string, string>;
};

type FormAction = (
  prev: ActionState,
  formData: FormData,
) => Promise<ActionState>;

export type ReferralActions = Readonly<{
  save: FormAction;
  delete: FormAction;
}>;

const INITIAL: ActionState = {};

function FieldError({ message }: Readonly<{ message: string | undefined }>) {
  return message ? (
    <p className="text-11 text-destructive" role="alert">
      {message}
    </p>
  ) : null;
}

export function Referrals({
  agentId,
  referrals,
  canManage,
  actions,
  hidden = {},
}: Readonly<{
  agentId: string;
  referrals: readonly ReferralDto[];
  canManage: boolean;
  actions: ReferralActions;
  /** Extra fields every form sends, such as the workspace's slug. */
  hidden?: Readonly<Record<string, string>>;
}>) {
  const t = useTranslations("aiConsole.guids.referrals");
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className="space-y-3" data-testid="guid-referrals">
      <div className="space-y-1">
        <h3 className="text-14 text-text font-semibold">{t("title")}</h3>
        <p className="text-12 text-text-secondary">{t("hint")}</p>
      </div>
      <ul className="border-card-border divide-border divide-y rounded-xl border">
        {referrals.map((referral) => (
          <li
            key={referral.id}
            className="space-y-3 p-3"
            data-testid="guid-referral"
          >
            {editing === referral.id ? (
              <ReferralForm
                agentId={agentId}
                referral={referral}
                actions={actions}
                hidden={hidden}
                onDone={() => setEditing(null)}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="text-12 text-text font-medium">
                    {referral.name}{" "}
                    <span className="text-text-secondary font-normal">
                      #{referral.referralTag}
                    </span>
                  </p>
                  <p className="text-11 text-text-secondary">
                    {[
                      referral.specialties.join(", "),
                      referral.city,
                      referral.remote ? t("remoteShort") : null,
                      referral.phone,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(referral.id)}
                    >
                      {t("edit")}
                    </Button>
                    <DeleteReferralButton
                      agentId={agentId}
                      referral={referral}
                      actions={actions}
                      hidden={hidden}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </li>
        ))}
        {referrals.length === 0 ? (
          <li className="text-12 text-text-secondary p-3">{t("empty")}</li>
        ) : null}
      </ul>
      {canManage ? (
        <div className="border-card-border space-y-3 rounded-xl border p-3">
          <h4 className="text-12 text-text font-semibold">{t("new")}</h4>
          <ReferralForm agentId={agentId} actions={actions} hidden={hidden} />
        </div>
      ) : null}
    </section>
  );
}

/** A referral of the customer: a new one, or the one being edited. */
function ReferralForm({
  agentId,
  referral,
  actions,
  hidden,
  onDone,
}: Readonly<{
  agentId: string;
  referral?: ReferralDto;
  actions: ReferralActions;
  hidden: Readonly<Record<string, string>>;
  onDone?: () => void;
}>) {
  const t = useTranslations("aiConsole.guids.referrals");
  const [state, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await actions.save(prev, formData);
      // A saved referral closes its form; a new one leaves it empty.
      if (result.success) onDone?.();
      return result;
    },
    INITIAL,
  );
  useActionStatus(state);
  const errors = state.fieldErrors ?? {};
  const id = (field: string) => `referral-${referral?.id ?? "new"}-${field}`;

  return (
    <form
      action={action}
      className="space-y-3"
      data-testid={referral ? "edit-referral" : "create-referral"}
    >
      <input type="hidden" name="agentId" value={agentId} />
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {referral ? (
        <input type="hidden" name="referralId" value={referral.id} />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={id("name")} className="text-12">
            {t("name")}
          </Label>
          <Input
            id={id("name")}
            name="name"
            required
            maxLength={160}
            defaultValue={referral?.name ?? ""}
            aria-invalid={Boolean(errors.name) || undefined}
          />
          <FieldError message={errors.name} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("tag")} className="text-12">
            {t("tag")}
          </Label>
          <Input
            id={id("tag")}
            name="referralTag"
            required
            maxLength={60}
            defaultValue={referral?.referralTag ?? ""}
            aria-invalid={Boolean(errors.referralTag) || undefined}
          />
          <p className="text-11 text-text-secondary">{t("tagHint")}</p>
          <FieldError message={errors.referralTag} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={id("specialties")} className="text-12">
            {t("specialties")}
          </Label>
          <Input
            id={id("specialties")}
            name="specialties"
            defaultValue={referral?.specialties.join(", ") ?? ""}
            aria-invalid={
              Object.keys(errors).some((key) =>
                key.startsWith("specialties"),
              ) || undefined
            }
          />
          <p className="text-11 text-text-secondary">{t("specialtiesHint")}</p>
          <FieldError
            message={
              Object.entries(errors).find(([key]) =>
                key.startsWith("specialties"),
              )?.[1]
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("phone")} className="text-12">
            {t("phone")}
          </Label>
          <Input
            id={id("phone")}
            name="phone"
            type="tel"
            maxLength={16}
            placeholder="+5511999998888"
            defaultValue={referral?.phone ?? ""}
            aria-invalid={Boolean(errors.phone) || undefined}
          />
          <FieldError message={errors.phone} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("city")} className="text-12">
            {t("city")}
          </Label>
          <Input
            id={id("city")}
            name="city"
            maxLength={120}
            defaultValue={referral?.city ?? ""}
            aria-invalid={Boolean(errors.city) || undefined}
          />
          <FieldError message={errors.city} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Switch
          id={id("remote")}
          name="remote"
          defaultChecked={referral?.remote ?? false}
        />
        <Label htmlFor={id("remote")} className="text-12 font-normal">
          {t("remote")}
        </Label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {referral ? t("save") : t("create")}
        </Button>
        {onDone ? (
          <Button type="button" variant="outline" size="sm" onClick={onDone}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function DeleteReferralButton({
  agentId,
  referral,
  actions,
  hidden,
}: Readonly<{
  agentId: string;
  referral: ReferralDto;
  actions: ReferralActions;
  hidden: Readonly<Record<string, string>>;
}>) {
  const t = useTranslations("aiConsole.guids.referrals");
  const tCommon = useTranslations("common");
  const { confirmStatus } = useStatus();
  const [state, setState] = useState<ActionState>(INITIAL);
  const [pending, startTransition] = useTransition();
  useActionStatus(state);

  async function onDelete() {
    const confirmed = await confirmStatus({
      title: t("deleteTitle"),
      message: t("deleteMessage", { name: referral.name }),
      checkboxLabel: tCommon("confirmIrreversible"),
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      tone: "destructive",
    });
    if (!confirmed) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.append("agentId", agentId);
      formData.append("referralId", referral.id);
      for (const [name, value] of Object.entries(hidden)) {
        formData.append(name, value);
      }
      setState(await actions.delete({}, formData));
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={onDelete}
    >
      {t("delete")}
    </Button>
  );
}
