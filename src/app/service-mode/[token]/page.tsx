import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import { ManagedScope } from "@/components/service-modes/managed-scope";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getRequestBrand } from "@/core/brand/resolve";
import { getRequestPartner } from "@/core/partners/resolve";
import { decideServiceModeLinkAction } from "@/core/service-modes/actions";
import { readRequestByToken } from "@/core/service-modes/service";
import { prisma } from "@/lib/prisma/client";
import { withPartnerContext } from "@/lib/prisma/with-partner-context";
import { AuthShell, ErrorNotice, SuccessNotice } from "@/shared/ui/auth-shell";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("serviceMode.link");
  return { title: t("metaTitle"), referrer: "no-referrer" };
}

/**
 * Secure link of a request for the managed mode (GB1c, ADR 0020): public,
 * outside the shell, with the brand of the host's partner. The token is
 * single use and valid for 7 days; the decision keeps when, how, the IP
 * and the user agent as proof of consent.
 */
export default async function ServiceModeLinkPage({
  params,
}: Readonly<{ params: Promise<{ token: string }> }>) {
  const { token } = await params;
  const brand = await getRequestBrand();
  const partner = await getRequestPartner();
  const t = await getTranslations("serviceMode.link");
  const format = await getFormatter();
  const request = partner
    ? await withPartnerContext(prisma, partner.partnerId, (tx) =>
        readRequestByToken(tx, token),
      )
    : null;

  if (!request) {
    return (
      <AuthShell title={t("notFoundTitle")} brand={brand}>
        <ErrorNotice testId="service-mode-link-not-found">
          {t("notFound")}
        </ErrorNotice>
      </AuthShell>
    );
  }

  const partnerName = request.partnerName || brand.name;
  const names = {
    partner: partnerName,
    organization: request.organizationName,
  };

  if (request.status !== "pending") {
    const key =
      request.status === "approved"
        ? "approved"
        : request.status === "denied"
          ? "denied"
          : request.status === "cancelled"
            ? "cancelled"
            : "expired";
    const Notice = key === "approved" ? SuccessNotice : ErrorNotice;
    return (
      <AuthShell title={t(`${key}Title`)} brand={brand}>
        <Notice testId={`service-mode-link-${key}`}>{t(key, names)}</Notice>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("title")}
      description={t("description", names)}
      brand={brand}
    >
      <Card variant="surface" className="px-4" data-testid="service-mode-link">
        <CardContent className="flex flex-col gap-4 px-0">
          <div>
            <Badge variant="warning">{request.workspaceName}</Badge>
          </div>
          <ManagedScope />
          <p className="text-12 text-text-secondary">
            {t("expires", {
              date: format.dateTime(request.expiresAt, {
                dateStyle: "short",
                timeStyle: "short",
              }),
            })}
          </p>
          <p className="text-12 text-text-secondary">{t("consent")}</p>
          <div className="flex flex-wrap gap-2">
            {(["approve", "deny"] as const).map((decision) => (
              <ActionForm
                key={decision}
                action={decideServiceModeLinkAction}
                submitLabel={t(decision)}
                tone={decision === "approve" ? "primary" : "neutral"}
                testId={`service-mode-link-${decision}`}
              >
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="decision" value={decision} />
              </ActionForm>
            ))}
          </div>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
