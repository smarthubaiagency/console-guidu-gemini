"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { useStatus } from "@/components/feedback/status-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AiProviderId } from "@/core/ai/models";
import {
  formatGlossary,
  MAX_GLOSSARY_LINES,
} from "@/core/translation/glossary";
import type { TranslationEngineId } from "@/core/translation/types";

import type { TranslationSettingsView } from "../server/translation";
import {
  saveGoogleTranslateKeyAction,
  saveTranslationSettingsAction,
  testTranslationEngineAction,
} from "../translation-actions";

/**
 * The block "Tradução" of the Inbox settings (TR2, traducao.md §3): the
 * switch, the main engine and the fallback, the AI key and model (with a
 * fast model suggested), the Google Translate key (masked, with "Testar"),
 * the team's language (the workspace's, read-only) and the glossary. The
 * switch only turns on with a main engine ready; the action checks again.
 */
export function TranslationSettingsForm({
  workspaceSlug,
  canWrite,
  view,
}: Readonly<{
  workspaceSlug: string;
  canWrite: boolean;
  view: TranslationSettingsView;
}>) {
  const t = useTranslations("inboxGuids.translation");
  const tl = useTranslations("inbox.locale");
  const router = useRouter();
  const { showStatus } = useStatus();
  const { settings } = view;
  const [enabled, setEnabled] = useState(settings.enabled);
  const [primary, setPrimary] = useState<TranslationEngineId | "">(
    settings.primary ?? "",
  );
  const [fallback, setFallback] = useState<TranslationEngineId | "">(
    settings.fallback ?? "",
  );
  const [credentialId, setCredentialId] = useState(
    settings.ai.credential_id ?? "",
  );
  const [model, setModel] = useState(settings.ai.model ?? "");
  const [glossary, setGlossary] = useState(formatGlossary(settings.glossary));
  const [googleSecret, setGoogleSecret] = useState("");
  const [google, setGoogle] = useState(view.google);
  const [busy, setBusy] = useState<string | null>(null);

  const key = view.aiKeys.find((k) => k.id === credentialId) ?? null;
  const provider: AiProviderId | null = key?.provider ?? null;
  const models = provider ? (view.models[provider] ?? null) : null;
  const suggestion = provider ? (view.suggested[provider] ?? null) : null;
  const ready = useMemo(
    () => ({
      ai: !!key && model.trim().length > 0,
      google: !!google,
    }),
    [key, model, google],
  );
  const primaryReady = primary !== "" && ready[primary];
  const lines = glossary.split(/\r?\n/u).filter((l) => l.trim()).length;

  const fail = (error: string) => showStatus({ type: "down", title: error });

  const chooseKey = (id: string) => {
    setCredentialId(id);
    const next = view.aiKeys.find((k) => k.id === id);
    if (!next) return;
    const list = view.models[next.provider] ?? null;
    if (!model || (list && !list.includes(model))) {
      setModel(view.suggested[next.provider] ?? list?.[0] ?? "");
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      const result = await saveTranslationSettingsAction({
        workspaceSlug,
        enabled: enabled && primaryReady,
        primary: primary || null,
        fallback: fallback && fallback !== primary ? fallback : null,
        aiCredentialId: credentialId || null,
        aiModel: model.trim() || null,
        glossary,
      });
      if ("error" in result) return fail(result.error);
      showStatus({ type: "up", title: result.message });
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const saveGoogle = async () => {
    setBusy("google");
    try {
      const result = await saveGoogleTranslateKeyAction({
        workspaceSlug,
        secret: googleSecret,
      });
      if ("error" in result) return fail(result.error);
      setGoogle(result.key);
      setGoogleSecret("");
      showStatus({ type: "up", title: result.message });
    } finally {
      setBusy(null);
    }
  };

  const test = async (engine: TranslationEngineId) => {
    setBusy(`test-${engine}`);
    try {
      const result = await testTranslationEngineAction({
        workspaceSlug,
        engine,
        aiCredentialId: credentialId || null,
        aiModel: model.trim() || null,
      });
      if ("error" in result) return fail(result.error);
      showStatus(
        result.result.ok
          ? { type: "up", title: t("test.ok") }
          : {
              type: "down",
              title: t("test.failed"),
              message: t(`errorCodes.${result.result.errorCode ?? "error"}`),
            },
      );
    } finally {
      setBusy(null);
    }
  };

  const engineLabel = (engine: TranslationEngineId) => t(`engines.${engine}`);

  return (
    <div className="space-y-5" data-testid="inbox-translation-settings">
      {view.notice ? (
        <Alert
          variant={view.notice.failed ? "destructive" : "default"}
          data-testid="inbox-translation-notice"
        >
          <TriangleAlert />
          <AlertTitle>
            {view.notice.failed ? t("notice.failed") : t("notice.fallback")}
          </AlertTitle>
          <AlertDescription>
            {t(`errorCodes.${view.notice.code}`)}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor="inbox-translation-enabled" className="text-12">
            {t("enabled")}
          </Label>
          <p className="text-11 text-text-secondary">
            {primaryReady ? t("enabledHint") : t("enabledNeedsEngine")}
          </p>
        </div>
        <Switch
          id="inbox-translation-enabled"
          checked={enabled && primaryReady}
          onCheckedChange={setEnabled}
          disabled={!canWrite || !primaryReady}
          data-testid="inbox-translation-enabled"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="inbox-translation-primary" className="text-12">
            {t("primary")}
          </Label>
          <NativeSelect
            id="inbox-translation-primary"
            value={primary}
            onChange={(e) =>
              setPrimary(e.target.value as TranslationEngineId | "")
            }
            disabled={!canWrite}
            className="w-full"
            data-testid="inbox-translation-primary"
          >
            <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
            <NativeSelectOption value="ai">
              {engineLabel("ai")}
            </NativeSelectOption>
            <NativeSelectOption value="google">
              {engineLabel("google")}
            </NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="inbox-translation-fallback" className="text-12">
            {t("fallback")}
          </Label>
          <NativeSelect
            id="inbox-translation-fallback"
            value={fallback}
            onChange={(e) =>
              setFallback(e.target.value as TranslationEngineId | "")
            }
            disabled={!canWrite}
            className="w-full"
            data-testid="inbox-translation-fallback"
          >
            <NativeSelectOption value="">{t("noFallback")}</NativeSelectOption>
            {(["ai", "google"] as const)
              .filter((engine) => engine !== primary)
              .map((engine) => (
                <NativeSelectOption key={engine} value={engine}>
                  {engineLabel(engine)}
                </NativeSelectOption>
              ))}
          </NativeSelect>
          <p className="text-11 text-text-secondary">{t("fallbackHint")}</p>
        </div>
      </div>

      <section className="space-y-3" aria-label={engineLabel("ai")}>
        <h3 className="text-12 text-text font-semibold">{engineLabel("ai")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="inbox-translation-key" className="text-12">
              {t("ai.key")}
            </Label>
            <NativeSelect
              id="inbox-translation-key"
              value={credentialId}
              onChange={(e) => chooseKey(e.target.value)}
              disabled={!canWrite}
              className="w-full"
            >
              <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
              {view.aiKeys.map((option) => (
                <NativeSelectOption key={option.id} value={option.id}>
                  {`${option.label} · ${option.maskedValue}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {view.aiKeys.length === 0 ? (
              <p className="text-11 text-text-secondary">
                {t("ai.noKeys")}{" "}
                <Link
                  className="underline"
                  href={`/app/${workspaceSlug}/settings/credentials`}
                >
                  {t("ai.keysLink")}
                </Link>
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="inbox-translation-model" className="text-12">
              {t("ai.model")}
            </Label>
            {models ? (
              <NativeSelect
                id="inbox-translation-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={!canWrite || !key}
                className="w-full"
              >
                <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
                {models.map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {option}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : (
              <Input
                id="inbox-translation-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={!canWrite || !key}
                maxLength={120}
              />
            )}
            {suggestion ? (
              <p className="text-11 text-text-secondary">
                {t("ai.suggestion", { model: suggestion })}
              </p>
            ) : null}
          </div>
        </div>
        {canWrite ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!ready.ai || busy !== null}
            onClick={() => void test("ai")}
          >
            {t("test.button")}
          </Button>
        ) : null}
      </section>

      <section className="space-y-3" aria-label={engineLabel("google")}>
        <h3 className="text-12 text-text font-semibold">
          {engineLabel("google")}
        </h3>
        <p className="text-12 text-text-secondary">
          {google
            ? t("google.current", { key: google.maskedValue })
            : t("google.none")}
        </p>
        {canWrite ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="password"
              autoComplete="off"
              value={googleSecret}
              onChange={(e) => setGoogleSecret(e.target.value)}
              placeholder={t("google.placeholder")}
              aria-label={t("google.label")}
              maxLength={200}
              data-testid="inbox-translation-google-key"
            />
            <Button
              type="button"
              size="sm"
              disabled={!googleSecret.trim() || busy !== null}
              onClick={() => void saveGoogle()}
            >
              {t("google.save")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!google || busy !== null}
              onClick={() => void test("google")}
              data-testid="inbox-translation-google-test"
            >
              {t("test.button")}
            </Button>
          </div>
        ) : null}
      </section>

      <div className="space-y-1">
        <p className="text-12 text-text">
          {t("teamLanguage", { language: tl(`names.${view.teamLocale}`) })}
        </p>
        <p className="text-11 text-text-secondary">
          {t("teamLanguageHint")}{" "}
          <Link
            className="underline"
            href={`/app/${workspaceSlug}/settings/general`}
          >
            {t("teamLanguageLink")}
          </Link>
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="inbox-translation-glossary" className="text-12">
          {t("glossary")}
        </Label>
        <Textarea
          id="inbox-translation-glossary"
          value={glossary}
          onChange={(e) => setGlossary(e.target.value)}
          disabled={!canWrite}
          rows={5}
          placeholder={t("glossaryPlaceholder")}
        />
        <p
          className={
            lines > MAX_GLOSSARY_LINES
              ? "text-11 text-danger-text"
              : "text-11 text-text-secondary"
          }
        >
          {t("glossaryHint", { count: lines, max: MAX_GLOSSARY_LINES })}
        </p>
      </div>

      {canWrite ? (
        <Button
          type="button"
          size="sm"
          disabled={busy !== null || lines > MAX_GLOSSARY_LINES}
          onClick={() => void save()}
          data-testid="inbox-translation-save"
        >
          {t("save")}
        </Button>
      ) : (
        <p className="text-12 text-text-secondary">{t("viewOnly")}</p>
      )}
    </div>
  );
}
