import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { Plus, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { RecordWorkbench, WorkbenchPanel } from "@/components/layout/workbench";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { ContactForm } from "@/modules/crm/client";
import { CrmPermissions } from "@/modules/crm/manifest";
import { getContact, listContacts } from "@/modules/crm/server";
import { AppError } from "@/shared/errors";

export async function generateMetadata() {
  const t = await getTranslations("crm");
  return { title: t("contacts.metaTitle") };
}

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ q?: string; cursor?: string; edit?: string }>;
}

/**
 * Contacts of the workspace (F4c): search and list. Creating and editing
 * open in the internal drawer (ADR 0015) at `?edit=new` or `?edit=<id>`.
 */
export default async function CrmContactsPage({
  params,
  searchParams,
}: PageProps) {
  const { workspaceSlug } = await params;
  const { q, cursor, edit } = await searchParams;
  const identity = await requireUserPage(`/app/${workspaceSlug}/crm/contacts`);
  let context;
  try {
    context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
  } catch (error) {
    unstable_rethrow(error);
    notFound();
  }
  const search = typeof q === "string" ? q.slice(0, 100) : "";
  const editKey = typeof edit === "string" && edit ? edit : null;

  const view = await withContext(prisma, context, async (tx) => {
    const access = await resolveModulePageAccess(
      tx,
      context,
      "crm",
      CrmPermissions.CONTACTS_READ,
    );
    if (access.kind !== "ok") return access;
    const page = await listContacts(tx, context, {
      search: search || undefined,
      cursor: typeof cursor === "string" ? cursor : undefined,
      limit: 50,
    });
    let editing = null;
    if (editKey && editKey !== "new") {
      try {
        editing = await getContact(tx, context, editKey);
      } catch (error) {
        if (!(error instanceof AppError && error.code === "not_found")) {
          throw error;
        }
      }
    }
    return {
      kind: "ok" as const,
      ...page,
      editing,
      canWrite: access.can(CrmPermissions.CONTACTS_WRITE),
      readOnly: access.readOnly,
    };
  });
  if (view.kind === "missing") notFound();
  const base = `/app/${workspaceSlug}/crm/contacts`;
  const t = await getTranslations("crm");
  const canEdit = view.kind === "ok" && view.canWrite && !view.readOnly;
  // Links keep the search and the page of the list.
  const listQuery = {
    ...(search ? { q: search } : {}),
    ...(typeof cursor === "string" && cursor ? { cursor } : {}),
  };
  const hrefWith = (extra: Record<string, string>) => {
    const query = new URLSearchParams({ ...listQuery, ...extra }).toString();
    return query ? `${base}?${query}` : base;
  };

  let panel: React.ReactNode = null;
  if (view.kind === "ok" && editKey === "new" && canEdit) {
    panel = (
      <WorkbenchPanel title={t("contact.newTitle")}>
        <ContactForm workspaceSlug={workspaceSlug} />
      </WorkbenchPanel>
    );
  } else if (view.kind === "ok" && view.editing) {
    const contact = view.editing;
    panel = (
      <WorkbenchPanel
        title={contact.name}
        description={t("contact.description")}
      >
        {canEdit ? (
          <ContactForm
            key={contact.id}
            workspaceSlug={workspaceSlug}
            contactId={contact.id}
            values={contact}
          />
        ) : (
          <dl className="text-12 grid gap-3" data-testid="crm-contact">
            {(
              [
                ["email", contact.email],
                ["phone", contact.phone],
                ["companyName", contact.companyName],
                ["jobTitle", contact.jobTitle],
                ["notes", contact.notes],
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
      </WorkbenchPanel>
    );
  }

  const main = (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="crm-contacts">
      <ModulePageHeader
        title={t("contacts.title")}
        description={t("contacts.description")}
        icon={<Users className="h-5 w-5" />}
        actions={
          canEdit ? (
            <Button asChild>
              <Link href={hrefWith({ edit: "new" })} scroll={false}>
                <Plus />
                {t("contacts.new")}
              </Link>
            </Button>
          ) : null
        }
      />
      {view.kind !== "ok" ? (
        <ModuleNotice variant={view.kind} />
      ) : (
        <>
          {view.readOnly ? (
            <p
              className="text-12 text-text-secondary"
              data-testid="module-read-only"
            >
              {t("contacts.readOnly")}
            </p>
          ) : !view.canWrite ? (
            <p className="text-12 text-text-secondary">
              {t("contacts.readOnlyRole")}
            </p>
          ) : null}

          <form method="get" className="flex gap-2" role="search">
            <Input
              name="q"
              defaultValue={search}
              maxLength={100}
              placeholder={t("contacts.searchPlaceholder")}
              aria-label={t("contacts.searchLabel")}
            />
            <Button type="submit" variant="outline">
              {t("contacts.search")}
            </Button>
          </form>

          {view.items.length === 0 ? (
            <p className="text-12 text-text-secondary">
              {search ? t("contacts.noResults") : t("contacts.empty")}
            </p>
          ) : (
            <ul
              className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
              data-testid="crm-contact-list"
            >
              {view.items.map((contact) => (
                <li
                  key={contact.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-4"
                >
                  <Link
                    href={hrefWith({ edit: contact.id })}
                    scroll={false}
                    aria-current={contact.id === editKey ? "true" : undefined}
                    className="text-14 text-text font-medium hover:underline"
                  >
                    {contact.name}
                  </Link>
                  <span className="text-12 text-text-secondary">
                    {[contact.companyName, contact.email, contact.phone]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {view.nextCursor ? (
            <Link
              href={`${base}?${new URLSearchParams({ ...(search ? { q: search } : {}), cursor: view.nextCursor })}`}
              className="text-12 text-primary font-semibold"
            >
              {t("contacts.more")}
            </Link>
          ) : null}
        </>
      )}
    </div>
  );

  return (
    <RecordWorkbench
      main={main}
      panel={panel}
      panelLabel={t("contact.panelLabel")}
      closeHref={hrefWith({})}
      editKey={editKey}
    />
  );
}
