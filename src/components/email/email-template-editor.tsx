"use client";

import {
  Bold,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  RotateCcw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useActionState,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { useStatus } from "@/components/feedback/status-context";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { EmailTemplateActionState } from "@/core/email/template-actions";
import {
  BODY_MAX,
  fillSubject,
  parseMarkup,
  SUBJECT_MAX,
  validateTemplate,
  type TemplateIssue,
  type TemplateValues,
  type TemplateVariable,
} from "@/core/notifications/markup";
import type { EmailTemplateContent } from "@/core/notifications/template-catalog";

import { MarkupPreview } from "./markup-preview";

type Action = (
  prev: EmailTemplateActionState,
  formData: FormData,
) => Promise<EmailTemplateActionState>;

const INITIAL: EmailTemplateActionState = {};

const TOOLBAR = [
  { key: "bold", icon: Bold },
  { key: "italic", icon: Italic },
  { key: "link", icon: Link2 },
  { key: "bullets", icon: List },
  { key: "numbered", icon: ListOrdered },
  { key: "heading", icon: Heading2 },
] as const;

/** One language tab: what the level saved and what it inherits. */
export type TemplateLocaleData = Readonly<{
  code: string;
  label: string;
  own: EmailTemplateContent | null;
  inherited: EmailTemplateContent;
  /** Where the inherited template comes from, already translated. */
  inheritedLabel: string;
  /** Example values of the event's variables, in this language. */
  sample: TemplateValues;
  /** Support lines of the brand footer, in this language. */
  footer: readonly string[];
}>;

export type TemplateVariableData = TemplateVariable &
  Readonly<{ description: string }>;

/** Texts of the editor, translated on the server (`email` stays server-only). */
export type TemplateEditorLabels = Readonly<{
  subject: string;
  body: string;
  variables: string;
  variablesHint: string;
  preview: string;
  previewSubject: string;
  save: string;
  restore: string;
  restoreTitle: string;
  restoreMessage: string;
  cancel: string;
  custom: string;
  formatHint: string;
  layoutHint: string;
  readOnly: string;
  toolbar: Readonly<{
    bold: string;
    italic: string;
    link: string;
    bullets: string;
    numbered: string;
    heading: string;
  }>;
  linkText: string;
  /** By issue code; `{tag}` is replaced by the tag's name. */
  errors: Readonly<Record<TemplateIssue["code"], string>>;
}>;

type Field = "subject" | "body";

function issueMessage(
  labels: TemplateEditorLabels,
  issue: TemplateIssue | undefined,
): string | undefined {
  return issue
    ? labels.errors[issue.code].replace("{tag}", issue.tag ?? "")
    : undefined;
}

function FieldError({ message }: Readonly<{ message: string | undefined }>) {
  return message ? (
    <p className="text-11 text-destructive" role="alert">
      {message}
    </p>
  ) : null;
}

/**
 * Editor of one event's template (CF3b): a tab per language with subject,
 * body (simple format with a small toolbar, never HTML), the event's
 * variables, a live preview with the brand's header and footer, Salvar and
 * Restaurar para o padrão.
 */
export function EmailTemplateEditor({
  eventType,
  variables,
  locales,
  initialLocale,
  brand,
  canEdit,
  saveAction,
  restoreAction,
  labels,
}: Readonly<{
  eventType: string;
  variables: readonly TemplateVariableData[];
  locales: readonly TemplateLocaleData[];
  initialLocale: string;
  brand: Readonly<{ name: string }>;
  canEdit: boolean;
  saveAction: Action;
  restoreAction: Action;
  labels: TemplateEditorLabels;
}>) {
  const [locale, setLocale] = useState(initialLocale);
  const [drafts, setDrafts] = useState<Record<string, EmailTemplateContent>>(
    () =>
      Object.fromEntries(
        locales.map((l) => [l.code, l.own ?? l.inherited] as const),
      ),
  );
  const [restored, setRestored] = useState<Record<string, boolean>>({});

  return (
    <Tabs
      value={locale}
      onValueChange={setLocale}
      data-testid="email-template-editor"
    >
      <TabsList>
        {locales.map((l) => (
          <TabsTrigger
            key={l.code}
            value={l.code}
            data-testid={`template-locale-${l.code}`}
          >
            {l.label}
            {l.own && !restored[l.code] ? (
              <span
                aria-hidden
                className="bg-primary size-1.5 rounded-full"
                title={labels.custom}
              />
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {locales.map((l) => (
        <TabsContent key={l.code} value={l.code} className="pt-2">
          <LocaleEditor
            eventType={eventType}
            data={l}
            draft={drafts[l.code] ?? l.inherited}
            onChange={(next) =>
              setDrafts((current) => ({ ...current, [l.code]: next }))
            }
            onRestored={() => {
              setDrafts((current) => ({ ...current, [l.code]: l.inherited }));
              setRestored((current) => ({ ...current, [l.code]: true }));
            }}
            onSaved={() =>
              setRestored((current) => ({ ...current, [l.code]: false }))
            }
            isCustom={Boolean(l.own) && !restored[l.code]}
            variables={variables}
            brand={brand}
            canEdit={canEdit}
            saveAction={saveAction}
            restoreAction={restoreAction}
            labels={labels}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function LocaleEditor({
  eventType,
  data,
  draft,
  onChange,
  onRestored,
  onSaved,
  isCustom,
  variables,
  brand,
  canEdit,
  saveAction,
  restoreAction,
  labels,
}: Readonly<{
  eventType: string;
  data: TemplateLocaleData;
  draft: EmailTemplateContent;
  onChange: (next: EmailTemplateContent) => void;
  onRestored: () => void;
  onSaved: () => void;
  isCustom: boolean;
  variables: readonly TemplateVariableData[];
  brand: Readonly<{ name: string }>;
  canEdit: boolean;
  saveAction: Action;
  restoreAction: Action;
  labels: TemplateEditorLabels;
}>) {
  const tCommon = useTranslations("common");
  const { confirmStatus, showStatus } = useStatus();
  const [restoring, startRestore] = useTransition();
  const [state, formAction, saving] = useActionState(
    async (prev: EmailTemplateActionState, formData: FormData) => {
      const result = await saveAction(prev, formData);
      if (result.success) onSaved();
      return result;
    },
    INITIAL,
  );
  useActionStatus(state === INITIAL ? null : state);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastField = useRef<Field>("body");

  const issues = useMemo(
    () => validateTemplate(draft, variables),
    [draft, variables],
  );
  const issueOf = (field: Field) =>
    issueMessage(
      labels,
      issues.find((issue) => issue.field === field),
    ) ?? state.fieldErrors?.[field];
  const blocks = useMemo(() => parseMarkup(draft.body), [draft.body]);
  const id = `template-${data.code}`;

  /** Replaces the selection of a field and keeps the cursor after it. */
  function edit(
    field: Field,
    change: (
      value: string,
      start: number,
      end: number,
    ) => { value: string; start: number; end: number },
  ) {
    const element = field === "subject" ? subjectRef.current : bodyRef.current;
    const value = draft[field];
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    const next = change(value, start, end);
    onChange({ ...draft, [field]: next.value });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(next.start, next.end);
    });
  }

  const wrap = (marker: string) =>
    edit("body", (value, start, end) => {
      const selected = value.slice(start, end);
      return {
        value: `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`,
        start: start + marker.length,
        end: end + marker.length,
      };
    });

  const prefixLines = (prefix: (index: number) => string) =>
    edit("body", (value, start, end) => {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const selected = value.slice(lineStart, end);
      const lines = selected
        .split("\n")
        .map((line, index) => `${prefix(index)}${line}`)
        .join("\n");
      return {
        value: `${value.slice(0, lineStart)}${lines}${value.slice(end)}`,
        start: lineStart,
        end: lineStart + lines.length,
      };
    });

  const insertLink = () =>
    edit("body", (value, start, end) => {
      const label = value.slice(start, end) || labels.linkText;
      const hasLinkTag = variables.some((v) => v.kind === "url");
      const target = hasLinkTag ? "{{link}}" : "https://";
      const inserted = `[${label}](${target})`;
      return {
        value: `${value.slice(0, start)}${inserted}${value.slice(end)}`,
        // Select the address, ready to be replaced.
        start: start + label.length + 3,
        end: start + label.length + 3 + target.length,
      };
    });

  const insertTag = (name: string) =>
    edit(lastField.current, (value, start, end) => {
      const tag = `{{${name}}}`;
      return {
        value: `${value.slice(0, start)}${tag}${value.slice(end)}`,
        start: start + tag.length,
        end: start + tag.length,
      };
    });

  async function onRestore() {
    const confirmed = await confirmStatus({
      title: labels.restoreTitle,
      message: labels.restoreMessage,
      confirmLabel: labels.restore,
      cancelLabel: labels.cancel,
      tone: "destructive",
    });
    if (!confirmed) return;
    startRestore(async () => {
      const formData = new FormData();
      formData.append("eventType", eventType);
      formData.append("locale", data.code);
      const result = await restoreAction({}, formData);
      if (result.error) {
        showStatus({
          type: "down",
          title: result.error,
          ...(result.requestId
            ? {
                message: tCommon("reference", {
                  id: result.requestId.slice(0, 8),
                }),
              }
            : {}),
        });
        return;
      }
      onRestored();
      showStatus({ type: "up", title: result.message ?? tCommon("saved") });
    });
  }

  function runTool(key: (typeof TOOLBAR)[number]["key"]) {
    switch (key) {
      case "bold":
        return wrap("**");
      case "italic":
        return wrap("*");
      case "link":
        return insertLink();
      case "bullets":
        return prefixLines(() => "- ");
      case "numbered":
        return prefixLines((index) => `${index + 1}. `);
      case "heading":
        return prefixLines(() => "## ");
    }
  }

  return (
    <div className="grid gap-6 2xl:grid-cols-2">
      <form
        action={formAction}
        className="min-w-0 space-y-4"
        data-testid="email-template-form"
      >
        <input type="hidden" name="eventType" value={eventType} />
        <input type="hidden" name="locale" value={data.code} />
        <div className="text-12 text-text-secondary flex flex-wrap items-center gap-2">
          {isCustom ? (
            <Badge variant="secondary" data-testid="template-custom">
              {labels.custom}
            </Badge>
          ) : (
            <span data-testid="template-inherited">{data.inheritedLabel}</span>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${id}-subject`} className="text-12">
            {labels.subject}
          </Label>
          <Input
            ref={subjectRef}
            id={`${id}-subject`}
            name="subject"
            value={draft.subject}
            maxLength={SUBJECT_MAX}
            readOnly={!canEdit}
            onFocus={() => (lastField.current = "subject")}
            onChange={(e) => onChange({ ...draft, subject: e.target.value })}
            aria-invalid={Boolean(issueOf("subject")) || undefined}
          />
          <FieldError message={issueOf("subject")} />
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${id}-body`} className="text-12">
            {labels.body}
          </Label>
          {canEdit ? (
            <div
              className="flex flex-wrap gap-1"
              role="toolbar"
              aria-label={labels.body}
            >
              {TOOLBAR.map(({ key, icon: Icon }) => (
                <Button
                  key={key}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title={labels.toolbar[key]}
                  aria-label={labels.toolbar[key]}
                  onClick={() => runTool(key)}
                >
                  <Icon />
                </Button>
              ))}
            </div>
          ) : null}
          <Textarea
            ref={bodyRef}
            id={`${id}-body`}
            name="body"
            value={draft.body}
            rows={12}
            maxLength={BODY_MAX}
            readOnly={!canEdit}
            className="text-12 font-mono"
            onFocus={() => (lastField.current = "body")}
            onChange={(e) => onChange({ ...draft, body: e.target.value })}
            aria-invalid={Boolean(issueOf("body")) || undefined}
          />
          <FieldError message={issueOf("body")} />
          <p className="text-11 text-text-secondary">{labels.formatHint}</p>
        </div>

        <div className="space-y-2" data-testid="template-variables">
          <p className="text-12 font-medium">{labels.variables}</p>
          <p className="text-11 text-text-secondary">{labels.variablesHint}</p>
          <ul className="space-y-1">
            {variables.map((variable) => (
              <li
                key={variable.name}
                className="text-12 flex flex-wrap items-baseline gap-2"
              >
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="font-mono"
                  disabled={!canEdit}
                  onClick={() => insertTag(variable.name)}
                >
                  {`{{${variable.name}}}`}
                </Button>
                <span className="text-text-secondary">
                  {variable.description}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={saving || issues.length > 0}
              data-testid="template-save"
            >
              {saving ? tCommon("saving") : labels.save}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!isCustom || restoring}
              onClick={onRestore}
              data-testid="template-restore"
            >
              <RotateCcw />
              {labels.restore}
            </Button>
          </div>
        ) : (
          <p className="text-12 text-text-secondary">{labels.readOnly}</p>
        )}
      </form>

      <section
        className="border-card-border bg-surface-raised min-w-0 space-y-3 rounded-lg border p-4"
        aria-label={labels.preview}
        data-testid="template-preview"
      >
        <p className="text-11 text-text-tertiary font-medium tracking-wide uppercase">
          {labels.preview}
        </p>
        <p className="text-12 text-text-secondary">
          {labels.previewSubject}{" "}
          <span className="text-text font-medium" data-testid="preview-subject">
            {fillSubject(draft.subject, data.sample)}
          </span>
        </p>
        <div className="bg-surface-card space-y-3 rounded-md border p-4">
          <p className="text-14 text-primary font-semibold">{brand.name}</p>
          <MarkupPreview blocks={blocks} values={data.sample} />
          {data.footer.length > 0 ? (
            <div className="text-11 text-text-secondary space-y-0.5 border-t pt-2">
              {data.footer.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}
        </div>
        <p className="text-11 text-text-secondary">{labels.layoutHint}</p>
      </section>
    </div>
  );
}
