import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  calendarDateFormatter,
  sectionClass,
} from "@/components/billing/billing-ui";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import type { PlatformAdminRoleKey } from "@/core/permissions/matrix";
import { withPlatformContext } from "@/core/platform-api/context";
import { listPlatformApiKeys } from "@/core/platform-api/keys";
import {
  PLATFORM_SCOPE_DEFINITIONS,
  roleAllowsScope,
} from "@/core/platform-api/scopes";
import { prisma } from "@/lib/prisma/client";

import {
  CreatePlatformKeyForm,
  RevokePlatformKeyButton,
} from "./platform-key-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformKeys");
  return { title: t("metaTitle") };
}

/**
 * Administrative keys of the platform API and MCP (F4e): each internal role
 * member creates their own, with the scopes their role allows; the platform
 * owner sees and revokes every key.
 */
export default async function PlatformApiKeysPage() {
  const identity = await requirePlatformAdminPage("/platform/api-keys");
  const member = await getPlatformAdminMember(prisma, identity.userId);
  const role = (member?.role ?? null) as PlatformAdminRoleKey | null;
  const keys = await withPlatformContext(
    prisma,
    { userId: identity.userId, keyId: null },
    (tx) => listPlatformApiKeys(tx, { userId: identity.userId, role }),
  );
  const t = await getTranslations("platformKeys");
  const tPlatform = await getTranslations("platform");
  const formatDate = await calendarDateFormatter();
  // Scope texts by id; the Portuguese definitions are the fallback.
  const scopeText = (id: string, field: "label" | "desc", fallback: string) => {
    const key = `scopes.${id.replace(/:/g, "_")}.${field}`;
    return t.has(key) ? t(key) : fallback;
  };
  const scopes = PLATFORM_SCOPE_DEFINITIONS.filter((s) =>
    roleAllowsScope(role, s.id),
  ).map((s) => ({
    id: s.id,
    label: scopeText(s.id, "label", s.label),
    desc: scopeText(s.id, "desc", s.desc),
  }));

  return (
    <div
      className="mx-auto max-w-4xl space-y-6"
      data-testid="platform-api-keys"
    >
      <ModulePageHeader
        trail={[tPlatform("breadcrumb"), t("breadcrumb")]}
        title={t("title")}
        description={t("description")}
        icon={<KeyRound className="h-5 w-5" />}
      />

      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">{t("newKey")}</h2>
        <p className="text-12 text-text-secondary">{t("newKeyHint")}</p>
        <CreatePlatformKeyForm scopes={scopes} />
      </section>

      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">
          {t("keys", { count: keys.length })}
        </h2>
        <ul className="divide-border divide-y" data-testid="platform-key-list">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
              data-testid="platform-key"
            >
              <span className="text-12 text-text-secondary">
                <span className="text-text font-semibold">{key.name}</span> ·{" "}
                <code>{key.prefix}</code> · {key.scopes.join(", ")} ·{" "}
                <span data-testid="platform-key-status">
                  {t(`status.${key.status}`)}
                </span>{" "}
                · {t("expires", { date: formatDate(key.expiresAt) })}
                {key.lastUsedAt
                  ? ` · ${t("lastUsed", { date: formatDate(key.lastUsedAt) })}`
                  : ""}
                {key.mine ? "" : ` · ${t("notMine")}`}
              </span>
              {key.status === "active" ? (
                <RevokePlatformKeyButton keyId={key.id} />
              ) : null}
            </li>
          ))}
          {keys.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">{t("empty")}</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
