import type { Metadata } from "next";
import { Plug } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  GoogleConnectButton,
  GoogleReturnStatus,
} from "@/components/integrations/google-connect-button";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { InfoList } from "@/components/settings/info-list";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Badge } from "@/components/ui/badge";
import { requireUserPage } from "@/core/auth/page-guard";
import {
  connectGoogleAction,
  disconnectGoogleAction,
} from "@/core/integrations/google/actions";
import { googleWorkspaceView } from "@/core/integrations/google/connection";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("integrations");
  return { title: t("workspace.metaTitle") };
}

const RESULTS = ["connected", "denied", "invalid", "failed"] as const;
const scopeKey = (scope: string) => scope.replace(/\./g, "_");

/**
 * Workspace › Configurações › Integrações (CF6b, plano G1): owner and admin
 * connect and disconnect the workspace's Google account by OAuth. The page
 * shows the account and the scopes granted; tokens never reach it. The
 * GUIDS tools that use the account come with the G1.
 */
export default async function WorkspaceIntegrationsPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ google?: string }>;
}>) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/integrations`,
  );
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  const view = await withContext(prisma, context, (tx) =>
    googleWorkspaceView(tx, context),
  );
  const t = await getTranslations("integrations");
  const format = await getFormatter();
  const header = (
    <ModulePageHeader
      title={t("workspace.title")}
      description={t("workspace.description")}
      icon={<Plug className="h-5 w-5" />}
    />
  );
  if (!view.canManage) {
    return (
      <>
        {header}
        <ModuleNotice variant="denied" />
      </>
    );
  }

  const { google } = await searchParams;
  const result = (RESULTS as readonly string[]).includes(google ?? "")
    ? (google as (typeof RESULTS)[number])
    : null;
  const status = result
    ? result === "connected"
      ? { message: t("workspace.result.connected") }
      : { error: t(`workspace.result.${result}`) }
    : null;
  const connection = view.connection;

  return (
    <>
      {header}
      <GoogleReturnStatus result={status} />
      <SettingsCard
        title={t("workspace.google.title")}
        description={t("workspace.google.description")}
        testId="google-connection"
      >
        <InfoList
          items={[
            {
              label: t("workspace.google.account"),
              value: connection ? connection.email : t("workspace.google.none"),
              testId: "google-account",
            },
            {
              label: t("workspace.google.app"),
              value: view.app
                ? t(`workspace.google.appSource.${view.app.source}`)
                : t("workspace.google.noApp"),
              testId: "google-app-source",
            },
            ...(connection
              ? [
                  {
                    label: t("workspace.google.connectedAt"),
                    value: format.dateTime(connection.connectedAt, {
                      dateStyle: "short",
                      timeStyle: "short",
                    }),
                  },
                ]
              : []),
            {
              label: connection
                ? t("workspace.google.grantedScopes")
                : t("workspace.google.offeredScopes"),
              value: (
                <span
                  className="flex flex-wrap gap-1"
                  data-testid="google-scopes-list"
                >
                  {(connection ? connection.scopes : view.scopes).length ===
                  0 ? (
                    <span>{t("workspace.google.noScopes")}</span>
                  ) : (
                    (connection ? connection.scopes : view.scopes).map(
                      (scope) => (
                        <Badge key={scope} variant="outline">
                          {t(`google.scope.${scopeKey(scope)}.label`)}
                        </Badge>
                      ),
                    )
                  )}
                </span>
              ),
            },
          ]}
        />
        {view.blocked ? (
          <p
            className="text-12 text-text-secondary"
            data-testid="google-blocked"
          >
            {t(`workspace.google.blocked.${view.blocked}`)}
          </p>
        ) : null}
        {view.app && view.app.verificationStatus !== "verified" ? (
          <p className="text-12 text-text-secondary">
            {t("workspace.google.unverified")}
          </p>
        ) : null}
        <div className="flex flex-wrap items-start gap-2">
          <GoogleConnectButton
            action={connectGoogleAction}
            workspaceSlug={workspaceSlug}
            label={
              connection
                ? t("workspace.google.reconnect")
                : t("workspace.google.connect")
            }
            pendingLabel={t("workspace.google.redirecting")}
            disabled={view.blocked !== null}
          />
          {/* Always mounted: the result of a disconnect still shows after
              the page loses the connection. */}
          <ActionForm
            action={disconnectGoogleAction}
            submitLabel={t("workspace.google.disconnect")}
            tone="neutral"
            testId="google-disconnect"
            disabled={!connection}
          >
            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          </ActionForm>
        </div>
      </SettingsCard>
    </>
  );
}
