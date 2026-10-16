import { Settings } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/partners/action-form";
import { saveWorkspaceLanguageAction } from "@/core/i18n/actions";
import { activeLanguages } from "@/core/i18n/store";
import { workspaceRoleGrants } from "@/core/permissions/guard";
import type { WorkspaceRole } from "@/core/permissions/roles";
import { Label } from "@/components/ui/label";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { InfoList } from "@/components/settings/info-list";
import { RegionSettings } from "@/components/settings/region-settings";
import { SettingsCard } from "@/components/settings/settings-shell";
import { saveWorkspaceSettingsAction } from "@/core/settings/actions";
import { settingsView } from "@/core/settings/service";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

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

  const { workspace, organization, role, view } = await withContext(
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
      const view = await settingsView(tx, {
        level: "workspace",
        userId: identity.userId,
        ctx: context,
      });
      return { workspace: ws, organization: org, role: member?.role, view };
    },
  );
  const t = await getTranslations("preferences");
  const tw = await getTranslations("workspace");
  const languages = await activeLanguages();
  const canEdit = role
    ? workspaceRoleGrants(role as WorkspaceRole, "workspace.settings.update")
    : false;

  return (
    <>
      <ModulePageHeader
        title={tw("title")}
        description={tw("description")}
        icon={<Settings className="h-5 w-5" />}
      />

      <SettingsCard title={tw("identity")} testId="workspace-info">
        <InfoList
          items={[
            { label: tw("name"), value: workspace?.name },
            { label: tw("slug"), value: workspace?.slug, mono: true },
            { label: tw("organization"), value: organization?.name },
            { label: tw("uuid"), value: workspace?.id, mono: true },
          ]}
        />
      </SettingsCard>

      {/* Default language of the dashboard (I1). */}
      <SettingsCard
        title={t("workspace")}
        description={t("workspaceHint")}
        testId="workspace-language"
      >
        {canEdit ? (
          <ActionForm
            action={saveWorkspaceLanguageAction}
            submitLabel={t("title")}
          >
            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
            <Label className="flex-col items-start">
              {t("workspace")}
              <NativeSelect
                name="locale"
                defaultValue={workspace?.defaultLocale ?? ""}
                className="w-full"
              >
                <NativeSelectOption value="">
                  {t("followPlatform")}
                </NativeSelectOption>
                {languages.map((l) => (
                  <NativeSelectOption key={l.code} value={l.code}>
                    {l.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Label>
          </ActionForm>
        ) : (
          <p className="text-14 text-text font-medium">
            {languages.find((l) => l.code === workspace?.defaultLocale)?.name ??
              t("followPlatform")}
          </p>
        )}
      </SettingsCard>

      <RegionSettings
        view={view}
        action={saveWorkspaceSettingsAction}
        hidden={{ workspaceSlug }}
      />
    </>
  );
}
