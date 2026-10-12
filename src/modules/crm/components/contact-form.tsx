"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import {
  createContactAction,
  type CrmActionState,
  updateContactAction,
} from "../server/actions";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const INITIAL: CrmActionState = {};

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
  useActionStatus(state);
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
      <Label className="flex-col items-start">
        {t("fields.name")}
        <Input
          name="name"
          required
          maxLength={160}
          defaultValue={values?.name ?? ""}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.email")}
        <Input
          name="email"
          type="email"
          maxLength={254}
          defaultValue={values?.email ?? ""}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.phone")}
        <Input name="phone" maxLength={40} defaultValue={values?.phone ?? ""} />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.companyName")}
        <Input
          name="companyName"
          maxLength={160}
          defaultValue={values?.companyName ?? ""}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.jobTitle")}
        <Input
          name="jobTitle"
          maxLength={120}
          defaultValue={values?.jobTitle ?? ""}
        />
      </Label>
      <Label className="flex-col items-start">
        {t("fields.notes")}
        <Textarea
          name="notes"
          maxLength={5000}
          rows={3}
          defaultValue={values?.notes ?? ""}
        />
      </Label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {contactId ? t("form.save") : t("form.add")}
        </Button>
      </div>
    </form>
  );
}
