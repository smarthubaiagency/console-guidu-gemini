import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRound } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { ContactForm } from "@/modules/crm/client";
import { CrmPermissions } from "@/modules/crm/manifest";
import { getContact } from "@/modules/crm/server";
import { AppError } from "@/shared/errors";

export async function generateMetadata() {
  const t = await getTranslations("crm");
  return { title: t("contact.metaTitle") };
}

interface PageProps {
  params: Promise<{ workspaceSlug: string; contactId: string }>;
}

/** One contact (F4c): its data and, for who may write, the edit form. */
export default async function CrmContactPage({ params }: PageProps) {
  const { workspaceSlug, contactId } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/crm/contacts/${contactId}`,
  );
  let context;
  try {
    context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
  } catch {
    notFound();
  }

  const view = await withContext(prisma, context, async (tx) => {
    const access = await resolveModulePageAccess(
      tx,
      context,
      "crm",
      CrmPermissions.CONTACTS_READ,
    );
    if (access.kind !== "ok") return access;
    try {
      const contact = await getContact(tx, context, contactId);
      return {
        kind: "ok" as const,
        contact,
        canWrite: access.can(CrmPermissions.CONTACTS_WRITE) && !access.readOnly,
      };
    } catch (error) {
      if (error instanceof AppError && error.code === "not_found") {
        return { kind: "missing" as const };
      }
      throw error;
    }
  });
  if (view.kind === "missing") notFound();
  const t = await getTranslations("crm");

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="crm-contact">
      <ModulePageHeader
        trail={[
          t("breadcrumbModules"),
          t("breadcrumbCrm"),
          t("contacts.title"),
        ]}
        title={
          view.kind === "ok" ? view.contact.name : t("contact.fallbackTitle")
        }
        description={t("contact.description")}
        icon={<UserRound className="h-5 w-5" />}
      />
      <Link
        href={`/app/${workspaceSlug}/crm/contacts`}
        className="text-12 text-primary font-semibold"
      >
        {t("contact.back")}
      </Link>
      {view.kind !== "ok" ? (
        <ModuleNotice variant={view.kind} />
      ) : view.canWrite ? (
        <div className="border-card-border bg-surface-card rounded-xl border p-5 shadow-xs">
          <ContactForm
            workspaceSlug={workspaceSlug}
            contactId={view.contact.id}
            values={view.contact}
          />
        </div>
      ) : (
        <dl className="border-card-border bg-surface-card text-12 grid gap-2 rounded-xl border p-5 shadow-xs sm:grid-cols-2">
          {(
            [
              ["email", view.contact.email],
              ["phone", view.contact.phone],
              ["companyName", view.contact.companyName],
              ["jobTitle", view.contact.jobTitle],
              ["notes", view.contact.notes],
            ] as const
          ).map(([field, value]) => (
            <div key={field}>
              <dt className="text-text-subtle font-medium">
                {t(`fields.${field}`)}
              </dt>
              <dd className="text-text">{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
