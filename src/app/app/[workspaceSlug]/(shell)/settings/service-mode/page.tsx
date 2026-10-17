import type { Metadata } from "next";
import { Handshake } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { KeyValueList } from "@/components/patterns/key-value-list";
import { PageTitle } from "@/components/patterns/page-title";
import { ActionForm } from "@/components/partners/action-form";
import { ManagedScope } from "@/components/service-modes/managed-scope";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUserPage } from "@/core/auth/page-guard";
import { getRequestBrand } from "@/core/brand/resolve";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import {
  decideServiceModeAppAction,
  revertServiceModeAction,
} from "@/core/service-modes/actions";
import { readWorkspaceServiceMode } from "@/core/service-modes/service";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("serviceMode.settings");
  return { title: t("metaTitle") };
}

const SOURCES = new Set(["registration", "request", "customer", "partner"]);

/**
 * Workspace › Configurações › Modo de serviço (GB1c, ADR 0020): the mode
 * of the company, a pending request to approve or deny and the way back
 * to `padrao`. Every member reads; only the company owner decides.
 */
export default async function ServiceModeSettingsPage({
  params,
}: Readonly<{ params: Promise<{ workspaceSlug: string }> }>) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/service-mode`,
  );
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  const view = await withContext(prisma, context, (tx) =>
    readWorkspaceServiceMode(tx, context),
  );
  const t = await getTranslations("serviceMode");
  const format = await getFormatter();
  const brand = await getRequestBrand();
  const manager =
    view.partnerName ?? (view.requestedVia === "platform" ? brand.name : "—");

  const items = [
    {
      label: t("settings.mode"),
      value: (
        <Badge
          variant={view.mode === "gerenciado" ? "info" : "neutral"}
          data-testid="service-mode-current"
        >
          {t(`modes.${view.mode}`)}
        </Badge>
      ),
    },
    ...(view.mode === "gerenciado"
      ? [{ label: t("settings.managedBy"), value: manager }]
      : []),
    ...(view.since
      ? [
          {
            label: t("settings.since"),
            value: format.dateTime(view.since, { dateStyle: "short" }),
          },
        ]
      : []),
    ...(view.source && SOURCES.has(view.source)
      ? [{ label: t("settings.how"), value: t(`sources.${view.source}`) }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        icon={<Handshake className="size-6" />}
        title={t("settings.title")}
        description={t("settings.description")}
      />

      <Card variant="surface" className="px-4 sm:px-6">
        <CardHeader className="px-0">
          <CardTitle className="text-16">
            {t("settings.currentTitle")}
          </CardTitle>
          {view.mode === "padrao" ? (
            <CardDescription>{t("settings.standardNote")}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="px-0">
          <KeyValueList items={items} />
        </CardContent>
      </Card>

      {view.pending ? (
        <Card
          variant="surface"
          className="px-4 sm:px-6"
          data-testid="service-mode-pending"
        >
          <CardHeader className="px-0">
            <CardTitle className="text-16">
              {t("settings.pendingTitle")}
            </CardTitle>
            <CardDescription>
              {t("settings.pendingDescription", {
                partner: manager,
                date: format.dateTime(view.pending.expiresAt, {
                  dateStyle: "short",
                  timeStyle: "short",
                }),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-0">
            <ManagedScope />
            {view.canManage ? (
              <div className="flex flex-wrap gap-2">
                {(["approve", "deny"] as const).map((decision) => (
                  <ActionForm
                    key={decision}
                    action={decideServiceModeAppAction}
                    submitLabel={t(`settings.${decision}`)}
                    tone={decision === "approve" ? "primary" : "neutral"}
                    testId={`service-mode-${decision}`}
                  >
                    <input
                      type="hidden"
                      name="workspaceSlug"
                      value={workspaceSlug}
                    />
                    <input
                      type="hidden"
                      name="requestId"
                      value={view.pending!.id}
                    />
                    <input type="hidden" name="decision" value={decision} />
                  </ActionForm>
                ))}
              </div>
            ) : (
              <p className="text-12 text-text-secondary">
                {t("settings.ownerOnly")}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view.mode === "gerenciado" ? (
        <Card
          variant="surface"
          className="px-4 sm:px-6"
          data-testid="service-mode-back"
        >
          <CardHeader className="px-0">
            <CardTitle className="text-16">{t("settings.backTitle")}</CardTitle>
            <CardDescription>{t("settings.backDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-0">
            <ManagedScope />
            {view.canManage ? (
              <ActionForm
                action={revertServiceModeAction}
                submitLabel={t("settings.back")}
                tone="neutral"
              >
                <input
                  type="hidden"
                  name="workspaceSlug"
                  value={workspaceSlug}
                />
              </ActionForm>
            ) : (
              <p className="text-12 text-text-secondary">
                {t("settings.ownerOnly")}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
