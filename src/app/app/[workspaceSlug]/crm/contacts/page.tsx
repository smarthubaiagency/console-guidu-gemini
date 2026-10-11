import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Users } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { ContactForm } from "@/modules/crm/client";
import { CrmPermissions } from "@/modules/crm/manifest";
import { listContacts } from "@/modules/crm/server";

export const metadata: Metadata = { title: "Contatos — CRM" };

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ q?: string; cursor?: string }>;
}

/** Contacts of the workspace (F4c): search, list and create. */
export default async function CrmContactsPage({
  params,
  searchParams,
}: PageProps) {
  const { workspaceSlug } = await params;
  const { q, cursor } = await searchParams;
  const identity = await requireUserPage(`/app/${workspaceSlug}/crm/contacts`);
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
  const search = typeof q === "string" ? q.slice(0, 100) : "";

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
    return {
      kind: "ok" as const,
      ...page,
      canWrite: access.can(CrmPermissions.CONTACTS_WRITE),
      readOnly: access.readOnly,
    };
  });
  if (view.kind === "missing") notFound();
  const base = `/app/${workspaceSlug}/crm/contacts`;

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="crm-contacts">
      <ModulePageHeader
        trail={["Módulos", "CRM", "Contatos"]}
        title="Contatos"
        description="Pessoas com quem o workspace se relaciona."
        icon={<Users className="h-5 w-5" />}
      />
      {view.kind !== "ok" ? (
        <ModuleNotice variant={view.kind} />
      ) : (
        <>
          <div className="border-card-border bg-surface-card rounded-xl border p-5 shadow-xs">
            {view.readOnly ? (
              <p
                className="text-12 text-text-secondary"
                data-testid="module-read-only"
              >
                Assinatura suspensa: os contatos ficam disponíveis só para
                consulta.
              </p>
            ) : view.canWrite ? (
              <ContactForm workspaceSlug={workspaceSlug} />
            ) : (
              <p className="text-12 text-text-secondary">
                Seu papel permite apenas consultar os contatos.
              </p>
            )}
          </div>

          <form method="get" className="flex gap-2" role="search">
            <input
              name="q"
              defaultValue={search}
              maxLength={100}
              placeholder="Buscar por nome, e-mail ou empresa"
              aria-label="Buscar contatos"
              className="border-border bg-surface-card text-14 text-text w-full rounded-lg border px-3 py-2"
            />
            <button
              type="submit"
              className="border-border text-12 text-text rounded-lg border px-4 py-2 font-semibold"
            >
              Buscar
            </button>
          </form>

          {view.items.length === 0 ? (
            <p className="text-12 text-text-secondary">
              {search
                ? "Nenhum contato encontrado."
                : "Sem dados: nenhum contato ainda."}
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
                    href={`${base}/${contact.id}`}
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
              Mais contatos
            </Link>
          ) : null}
        </>
      )}
    </div>
  );
}
