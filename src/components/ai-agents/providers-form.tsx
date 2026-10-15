"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { useActionStatus } from "@/components/feedback/use-action-status";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AiConsoleActionState } from "@/core/ai/console-actions";
import {
  AI_PROVIDERS,
  type AiPolicy,
  type AiProviderId,
  type BaseUrls,
  type ModelCatalog,
} from "@/core/ai/models";

const INITIAL: AiConsoleActionState = {};

type FormAction = (
  prev: AiConsoleActionState,
  formData: FormData,
) => Promise<AiConsoleActionState>;

function lines(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const model = line.trim();
    if (model) seen.add(model);
  }
  return [...seen];
}

/**
 * IA › Provedores e modelos (CF6a). Two cards (CF1): the providers on,
 * then the models of each one. The platform types its catalog (one model
 * per line) and may set a gateway; the partner ticks, within what the
 * platform allows, what its customers may choose. Sent as one JSON field.
 */
export function ProvidersForm({
  level,
  inherited,
  effective,
  baseUrls,
  canEdit,
  action,
}: Readonly<{
  level: "platform" | "partner";
  inherited: AiPolicy;
  effective: AiPolicy;
  baseUrls: BaseUrls;
  canEdit: boolean;
  action: FormAction;
}>) {
  const t = useTranslations("aiConsole");
  const [state, formAction, pending] = useActionState(action, INITIAL);
  useActionStatus(state);

  const offered: readonly AiProviderId[] =
    level === "platform" ? AI_PROVIDERS : inherited.providers;
  const [providers, setProviders] = useState<AiProviderId[]>(
    offered.filter((p) => effective.providers.includes(p)),
  );
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      AI_PROVIDERS.map((p) => [p, (effective.models[p] ?? []).join("\n")]),
    ),
  );
  const [ticked, setTicked] = useState<ModelCatalog>(() => ({
    ...effective.models,
  }));
  const [urls, setUrls] = useState<Record<string, string>>(() => ({
    ...baseUrls,
  }));

  const fixed = (p: AiProviderId): readonly string[] | null => {
    if (level === "platform") return null;
    const list = inherited.models[p];
    return list && list.length > 0 ? list : null;
  };

  const models: ModelCatalog = {};
  for (const p of level === "platform" ? AI_PROVIDERS : providers) {
    const list = fixed(p);
    if (list) {
      const mine = ticked[p] ?? [];
      models[p] = list.filter((m) => mine.includes(m));
    } else {
      const typed = lines(texts[p] ?? "");
      // The partner leaves a free provider free by sending nothing.
      if (level === "platform" || typed.length > 0) models[p] = typed;
    }
  }
  const policy =
    level === "platform"
      ? { providers, models, baseUrls: urls }
      : { providers, models };

  const toggleProvider = (p: AiProviderId, on: boolean) =>
    setProviders((current) =>
      on
        ? offered.filter((id) => id === p || current.includes(id))
        : current.filter((id) => id !== p),
    );
  const toggleModel = (p: AiProviderId, model: string, on: boolean) =>
    setTicked((current) => {
      const mine = current[p] ?? [];
      return {
        ...current,
        [p]: on ? [...mine, model] : mine.filter((m) => m !== model),
      };
    });

  return (
    <form
      action={formAction}
      className="space-y-6"
      data-testid="ai-providers-form"
    >
      <input type="hidden" name="policy" value={JSON.stringify(policy)} />
      <fieldset disabled={!canEdit || pending} className="space-y-6">
        <SettingsCard
          title={t("providersPage.providersTitle")}
          description={t("providersPage.providersHint")}
          testId="ai-providers-card"
        >
          <ul className="divide-border divide-y">
            {AI_PROVIDERS.map((p) => {
              const available = offered.includes(p);
              return (
                <li
                  key={p}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <Label
                    htmlFor={`provider-${p}`}
                    className="text-14 font-medium"
                  >
                    {t(`providers.${p}`)}
                    {!available ? (
                      <span className="text-12 text-text-secondary font-normal">
                        {" · "}
                        {t("providersPage.offByPlatform")}
                      </span>
                    ) : null}
                  </Label>
                  <Switch
                    id={`provider-${p}`}
                    data-testid={`provider-switch-${p}`}
                    checked={available && providers.includes(p)}
                    disabled={!available}
                    onCheckedChange={(on) => toggleProvider(p, on)}
                  />
                </li>
              );
            })}
          </ul>
        </SettingsCard>

        <SettingsCard
          title={t("providersPage.modelsTitle")}
          description={
            level === "platform"
              ? `${t("providersPage.modelsHint")} ${t("providersPage.syncNote")}`
              : t("providersPage.partnerModelsHint")
          }
          testId="ai-models-card"
        >
          <div className="space-y-5">
            {(level === "platform" ? AI_PROVIDERS : providers).map((p) => {
              const list = fixed(p);
              return (
                <div key={p} className="space-y-2" data-testid={`models-${p}`}>
                  <Label
                    htmlFor={list ? undefined : `models-${p}-text`}
                    className="text-12 font-semibold"
                  >
                    {t("providersPage.modelsLabel", {
                      provider: t(`providers.${p}`),
                    })}
                  </Label>
                  {list ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {list.map((model) => (
                        <Label
                          key={model}
                          className="text-12 gap-2 font-normal"
                        >
                          <Checkbox
                            data-testid={`model-${p}-${model}`}
                            checked={(ticked[p] ?? []).includes(model)}
                            onCheckedChange={(on) =>
                              toggleModel(p, model, on === true)
                            }
                          />
                          <code>{model}</code>
                        </Label>
                      ))}
                    </div>
                  ) : (
                    <>
                      {level === "partner" ? (
                        <p className="text-11 text-text-secondary">
                          {t("providersPage.freeModel")}
                        </p>
                      ) : null}
                      <Textarea
                        id={`models-${p}-text`}
                        rows={4}
                        className="text-12 font-mono"
                        value={texts[p] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setTexts((current) => ({ ...current, [p]: value }));
                        }}
                      />
                    </>
                  )}
                  {level === "platform" ? (
                    <div className="space-y-1">
                      <Label
                        htmlFor={`base-url-${p}`}
                        className="text-12 text-text-secondary font-normal"
                      >
                        {t("providersPage.baseUrlLabel", {
                          provider: t(`providers.${p}`),
                        })}
                      </Label>
                      <Input
                        id={`base-url-${p}`}
                        type="url"
                        inputMode="url"
                        maxLength={300}
                        placeholder="https://"
                        value={urls[p] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setUrls((current) => ({ ...current, [p]: value }));
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
            {level === "platform" ? (
              <p className="text-11 text-text-secondary">
                {t("providersPage.baseUrlHint")}
              </p>
            ) : null}
          </div>
        </SettingsCard>
      </fieldset>
      {canEdit ? (
        <Button
          type="submit"
          disabled={pending}
          data-testid="ai-providers-save"
        >
          {t("providersPage.save")}
        </Button>
      ) : (
        <p className="text-12 text-text-secondary">
          {t("providersPage.readOnly")}
        </p>
      )}
    </form>
  );
}
