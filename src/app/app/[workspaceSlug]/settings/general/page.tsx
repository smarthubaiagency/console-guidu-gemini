import { Settings } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/partners/action-form";
import { inputClass, labelClass } from "@/components/partners/form-classes";
import { saveWorkspaceLanguageAction } from "@/core/i18n/actions";
import { activeLanguages } from "@/core/i18n/store";
import { workspaceRoleGrants } from "@/core/permissions/guard";
import type { WorkspaceRole } from "@/core/permissions/roles";

export async function generateMetadata() {
  const t = await getTranslations("workspace");
  return { title: t("metaTitle") };
}

interface GeneralPageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function GeneralSettingsPage({
  params,
}: GeneralPageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/general`,
  );
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  const { workspace, organization, role } = await withContext(
    prisma,
    context,
    async (tx) => {
      const ws = await tx.workspace.findUnique({
        where: { id: context.workspaceId },
      });
      const org = await tx.organization.findUnique({
        where: { id: context.organizationId },
      });
      const member = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: context.workspaceId,
            userId: identity.userId,
          },
        },
        select: { role: true },
      });
      return { workspace: ws, organization: org, role: member?.role };
    },
  );
  const t = await getTranslations("preferences");
  const tw = await getTranslations("workspace");
  const languages = await activeLanguages();
  const canEdit = role
    ? workspaceRoleGrants(role as WorkspaceRole, "workspace.settings.update")
    : false;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="flex items-center gap-3">
          <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              {tw("title")}
            </h1>
            <p className="text-12 text-text-secondary">{tw("description")}</p>
          </div>
        </div>
      </div>

      <div className="border-card-border bg-surface-card space-y-4 rounded-xl border p-6 shadow-xs">
        <div>
          <label className="text-12 text-text-secondary block font-medium">
            {tw("name")}
          </label>
          <div className="text-14 text-text mt-1 font-semibold">
            {workspace?.name}
          </div>
        </div>

        <div>
          <label className="text-12 text-text-secondary block font-medium">
            {tw("slug")}
          </label>
          <div className="text-12 text-text-subtle bg-surface-raised mt-1 inline-block rounded-sm px-2 py-1 font-mono">
            {workspace?.slug}
          </div>
        </div>

        <div>
          <label className="text-12 text-text-secondary block font-medium">
            {tw("organization")}
          </label>
          <div className="text-14 text-text mt-1 font-medium">
            {organization?.name}
          </div>
        </div>

        <div>
          <label className="text-12 text-text-secondary block font-medium">
            {tw("uuid")}
          </label>
          <div className="text-12 text-text-secondary mt-1 font-mono">
            {workspace?.id}
          </div>
        </div>
      </div>

      {/* Default language of the dashboard (I1). */}
      <div
        className="border-card-border bg-surface-card space-y-3 rounded-xl border p-6 shadow-xs"
        data-testid="workspace-language"
      >
        <h2 className="text-14 text-text font-semibold">{t("workspace")}</h2>
        <p className="text-12 text-text-secondary">{t("workspaceHint")}</p>
        {canEdit ? (
          <ActionForm
            action={saveWorkspaceLanguageAction}
            submitLabel={t("title")}
          >
            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
            <label className={labelClass}>
              {t("workspace")}
              <select
                name="locale"
                defaultValue={workspace?.defaultLocale ?? ""}
                className={inputClass}
              >
                <option value="">{t("followPlatform")}</option>
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </ActionForm>
        ) : (
          <p className="text-14 text-text font-medium">
            {languages.find((l) => l.code === workspace?.defaultLocale)?.name ??
              t("followPlatform")}
          </p>
        )}
      </div>
    </div>
  );
}
