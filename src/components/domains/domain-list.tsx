import { getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import { Badge } from "@/components/ui/badge";
import {
  primaryWorkspaceDomainAction,
  verifyPartnerDomainAction,
  verifyWorkspaceDomainAction,
} from "@/core/domains/actions";
import type { DomainView } from "@/core/domains/service";

import { RemoveDomainButton } from "./remove-domain-button";

/** Error codes of `last_error` with a message (CF2b). */
const CHECK_MESSAGES = new Set([
  "not_configured",
  "dns_pending",
  "ssl_pending",
  "ssl_error",
  "cloudflare_error",
]);

/**
 * Domains of a level with their state, the CNAME instructions while pending
 * and the actions of a manager (CF2b). `kind` selects the actions: partner
 * dashboard domains by host, workspace domains by id.
 */
export async function DomainList({
  domains,
  kind,
  canManage,
  cnameTarget,
  hidden = {},
  testId = "domain-list",
}: Readonly<{
  domains: readonly DomainView[];
  kind: "partner" | "workspace";
  canManage: boolean;
  cnameTarget: string | null;
  /** Extra form fields, e.g. the workspace slug of /app. */
  hidden?: Readonly<Record<string, string>>;
  testId?: string;
}>) {
  const t = await getTranslations("domains");
  if (domains.length === 0) return null;

  const hiddenInputs = (key: string, value: string) => (
    <>
      <input type="hidden" name={key} value={value} />
      {Object.entries(hidden).map(([name, val]) => (
        <input key={name} type="hidden" name={name} value={val} />
      ))}
    </>
  );
  const idField = kind === "partner" ? "host" : "domainId";

  return (
    <ul
      className="border-card-border divide-border divide-y rounded-lg border"
      data-testid={testId}
    >
      {domains.map((domain) => {
        const managed = canManage && domain.kind === "custom";
        const pending = domain.status === "pending";
        const ref = kind === "partner" ? domain.host : domain.id;
        return (
          <li
            key={domain.id}
            className="space-y-3 p-4"
            data-testid="domain-row"
            data-host={domain.host}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-14 text-text font-mono font-medium break-all">
                {domain.host}
              </span>
              <Badge
                variant={domain.status === "active" ? "default" : "secondary"}
                data-testid="domain-status"
              >
                {t(`status.${domain.status}` as "status.pending")}
              </Badge>
              {domain.isPrimary ? (
                <Badge variant="outline">{t("status.primary")}</Badge>
              ) : null}
              {domain.kind === "subdomain" ? (
                <Badge variant="outline">{t("status.subdomain")}</Badge>
              ) : null}
              {domain.sslStatus !== "none" ? (
                <span className="text-12 text-text-secondary">
                  {t(`ssl.${domain.sslStatus}` as "ssl.pending")}
                </span>
              ) : null}
            </div>

            {pending && domain.kind === "custom" ? (
              <div className="bg-surface-raised text-12 text-text-secondary space-y-1 rounded-md p-3">
                <p className="text-text font-medium">
                  {t("instructions.title")}
                </p>
                <p data-testid="domain-instructions">
                  {cnameTarget
                    ? t("instructions.cname", {
                        host: domain.host,
                        target: cnameTarget,
                      })
                    : t("instructions.noTarget")}
                </p>
                {domain.lastError && CHECK_MESSAGES.has(domain.lastError) ? (
                  <p data-testid="domain-last-check">
                    {t(`messages.${domain.lastError}` as "messages.active")}
                  </p>
                ) : null}
              </div>
            ) : null}

            {managed ? (
              <div className="flex flex-wrap items-center gap-2">
                {pending ? (
                  <ActionForm
                    action={
                      kind === "partner"
                        ? verifyPartnerDomainAction
                        : verifyWorkspaceDomainAction
                    }
                    submitLabel={t("form.verify")}
                    testId="domain-verify"
                  >
                    {hiddenInputs(idField, ref)}
                  </ActionForm>
                ) : null}
                {kind === "workspace" &&
                domain.status === "active" &&
                !domain.isPrimary ? (
                  <ActionForm
                    action={primaryWorkspaceDomainAction}
                    submitLabel={t("form.makePrimary")}
                    tone="neutral"
                    testId="domain-primary"
                  >
                    {hiddenInputs(idField, ref)}
                  </ActionForm>
                ) : null}
                <RemoveDomainButton
                  kind={kind}
                  fields={{ ...hidden, [idField]: ref }}
                  labels={{
                    remove: t("form.remove"),
                    title: t("form.removeTitle", { host: domain.host }),
                    message: t("form.removeMessage"),
                    cancel: t("form.cancel"),
                  }}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
