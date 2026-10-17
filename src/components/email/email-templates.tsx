import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SettingsCard } from "@/components/settings/settings-shell";
import { Badge } from "@/components/ui/badge";
import type { EmailTemplateActionState } from "@/core/email/template-actions";
import {
  TEMPLATE_LOCALES,
  type EmailTemplatesData,
} from "@/core/email/templates";
import {
  EMAIL_TEMPLATE_EVENTS,
  EMAIL_TEMPLATE_GROUPS,
  emailTemplateDefinition,
  type EmailTemplateDefinition,
} from "@/core/notifications/template-catalog";
import {
  brandFooter,
  notificationTranslator,
  templateValues,
} from "@/core/notifications/templates";
import type {
  NotificationBrand,
  NotificationEvent,
} from "@/core/notifications/types";
import { cn } from "@/lib/utils";

import {
  EmailTemplateEditor,
  type TemplateEditorLabels,
  type TemplateLocaleData,
} from "./email-template-editor";

type Action = (
  prev: EmailTemplateActionState,
  formData: FormData,
) => Promise<EmailTemplateActionState>;

/** Example event of a type, for the preview's values. */
function sampleEvent(
  type: EmailTemplateDefinition["type"],
  sample: Readonly<{
    organization: string;
    partner: string;
    workspace: string;
    agent: string;
  }>,
  origin: string,
): NotificationEvent {
  const base = {
    recipientEmail: "preview@example.com",
    idempotencyKey: "preview",
  };
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const link = (path: string) => new URL(path, origin).toString();
  switch (type) {
    case "invitation.created":
      return {
        ...base,
        type,
        data: {
          inviteUrl: link("/invite/exemplo"),
          organizationName: sample.organization,
          expiresAt: new Date(now + 7 * day),
        },
      };
    case "email.test":
      return { ...base, type, data: { settingsUrl: link("/settings/email") } };
    case "billing.subscription.past_due":
    case "billing.subscription.suspended":
      return {
        ...base,
        type,
        data: {
          partnerName: sample.partner,
          organizationName: sample.organization,
          periodEnd: new Date(now - 3 * day),
          nextStepOn: new Date(now + 7 * day),
          billingUrl: link("/admin/billing"),
        },
      };
    case "workspace.deletion.scheduled":
    case "workspace.deletion.reminder":
    case "workspace.deletion.canceled":
    case "workspace.deletion.completed":
      return {
        ...base,
        type,
        data: {
          workspaceName: sample.workspace,
          purgeAfter: new Date(now + 30 * day),
          appUrl: link("/app"),
        },
      };
    case "ai.agent.key_backup":
    case "ai.agent.key_paused":
      return {
        ...base,
        type,
        data: {
          workspaceName: sample.workspace,
          agentName: sample.agent,
          backupUntil: new Date(now + day),
          credentialsUrl: link("/app/exemplo/settings/credentials"),
        },
      };
  }
}

/**
 * Configurações › E-mail › Modelos (CF3b), at the platform and the partner:
 * the events grouped in a card and, beside it, the editor of the selected
 * event with a tab per language. The page loads one event at a time.
 */
export async function EmailTemplates({
  data,
  level,
  canEdit,
  initialLocale,
  basePath,
  brand,
  origin,
  saveAction,
  restoreAction,
}: Readonly<{
  /** Loaded by the page in its identity context (`loadEmailTemplates`). */
  data: EmailTemplatesData;
  level: "platform" | "partner";
  canEdit: boolean;
  /** `?locale=` of the URL, else the request's language. */
  initialLocale: string;
  basePath: string;
  brand: NotificationBrand;
  origin: string;
  saveAction: Action;
  restoreAction: Action;
}>) {
  const t = await getTranslations("email.templates");
  const definition =
    emailTemplateDefinition(data.eventType) ?? EMAIL_TEMPLATE_EVENTS[0]!;
  const own = data.own;
  const customized = new Set(
    own.map((row) => `${row.eventType}:${row.locale}`),
  );
  const localeName = (code: string) =>
    t.has(`localeNames.${code}`) ? t(`localeNames.${code}`) : code;
  const sample = {
    organization: t("sample.organization"),
    partner: t("sample.partner"),
    workspace: t("sample.workspace"),
    agent: t("sample.agent"),
  };

  const locales: TemplateLocaleData[] = [];
  for (const code of TEMPLATE_LOCALES) {
    const mine = own.find(
      (row) => row.eventType === definition.type && row.locale === code,
    );
    const inherited = data.inherited[code];
    if (!inherited) continue;
    let footer: string[] = [];
    try {
      footer = brandFooter(brand, code);
    } catch {
      footer = [];
    }
    locales.push({
      code,
      label: localeName(code),
      own: mine ? { subject: mine.subject, body: mine.body } : null,
      inherited: { subject: inherited.subject, body: inherited.body },
      inheritedLabel: t(`source.${inherited.source}`),
      sample: templateValues(
        notificationTranslator(code),
        sampleEvent(definition.type, sample, origin),
        brand,
        code,
      ),
      footer,
    });
  }

  const labels: TemplateEditorLabels = {
    subject: t("subject"),
    body: t("body"),
    variables: t("variables"),
    variablesHint: t("variablesHint"),
    preview: t("preview"),
    previewSubject: t("previewSubject"),
    save: t("save"),
    restore: t("restore"),
    restoreTitle: t("restoreTitle"),
    restoreMessage: t(`restoreMessage.${level}`),
    cancel: t("cancel"),
    custom: t("custom"),
    formatHint: t("formatHint"),
    layoutHint: t("layoutHint"),
    readOnly: t("readOnly"),
    toolbar: {
      bold: t("toolbar.bold"),
      italic: t("toolbar.italic"),
      link: t("toolbar.link"),
      bullets: t("toolbar.bullets"),
      numbered: t("toolbar.numbered"),
      heading: t("toolbar.heading"),
    },
    linkText: t("linkText"),
    errors: {
      required: t("errors.required"),
      too_long: t("errors.too_long"),
      newline: t("errors.newline"),
      unknown_tag: t("errors.unknown_tag", { tag: "{tag}" }),
      bad_link: t("errors.bad_link"),
      tag_not_link: t("errors.tag_not_link", { tag: "{tag}" }),
    },
  };

  const href = (type: string) =>
    `${basePath}?event=${encodeURIComponent(type)}`;

  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
      <div className="shrink-0 xl:w-64">
        <SettingsCard title={t("eventsTitle")} testId="email-template-events">
          <nav aria-label={t("eventsTitle")} className="space-y-4">
            {EMAIL_TEMPLATE_GROUPS.map((group) => (
              <div key={group} className="space-y-1">
                <p className="text-11 text-text-tertiary px-2 font-medium tracking-wide uppercase">
                  {t(`groups.${group}`)}
                </p>
                <ul className="space-y-0.5">
                  {EMAIL_TEMPLATE_EVENTS.filter((e) => e.group === group).map(
                    (event) => {
                      const active = event.type === definition.type;
                      const isCustom = TEMPLATE_LOCALES.some((code) =>
                        customized.has(`${event.type}:${code}`),
                      );
                      return (
                        <li key={event.type}>
                          <Link
                            href={href(event.type)}
                            aria-current={active ? "page" : undefined}
                            data-testid={`email-template-event-${event.key}`}
                            className={cn(
                              "text-14 text-text-secondary hover:bg-accent hover:text-accent-foreground flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors",
                              active &&
                                "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
                            )}
                          >
                            <span className="truncate">
                              {t(`events.${event.key}.name`)}
                            </span>
                            {isCustom ? (
                              <Badge variant="secondary">{t("custom")}</Badge>
                            ) : null}
                          </Link>
                        </li>
                      );
                    },
                  )}
                </ul>
              </div>
            ))}
          </nav>
        </SettingsCard>
      </div>

      <div className="min-w-0 flex-1">
        <SettingsCard
          title={t(`events.${definition.key}.name`)}
          description={`${t(`events.${definition.key}.description`)} ${
            definition.essential ? t("essential") : ""
          }`.trim()}
          testId="email-template"
        >
          <EmailTemplateEditor
            key={definition.type}
            eventType={definition.type}
            variables={definition.variables.map((variable) => ({
              ...variable,
              description: t(`variableNames.${variable.name}`),
            }))}
            locales={locales}
            initialLocale={
              TEMPLATE_LOCALES.includes(initialLocale)
                ? initialLocale
                : TEMPLATE_LOCALES[0]!
            }
            brand={{ name: brand.name }}
            canEdit={canEdit}
            saveAction={saveAction}
            restoreAction={restoreAction}
            labels={labels}
          />
        </SettingsCard>
      </div>
    </div>
  );
}
