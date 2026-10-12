"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import {
  createContactAction,
  type CrmActionState,
  updateContactAction,
} from "../server/actions";

const INITIAL: CrmActionState = {};
const INPUT =
  "border-border bg-surface-card text-14 text-text w-full rounded-lg border px-3 py-2 disabled:opacity-60";
const LABEL = "text-12 text-text-subtle flex flex-col gap-1 font-medium";
const BUTTON =
  "bg-primary text-on-primary text-12 rounded-lg px-4 py-2 font-semibold disabled:opacity-60";

export type ContactFormValues = Readonly<{
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  notes: string | null;
}>;

/** Create (no contactId) or edit a contact of the workspace (F4c). */
export function ContactForm({
  workspaceSlug,
  contactId,
  values,
}: Readonly<{
  workspaceSlug: string;
  contactId?: string;
  values?: ContactFormValues;
}>) {
  const t = useTranslations("crm");
  const [state, action, pending] = useActionState(
    contactId ? updateContactAction : createContactAction,
    INITIAL,
  );
  return (
    <form
      action={action}
      className="grid gap-3"
      data-testid={contactId ? "edit-contact" : "create-contact"}
    >
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      {contactId ? (
        <input type="hidden" name="contactId" value={contactId} />
      ) : null}
      <label className={LABEL}>
        {t("fields.name")}
        <input
          name="name"
          required
          maxLength={160}
          defaultValue={values?.name ?? ""}
          className={INPUT}
        />
      </label>
      <label className={LABEL}>
        {t("fields.email")}
        <input
          name="email"
          type="email"
          maxLength={254}
          defaultValue={values?.email ?? ""}
          className={INPUT}
        />
      </label>
      <label className={LABEL}>
        {t("fields.phone")}
        <input
          name="phone"
          maxLength={40}
          defaultValue={values?.phone ?? ""}
          className={INPUT}
        />
      </label>
      <label className={LABEL}>
        {t("fields.companyName")}
        <input
          name="companyName"
          maxLength={160}
          defaultValue={values?.companyName ?? ""}
          className={INPUT}
        />
      </label>
      <label className={LABEL}>
        {t("fields.jobTitle")}
        <input
          name="jobTitle"
          maxLength={120}
          defaultValue={values?.jobTitle ?? ""}
          className={INPUT}
        />
      </label>
      <label className={LABEL}>
        {t("fields.notes")}
        <textarea
          name="notes"
          maxLength={5000}
          rows={3}
          defaultValue={values?.notes ?? ""}
          className={INPUT}
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={BUTTON}>
          {contactId ? t("form.save") : t("form.add")}
        </button>
        {state.error ? (
          <p role="alert" className="text-12 text-danger-text">
            {state.error}
          </p>
        ) : state.message ? (
          <p role="status" className="text-12 text-success-text">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
