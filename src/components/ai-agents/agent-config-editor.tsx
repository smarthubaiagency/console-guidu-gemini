"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  type ConfigEditor,
  type ConfigTab,
  editableFields,
  editableTabs,
} from "@/core/ai/config/editing";
import {
  AFTER_HOURS_BEHAVIORS,
  AGENT_LANGUAGES,
  AGENT_TONES,
  HANDOFF_MODES,
  LEAD_DESTINATIONS,
  MODEL_PROVIDERS,
  NOTIFY_CHANNELS,
  OUT_OF_SCOPE_ACTIONS,
  WEEKDAYS,
} from "@/core/ai/config/schema";
import {
  AGENT_TOOL_IDS,
  isSystemTool,
  type AgentKind,
  toolAllowedFor,
} from "@/core/ai/config/tools";
import { voiceOptions } from "@/core/ai/media";
import {
  type AiPolicy,
  modelsOf,
  modelWarning,
  providerAllowed,
} from "@/core/ai/models";

/**
 * Editor of an agent's configuration (A3a, campos.md): the five tabs of the
 * legacy, with only the tabs and fields the editor may change (§5.2). The
 * whole document goes in one hidden field (`name`), as JSON; the service
 * validates it again and refuses a field outside the division. Errors of
 * the server come back by `tab.field` and stay next to each field.
 */

type Doc = Record<ConfigTab, Record<string, unknown>>;

export type EditorCredential = Readonly<{
  id: string;
  label: string;
  provider: string;
  /** What the vault lets the key do; none: everything. */
  purpose?: "all" | "chat" | "embeddings";
}>;

/** A new scoring rule keeps this mark until saved: its id follows the label. */
const NEW_RULE = "__new";

function slug(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50) || "regra"
  );
}

function asDoc(value: unknown): Doc {
  const raw = (value ?? {}) as Record<string, unknown>;
  const tab = (key: ConfigTab) => ({
    ...((raw[key] as Record<string, unknown> | undefined) ?? {}),
  });
  return {
    overview: tab("overview"),
    scope: tab("scope"),
    rules: tab("rules"),
    integration: tab("integration"),
    model: tab("model"),
  };
}

/** The document without the editor's own marks. */
function serialize(doc: Doc): string {
  const rules = doc.rules.lead_scoring_rules;
  return JSON.stringify({
    ...doc,
    rules: {
      ...doc.rules,
      ...(Array.isArray(rules)
        ? {
            lead_scoring_rules: rules.map((rule) =>
              Object.fromEntries(
                Object.entries(rule as Record<string, unknown>).filter(
                  ([key]) => key !== NEW_RULE,
                ),
              ),
            ),
          }
        : {}),
    },
  });
}

type Row = Record<string, unknown>;

export function AgentConfigEditor({
  initial,
  editor,
  agentKind,
  fieldErrors,
  credentials = [],
  policy,
  name = "config",
}: Readonly<{
  initial: unknown;
  editor: ConfigEditor;
  agentKind: AgentKind;
  fieldErrors?: Readonly<Record<string, string>> | undefined;
  /** Keys the agent may use, for the model tab (not in templates). */
  credentials?: readonly EditorCredential[];
  /**
   * Providers and models of the context (CF6a): the model becomes a list
   * of the key's provider; none keeps the free text.
   */
  policy?: AiPolicy | undefined;
  name?: string;
}>) {
  const t = useTranslations("aiConsole.editor");
  const [doc, setDoc] = useState<Doc>(() => asDoc(initial));
  const fields = useMemo(() => editableFields(editor), [editor]);
  const tabs = useMemo(() => editableTabs(editor), [editor]);
  const errors = fieldErrors ?? {};

  const can = (tab: ConfigTab, field: string) => fields.has(`${tab}.${field}`);
  const get = (tab: ConfigTab, field: string) => doc[tab][field];
  const set = (tab: ConfigTab, field: string, value: unknown) =>
    setDoc((prev) => {
      const next = { ...prev[tab] };
      if (value === undefined) delete next[field];
      else next[field] = value;
      return { ...prev, [tab]: next };
    });
  /** The first error at this path or below it. */
  const errorAt = (path: string) =>
    Object.entries(errors).find(
      ([key]) => key === path || key.startsWith(`${path}.`),
    )?.[1];
  const tabHasError = (tab: ConfigTab) =>
    Object.keys(errors).some((key) => key.startsWith(`${tab}.`));

  const fieldId = (tab: ConfigTab, field: string) => `cfg-${tab}-${field}`;

  // The model tab's keys (A5d): text and voice keys chat, the embeddings
  // key embeds. The voice is the voice key's, or the text key's when it
  // speaks.
  const chatKeys = credentials.filter((key) => key.purpose !== "embeddings");
  const embeddingKeys = credentials.filter((key) => key.purpose !== "chat");
  const providerOf = (field: string) =>
    credentials.find((key) => key.id === get("model", field))?.provider ?? null;
  const textProvider =
    providerOf("credential_id") ??
    ((get("model", "model_provider") as string | undefined) || null);
  const textSpeaks = textProvider ? voiceOptions(textProvider) !== null : false;
  const voiceKeyProvider = providerOf("audio_credential_id");
  const speech = voiceKeyProvider
    ? voiceOptions(voiceKeyProvider)
    : textProvider
      ? voiceOptions(textProvider)
      : null;
  const voiceWarning = !can("model", "audio_credential_id")
    ? null
    : voiceKeyProvider
      ? speech
        ? null
        : t("model.voiceKeyNoVoice")
      : textProvider && !textSpeaks
        ? t("model.noVoice")
        : null;

  function wrap(tab: ConfigTab, field: string, children: React.ReactNode) {
    const error = errorAt(`${tab}.${field}`);
    return (
      <div className="space-y-1" data-field={`${tab}.${field}`}>
        <Label htmlFor={fieldId(tab, field)} className="text-12">
          {t(`fields.${field}`)}
        </Label>
        {children}
        {error ? (
          <p className="text-11 text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  function textField({
    tab,
    field,
    max,
    rows,
    placeholder,
  }: Readonly<{
    tab: ConfigTab;
    field: string;
    max: number;
    rows?: number;
    placeholder?: string;
  }>) {
    if (!can(tab, field)) return null;
    const value = (get(tab, field) as string | undefined) ?? "";
    const props = {
      id: fieldId(tab, field),
      value,
      maxLength: max,
      placeholder,
      "aria-invalid": Boolean(errorAt(`${tab}.${field}`)) || undefined,
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => set(tab, field, e.target.value === "" ? undefined : e.target.value),
    };
    return wrap(
      tab,
      field,
      rows ? <Textarea rows={rows} {...props} /> : <Input {...props} />,
    );
  }

  function selectField({
    tab,
    field,
    options,
    labels,
  }: Readonly<{
    tab: ConfigTab;
    field: string;
    options: readonly string[];
    labels: string;
  }>) {
    if (!can(tab, field)) return null;
    const value = (get(tab, field) as string | undefined) ?? "";
    return wrap(
      tab,
      field,
      <NativeSelect
        id={fieldId(tab, field)}
        className="w-full"
        value={value}
        onChange={(e) => {
          const next = e.target.value === "" ? undefined : e.target.value;
          set(tab, field, next);
          // A template's provider (CF6a): the model follows its default.
          const list =
            policy && tab === "model" && field === "model_provider"
              ? modelsOf(policy, next)
              : null;
          if (list && !list.includes(get("model", "model_name") as string)) {
            set("model", "model_name", list[0]);
          }
        }}
      >
        <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {t(`enums.${labels}.${option}`)}
          </NativeSelectOption>
        ))}
      </NativeSelect>,
    );
  }

  function boolField({
    tab,
    field,
    defaultOn = false,
  }: Readonly<{ tab: ConfigTab; field: string; defaultOn?: boolean }>) {
    if (!can(tab, field)) return null;
    return (
      <div
        className="flex items-center justify-between gap-3"
        data-field={`${tab}.${field}`}
      >
        <Label htmlFor={fieldId(tab, field)} className="text-12 font-normal">
          {t(`fields.${field}`)}
        </Label>
        <Switch
          id={fieldId(tab, field)}
          checked={
            defaultOn ? get(tab, field) !== false : get(tab, field) === true
          }
          onCheckedChange={(checked) => set(tab, field, checked)}
        />
      </div>
    );
  }

  function numberField({
    tab,
    field,
    min,
    max,
  }: Readonly<{ tab: ConfigTab; field: string; min: number; max: number }>) {
    if (!can(tab, field)) return null;
    const value = get(tab, field);
    return wrap(
      tab,
      field,
      <Input
        id={fieldId(tab, field)}
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        max={max}
        value={typeof value === "number" ? String(value) : ""}
        onChange={(e) => {
          const raw = e.target.value.trim();
          const parsed = Number(raw);
          set(
            tab,
            field,
            raw === "" || !Number.isFinite(parsed)
              ? undefined
              : Math.trunc(parsed),
          );
        }}
      />,
    );
  }

  /** A list of texts, one per line. */
  function listField({
    tab,
    field,
  }: Readonly<{ tab: ConfigTab; field: string }>) {
    if (!can(tab, field)) return null;
    const value = (get(tab, field) as string[] | undefined) ?? [];
    return wrap(
      tab,
      field,
      <Textarea
        id={fieldId(tab, field)}
        rows={3}
        defaultValue={value.join("\n")}
        placeholder={t("onePerLine")}
        onBlur={(e) =>
          set(
            tab,
            field,
            e.target.value
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
          )
        }
      />,
    );
  }

  function rowsOf(tab: ConfigTab, field: string): Row[] {
    const value = get(tab, field);
    return Array.isArray(value) ? (value as Row[]) : [];
  }
  function setRow(tab: ConfigTab, field: string, index: number, patch: Row) {
    set(
      tab,
      field,
      rowsOf(tab, field).map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete next[key];
        }
        return next;
      }),
    );
  }
  function removeRow(tab: ConfigTab, field: string, index: number) {
    set(
      tab,
      field,
      rowsOf(tab, field).filter((_, i) => i !== index),
    );
  }
  function rowError(tab: ConfigTab, field: string, index: number) {
    return errorAt(`${tab}.${field}.${index}`);
  }

  function removeButton({ onClick }: Readonly<{ onClick: () => void }>) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("remove")}
        title={t("remove")}
        onClick={onClick}
      >
        <Trash2 />
      </Button>
    );
  }

  function variables() {
    if (!can("overview", "variables")) return null;
    const rows = rowsOf("overview", "variables");
    return (
      <fieldset className="space-y-2" data-field="overview.variables">
        <legend className="text-12 font-medium">{t("fields.variables")}</legend>
        <p className="text-11 text-text-secondary">{t("hints.variables")}</p>
        {rows.map((row, index) => (
          <div
            key={index}
            className="border-border space-y-2 rounded-md border p-2"
          >
            <div className="flex items-center gap-2">
              <Input
                aria-label={t("variable.key")}
                placeholder={t("variable.key")}
                maxLength={60}
                value={(row.key as string | undefined) ?? ""}
                onChange={(e) =>
                  setRow("overview", "variables", index, {
                    key: e.target.value,
                  })
                }
              />
              {removeButton({
                onClick: () => removeRow("overview", "variables", index),
              })}
            </div>
            <Textarea
              aria-label={t("variable.value")}
              placeholder={t("variable.value")}
              rows={2}
              maxLength={2000}
              value={(row.value as string | undefined) ?? ""}
              onChange={(e) =>
                setRow("overview", "variables", index, {
                  value: e.target.value,
                })
              }
            />
            {rowError("overview", "variables", index) ? (
              <p className="text-11 text-destructive" role="alert">
                {rowError("overview", "variables", index)}
              </p>
            ) : null}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            set("overview", "variables", [...rows, { key: "", value: "" }])
          }
        >
          <Plus />
          {t("variable.add")}
        </Button>
      </fieldset>
    );
  }

  function slots() {
    if (!can("scope", "availability_slots")) return null;
    const rows = rowsOf("scope", "availability_slots");
    return (
      <fieldset className="space-y-2" data-field="scope.availability_slots">
        <legend className="text-12 font-medium">
          {t("fields.availability_slots")}
        </legend>
        {rows.map((row, index) => (
          <div key={index} className="space-y-1">
            <div className="flex items-center gap-2">
              <NativeSelect
                aria-label={t("slot.weekday")}
                value={(row.weekday as string | undefined) ?? "mon"}
                onChange={(e) =>
                  setRow("scope", "availability_slots", index, {
                    weekday: e.target.value,
                  })
                }
              >
                {WEEKDAYS.map((day) => (
                  <NativeSelectOption key={day} value={day}>
                    {t(`weekdays.${day}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Input
                type="time"
                aria-label={t("slot.start")}
                value={(row.start as string | undefined) ?? ""}
                onChange={(e) =>
                  setRow("scope", "availability_slots", index, {
                    start: e.target.value,
                  })
                }
              />
              <Input
                type="time"
                aria-label={t("slot.end")}
                value={(row.end as string | undefined) ?? ""}
                onChange={(e) =>
                  setRow("scope", "availability_slots", index, {
                    end: e.target.value,
                  })
                }
              />
              {removeButton({
                onClick: () => removeRow("scope", "availability_slots", index),
              })}
            </div>
            {rowError("scope", "availability_slots", index) ? (
              <p className="text-11 text-destructive" role="alert">
                {rowError("scope", "availability_slots", index)}
              </p>
            ) : null}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            set("scope", "availability_slots", [
              ...rows,
              { weekday: "mon", start: "09:00", end: "18:00" },
            ])
          }
        >
          <Plus />
          {t("slot.add")}
        </Button>
      </fieldset>
    );
  }

  function scoringRules() {
    if (!can("rules", "lead_scoring_rules")) return null;
    const rows = rowsOf("rules", "lead_scoring_rules");
    const idFor = (label: string, index: number) => {
      const taken = new Set(
        rows.filter((_, i) => i !== index).map((r) => r.rule_id as string),
      );
      const base = slug(label);
      let candidate = base;
      for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}_${n}`;
      return candidate;
    };
    return (
      <fieldset className="space-y-2" data-field="rules.lead_scoring_rules">
        <legend className="text-12 font-medium">
          {t("fields.lead_scoring_rules")}
        </legend>
        {rows.map((row, index) => (
          <div
            key={index}
            className="border-border space-y-2 rounded-md border p-2"
            data-testid="scoring-rule"
          >
            <div className="flex items-center gap-2">
              <Input
                aria-label={t("rule.label")}
                placeholder={t("rule.label")}
                maxLength={120}
                value={(row.label as string | undefined) ?? ""}
                onChange={(e) =>
                  setRow("rules", "lead_scoring_rules", index, {
                    label: e.target.value,
                    // The id follows the label only before the first save.
                    ...(row[NEW_RULE]
                      ? { rule_id: idFor(e.target.value, index) }
                      : {}),
                  })
                }
              />
              <Input
                type="number"
                className="w-24"
                aria-label={t("rule.points")}
                min={-100}
                max={100}
                step={1}
                value={
                  typeof row.points === "number" ? String(row.points) : "0"
                }
                onChange={(e) =>
                  setRow("rules", "lead_scoring_rules", index, {
                    points: Math.trunc(Number(e.target.value) || 0),
                  })
                }
              />
              {removeButton({
                onClick: () => removeRow("rules", "lead_scoring_rules", index),
              })}
            </div>
            <Input
              aria-label={t("rule.signal")}
              placeholder={t("rule.signal")}
              maxLength={500}
              value={(row.signal as string | undefined) ?? ""}
              onChange={(e) =>
                setRow("rules", "lead_scoring_rules", index, {
                  signal: e.target.value,
                })
              }
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                aria-label={t("rule.group")}
                placeholder={t("rule.group")}
                maxLength={60}
                value={(row.key_group as string | undefined) ?? ""}
                onChange={(e) =>
                  setRow("rules", "lead_scoring_rules", index, {
                    key_group: e.target.value,
                  })
                }
              />
              <Input
                aria-label={t("rule.captureField")}
                placeholder={t("rule.captureField")}
                maxLength={80}
                value={(row.capture_field as string | undefined) ?? ""}
                onChange={(e) =>
                  setRow("rules", "lead_scoring_rules", index, {
                    capture_field: e.target.value || undefined,
                  })
                }
              />
            </div>
            <Label className="text-12 font-normal">
              <Checkbox
                checked={row.notify_immediately === true}
                onCheckedChange={(checked) =>
                  setRow("rules", "lead_scoring_rules", index, {
                    notify_immediately: checked === true ? true : undefined,
                  })
                }
              />
              {t("rule.notifyImmediately")}
            </Label>
            {rowError("rules", "lead_scoring_rules", index) ? (
              <p className="text-11 text-destructive" role="alert">
                {rowError("rules", "lead_scoring_rules", index)}
              </p>
            ) : null}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            set("rules", "lead_scoring_rules", [
              ...rows,
              {
                rule_id: idFor("regra", rows.length),
                key_group: "geral",
                label: "",
                signal: "",
                points: 10,
                [NEW_RULE]: true,
              },
            ])
          }
        >
          <Plus />
          {t("rule.add")}
        </Button>
      </fieldset>
    );
  }

  function tools() {
    if (!can("integration", "tools")) return null;
    const selected = new Set(
      (get("integration", "tools") as string[] | undefined) ?? [],
    );
    // The engine's own tools (GF2) are never picked here: the factory
    // GUIDS keep them, and the engine offers them by the factory role.
    const available = AGENT_TOOL_IDS.filter(
      (tool) => toolAllowedFor(tool, agentKind) && !isSystemTool(tool),
    );
    const kept = AGENT_TOOL_IDS.filter(
      (tool) => isSystemTool(tool) && selected.has(tool),
    );
    return (
      <fieldset className="space-y-2" data-field="integration.tools">
        <legend className="text-12 font-medium">{t("fields.tools")}</legend>
        {available.map((tool) => (
          <Label key={tool} className="text-12 items-start font-normal">
            <Checkbox
              checked={selected.has(tool)}
              onCheckedChange={(checked) => {
                const next = new Set(selected);
                if (checked === true) next.add(tool);
                else next.delete(tool);
                set("integration", "tools", [
                  ...available.filter((id) => next.has(id)),
                  ...kept,
                ]);
              }}
            />
            <span>
              <span className="font-medium">{t(`tools.${tool}.label`)}</span>
              <span className="text-text-secondary block">
                {t(`tools.${tool}.desc`)}
              </span>
            </span>
          </Label>
        ))}
        {errorAt("integration.tools") ? (
          <p className="text-11 text-destructive" role="alert">
            {errorAt("integration.tools")}
          </p>
        ) : null}
      </fieldset>
    );
  }

  function credential() {
    if (!can("model", "credential_id")) return null;
    const value = (get("model", "credential_id") as string | null) ?? "";
    return wrap(
      "model",
      "credential_id",
      <NativeSelect
        id={fieldId("model", "credential_id")}
        className="w-full"
        value={value}
        onChange={(e) => {
          const chosen = credentials.find((c) => c.id === e.target.value);
          setDoc((prev) => {
            const model = { ...prev.model };
            if (chosen) {
              model.credential_id = chosen.id;
              model.model_provider = chosen.provider;
              // The default of the new provider when the model is not one
              // of its list (CF6a: the first model is the default).
              const list = policy ? modelsOf(policy, chosen.provider) : null;
              if (list && !list.includes(model.model_name as string)) {
                model.model_name = list[0];
              }
            } else {
              delete model.credential_id;
              delete model.model_provider;
            }
            return { ...prev, model };
          });
        }}
      >
        <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
        {chatKeys
          .filter(
            (credential) =>
              !policy ||
              providerAllowed(policy, credential.provider) ||
              credential.id === value,
          )
          .map((credential) => (
            <NativeSelectOption key={credential.id} value={credential.id}>
              {policy && !providerAllowed(policy, credential.provider)
                ? t("model.keyProviderOff", { label: credential.label })
                : credential.label}
            </NativeSelectOption>
          ))}
      </NativeSelect>,
    );
  }

  /** What is wrong with the saved model connection, kept working (CF6a). */
  const savedWarning =
    policy && can("model", "model_name")
      ? modelWarning(
          policy,
          textProvider,
          (get("model", "model_name") as string | undefined) ?? null,
        )
      : null;

  /**
   * The model: a list of the provider's catalog (CF6a), with a saved model
   * outside it kept as an option; free text when the provider has no list.
   */
  function modelName() {
    if (!can("model", "model_name")) return null;
    const list = policy ? modelsOf(policy, textProvider) : null;
    if (!list)
      return textField({ tab: "model", field: "model_name", max: 120 });
    const value = (get("model", "model_name") as string | undefined) ?? "";
    const outside = value !== "" && !list.includes(value);
    return wrap(
      "model",
      "model_name",
      <NativeSelect
        id={fieldId("model", "model_name")}
        className="w-full"
        value={value}
        aria-invalid={Boolean(errorAt("model.model_name")) || undefined}
        onChange={(e) =>
          set(
            "model",
            "model_name",
            e.target.value === "" ? undefined : e.target.value,
          )
        }
      >
        <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
        {outside ? (
          <NativeSelectOption value={value}>
            {t("model.outside", { model: value })}
          </NativeSelectOption>
        ) : null}
        {list.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {option}
          </NativeSelectOption>
        ))}
      </NativeSelect>,
    );
  }

  /** The voice or the embeddings key; empty keeps the text key's. */
  function extraKey({
    field,
    keys,
    empty,
  }: Readonly<{
    field: "audio_credential_id" | "embedding_credential_id";
    keys: readonly EditorCredential[];
    empty: string;
  }>) {
    if (!can("model", field)) return null;
    const value = (get("model", field) as string | null) ?? "";
    return wrap(
      "model",
      field,
      <NativeSelect
        id={fieldId("model", field)}
        className="w-full"
        value={value}
        onChange={(e) =>
          set(
            "model",
            field,
            e.target.value === "" ? undefined : e.target.value,
          )
        }
      >
        <NativeSelectOption value="">{empty}</NativeSelectOption>
        {keys.map((credential) => (
          <NativeSelectOption key={credential.id} value={credential.id}>
            {credential.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>,
    );
  }

  /** The voices of the voice key's provider; free text when it is unknown. */
  function voice() {
    if (!can("model", "audio_voice")) return null;
    if (!speech) {
      return textField({ tab: "model", field: "audio_voice", max: 120 });
    }
    const value = (get("model", "audio_voice") as string | undefined) ?? "";
    return wrap(
      "model",
      "audio_voice",
      <NativeSelect
        id={fieldId("model", "audio_voice")}
        className="w-full"
        value={value}
        onChange={(e) =>
          set(
            "model",
            "audio_voice",
            e.target.value === "" ? undefined : e.target.value,
          )
        }
      >
        <NativeSelectOption value="">
          {t("model.defaultVoice", { voice: speech.defaultVoice })}
        </NativeSelectOption>
        {speech.voices.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {option}
          </NativeSelectOption>
        ))}
      </NativeSelect>,
    );
  }

  /** One part of the model tab, with what its key is for. */
  function modelSection(
    part: "text" | "voice" | "embeddings",
    children: readonly React.ReactNode[],
  ) {
    if (children.every((child) => child === null)) return null;
    return (
      <fieldset
        className="border-card-border space-y-3 rounded-xl border p-3"
        data-testid={`model-${part}`}
      >
        <legend className="text-12 text-text px-1 font-medium">
          {t(`model.${part}.title`)}
        </legend>
        <p className="text-11 text-text-secondary">{t(`model.${part}.note`)}</p>
        {children}
      </fieldset>
    );
  }

  const sections: Record<ConfigTab, React.ReactNode> = {
    overview: (
      <>
        {textField({ tab: "overview", field: "agent_name", max: 80 })}
        {selectField({
          tab: "overview",
          field: "agent_tone",
          options: AGENT_TONES,
          labels: "agent_tone",
        })}
        {selectField({
          tab: "overview",
          field: "language",
          options: AGENT_LANGUAGES,
          labels: "language",
        })}
        {textField({ tab: "overview", field: "segment", max: 80 })}
        {textField({
          tab: "overview",
          field: "business_summary",
          max: 5000,
          rows: 3,
        })}
        {textField({
          tab: "overview",
          field: "products_services",
          max: 10_000,
          rows: 3,
        })}
        {textField({
          tab: "overview",
          field: "persona_context",
          max: 5000,
          rows: 3,
        })}
        {textField({
          tab: "overview",
          field: "expected_output",
          max: 5000,
          rows: 3,
        })}
        {textField({
          tab: "overview",
          field: "system_prompt",
          max: 50_000,
          rows: 10,
        })}
        {variables()}
      </>
    ),
    scope: (
      <>
        <div className="grid gap-3 sm:grid-cols-2">
          {textField({ tab: "scope", field: "base_city", max: 120 })}
          {textField({ tab: "scope", field: "base_state", max: 60 })}
        </div>
        {boolField({ tab: "scope", field: "remote_allowed" })}
        {boolField({ tab: "scope", field: "travel_allowed" })}
        {listField({ tab: "scope", field: "coverage_areas" })}
        {listField({ tab: "scope", field: "coverage_cities" })}
        {numberField({
          tab: "scope",
          field: "coverage_radius_km",
          min: 0,
          max: 20_000,
        })}
        {textField({
          tab: "scope",
          field: "timezone",
          max: 60,
          placeholder: "America/Sao_Paulo",
        })}
        {slots()}
      </>
    ),
    rules: (
      <>
        {selectField({
          tab: "rules",
          field: "handoff_mode",
          options: HANDOFF_MODES,
          labels: "handoff_mode",
        })}
        {selectField({
          tab: "rules",
          field: "after_hours_behavior",
          options: AFTER_HOURS_BEHAVIORS,
          labels: "after_hours_behavior",
        })}
        {selectField({
          tab: "rules",
          field: "out_of_scope_action",
          options: OUT_OF_SCOPE_ACTIONS,
          labels: "out_of_scope_action",
        })}
        {boolField({ tab: "rules", field: "refuses_pricing" })}
        {boolField({ tab: "rules", field: "refuses_competitor_comparison" })}
        {boolField({ tab: "rules", field: "refuses_delivery_commitment" })}
        <div className="grid gap-3 sm:grid-cols-3">
          {numberField({
            tab: "rules",
            field: "hot_score_threshold",
            min: -100_000,
            max: 100_000,
          })}
          {numberField({
            tab: "rules",
            field: "warm_score_threshold",
            min: -100_000,
            max: 100_000,
          })}
          {numberField({
            tab: "rules",
            field: "notify_on_score",
            min: -100_000,
            max: 100_000,
          })}
        </div>
        {scoringRules()}
        {textField({
          tab: "rules",
          field: "owner_phone",
          max: 16,
          placeholder: "+5511999990000",
        })}
        {selectField({
          tab: "rules",
          field: "notify_channel",
          options: NOTIFY_CHANNELS,
          labels: "notify_channel",
        })}
        {textField({
          tab: "rules",
          field: "notify_template",
          max: 2000,
          rows: 3,
        })}
        {boolField({ tab: "rules", field: "partner_referral_notify" })}
        {textField({
          tab: "rules",
          field: "partner_message_template",
          max: 2000,
          rows: 3,
        })}
      </>
    ),
    integration: (
      <>
        {tools()}
        {selectField({
          tab: "integration",
          field: "lead_destination",
          options: LEAD_DESTINATIONS,
          labels: "lead_destination",
        })}
        {textField({
          tab: "integration",
          field: "crm_webhook_url",
          max: 2000,
          placeholder: "https://",
        })}
        {boolField({ tab: "integration", field: "onboarding_completed" })}
      </>
    ),
    model: (
      <>
        {modelSection("text", [
          credential(),
          selectField({
            tab: "model",
            field: "model_provider",
            // The providers on (CF6a), and the saved one even when off.
            options: MODEL_PROVIDERS.filter(
              (provider) =>
                !policy ||
                providerAllowed(policy, provider) ||
                provider === get("model", "model_provider"),
            ),
            labels: "model_provider",
          }),
          modelName(),
          savedWarning ? (
            <p
              key="model-warning"
              className="text-11 text-warning-text"
              role="status"
              data-testid="model-warning"
            >
              {savedWarning === "provider_off"
                ? t("model.providerOffWarning")
                : t("model.outsideWarning")}
            </p>
          ) : null,
        ])}
        {modelSection("voice", [
          extraKey({
            field: "audio_credential_id",
            keys: chatKeys,
            empty: textSpeaks ? t("model.useTextKey") : t("choose"),
          }),
          voiceWarning ? (
            <p
              key="warning"
              className="text-11 text-warning-text"
              role="status"
              data-testid="voice-warning"
            >
              {voiceWarning}
            </p>
          ) : null,
          boolField({ tab: "model", field: "audio_enabled", defaultOn: true }),
          get("model", "audio_enabled") === false ? null : voice(),
          get("model", "audio_enabled") === false
            ? null
            : textField({
                tab: "model",
                field: "audio_model",
                max: 120,
                ...(speech
                  ? {
                      placeholder: t("model.defaultModel", {
                        model: speech.model,
                      }),
                    }
                  : {}),
              }),
        ])}
        {modelSection("embeddings", [
          extraKey({
            field: "embedding_credential_id",
            keys: embeddingKeys,
            empty: t("choose"),
          }),
          boolField({ tab: "model", field: "rag_enabled" }),
          get("model", "rag_enabled") === true
            ? textField({ tab: "model", field: "embedding_model", max: 120 })
            : null,
        ])}
      </>
    ),
  };

  return (
    <div data-testid="agent-config-editor">
      <input type="hidden" name={name} value={serialize(doc)} />
      {errors.config ? (
        <p className="text-11 text-destructive mb-2" role="alert">
          {errors.config}
        </p>
      ) : null}
      <Tabs defaultValue={tabs[0] ?? "model"}>
        <TabsList className="h-auto flex-wrap">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className={tabHasError(tab) ? "text-destructive" : undefined}
            >
              {t(`tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab} value={tab} className="space-y-4 pt-3">
            {sections[tab]}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
