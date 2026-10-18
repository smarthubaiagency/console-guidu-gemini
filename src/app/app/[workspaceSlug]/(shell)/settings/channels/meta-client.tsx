"use client";

import { MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  type ChannelActionState,
  completeMetaEmbeddedSignupAction,
  createMetaConnectionAction,
  setMetaRouteAction,
} from "@/core/channels/actions";
import type { ChannelConnectionDto } from "@/core/channels/connections";

/**
 * WhatsApp of Meta in Configurações › Canais (IN7a): the GUIDS that
 * answers each number, and the two ways of linking a number (by hand, or
 * the Embedded Signup of Meta when the GUIDU app is configured).
 */

export type GuidsChoice = Readonly<{
  id: string;
  name: string;
  active: boolean;
}>;

export type EmbeddedSignup = Readonly<{
  appId: string;
  configId: string;
}> | null;

type FormState = ChannelActionState & { formKey?: number };
const INITIAL: ChannelActionState = {};

/** The GUIDS that answers a number, or nobody. */
export function MetaRouteForm({
  workspaceSlug,
  connection,
  guids,
  agentId,
  canManage,
}: Readonly<{
  workspaceSlug: string;
  connection: ChannelConnectionDto;
  guids: readonly GuidsChoice[];
  agentId: string | null;
  canManage: boolean;
}>) {
  const t = useTranslations("channels");
  const [state, setState] = useState<ChannelActionState>(INITIAL);
  const [pending, startTransition] = useTransition();
  useActionStatus(state);
  const current = guids.find((g) => g.id === agentId);
  if (!canManage) {
    return (
      <p className="text-12 text-text-secondary" data-testid="meta-route">
        {current
          ? t("meta.answeredBy", { name: current.name })
          : t("meta.nobody")}
      </p>
    );
  }
  return (
    <div className="space-y-1" data-testid="meta-route">
      <Label htmlFor={`meta-route-${connection.id}`} className="text-12">
        {t("meta.route")}
      </Label>
      <NativeSelect
        id={`meta-route-${connection.id}`}
        size="sm"
        value={agentId ?? ""}
        disabled={pending}
        onChange={(event) => {
          const value = event.target.value;
          startTransition(async () => {
            const formData = new FormData();
            formData.append("workspaceSlug", workspaceSlug);
            formData.append("connectionId", connection.id);
            formData.append("agentId", value);
            setState(await setMetaRouteAction({}, formData));
          });
        }}
      >
        <NativeSelectOption value="">{t("meta.nobody")}</NativeSelectOption>
        {guids.map((g) => (
          <NativeSelectOption key={g.id} value={g.id}>
            {g.active ? g.name : t("owner.paused", { name: g.name })}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <p className="text-11 text-text-secondary">{t("meta.routeHint")}</p>
    </div>
  );
}

function useFieldForm(
  submit: (
    prev: ChannelActionState,
    formData: FormData,
  ) => Promise<ChannelActionState>,
) {
  const [state, action, pending] = useActionState(
    async (prev: FormState, formData: FormData): Promise<FormState> => {
      const result = await submit(prev, formData);
      const formKey = result.success ? Date.now() : prev.formKey;
      return formKey === undefined ? result : { ...result, formKey };
    },
    INITIAL as FormState,
  );
  useActionStatus(state);
  return { state, action, pending, errors: state.fieldErrors ?? {} };
}

function Field({
  prefix,
  name,
  label,
  errors,
  ...props
}: Readonly<
  {
    prefix: string;
    name: string;
    label: string;
    errors: Record<string, string>;
  } & React.ComponentProps<typeof Input>
>) {
  const id = `${prefix}-${name}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-12">
        {label}
      </Label>
      <Input
        id={id}
        name={name}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${id}-error` : undefined}
        {...props}
      />
      {errors[name] ? (
        <p id={`${id}-error`} className="text-11 text-destructive">
          {errors[name]}
        </p>
      ) : null}
    </div>
  );
}

/** Linking a number of Meta: the Embedded Signup, or by hand. */
export function MetaForm({
  workspaceSlug,
  embedded,
}: Readonly<{ workspaceSlug: string; embedded: EmbeddedSignup }>) {
  const t = useTranslations("channels");
  const manual = useFieldForm(createMetaConnectionAction);
  return (
    <Card data-testid="meta-new">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          {t("meta.title")}
        </CardTitle>
        <CardDescription>{t("meta.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <EmbeddedSignupButton
          workspaceSlug={workspaceSlug}
          embedded={embedded}
        />
        <form
          key={manual.state.formKey ?? "form"}
          action={manual.action}
          className="grid gap-4 sm:grid-cols-2"
          data-testid="create-meta"
        >
          <p className="text-12 text-text font-medium sm:col-span-2">
            {t("meta.manual")}
          </p>
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          <Field
            prefix="meta"
            name="name"
            label={t("new.name")}
            errors={manual.errors}
            required
            maxLength={80}
            placeholder={t("meta.namePlaceholder")}
          />
          <Field
            prefix="meta"
            name="phoneNumberId"
            label={t("meta.phoneNumberId")}
            errors={manual.errors}
            required
            inputMode="numeric"
          />
          <Field
            prefix="meta"
            name="wabaId"
            label={t("meta.wabaId")}
            errors={manual.errors}
            required
            inputMode="numeric"
          />
          <Field
            prefix="meta"
            name="accessToken"
            label={t("meta.accessToken")}
            errors={manual.errors}
            required
            type="password"
            autoComplete="off"
          />
          <p className="text-11 text-text-secondary sm:col-span-2">
            {t("meta.manualHint")}
          </p>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={manual.pending}>
              {t("meta.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

type FacebookSdk = {
  init(options: Record<string, unknown>): void;
  login(
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: Record<string, unknown>,
  ): void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = "https://connect.facebook.net/pt_BR/sdk.js";

/** Loads the JavaScript SDK of Meta once. */
function useFacebookSdk(appId: string | null): boolean {
  const [ready, setReady] = useState(
    () => typeof window !== "undefined" && Boolean(window.FB),
  );
  useEffect(() => {
    if (!appId || window.FB) return;
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: "v21.0",
      });
      setReady(true);
    };
    if (!document.querySelector(`script[src="${SDK_URL}"]`)) {
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      document.body.appendChild(script);
    }
  }, [appId]);
  return ready;
}

/**
 * "Conectar com a Meta": the login of Meta opens, the person picks or
 * creates the business account and the number, and the screen sends the
 * code and the ids to the server. Without the GUIDU app configured the
 * button says so (plano-in7.md §6, answer 12: simulated until then).
 */
function EmbeddedSignupButton({
  workspaceSlug,
  embedded,
}: Readonly<{ workspaceSlug: string; embedded: EmbeddedSignup }>) {
  const t = useTranslations("channels");
  const ready = useFacebookSdk(embedded?.appId ?? null);
  const session = useRef<{ phoneNumberId?: string; wabaId?: string }>({});
  const [state, setState] = useState<ChannelActionState>(INITIAL);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  useActionStatus(state);

  useEffect(() => {
    // Meta tells the chosen account and number by a message of its window.
    const onMessage = (event: MessageEvent) => {
      if (!/facebook\.com$/.test(new URL(event.origin).hostname)) return;
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data.data) {
          session.current = {
            phoneNumberId: String(data.data.phone_number_id ?? ""),
            wabaId: String(data.data.waba_id ?? ""),
          };
        }
      } catch {
        // Other messages of the page.
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!embedded) {
    return (
      <div className="space-y-1" data-testid="meta-embedded">
        <Button type="button" variant="outline" disabled>
          {t("meta.embedded")}
        </Button>
        <p className="text-11 text-text-secondary">
          {t("meta.embeddedUnavailable")}
        </p>
      </div>
    );
  }

  const start = () => {
    window.FB?.login(
      (response) => {
        const code = response.authResponse?.code;
        const { phoneNumberId, wabaId } = session.current;
        if (!code || !phoneNumberId || !wabaId) return;
        startTransition(async () => {
          const formData = new FormData();
          formData.append("workspaceSlug", workspaceSlug);
          formData.append("name", name.trim() || t("meta.namePlaceholder"));
          formData.append("code", code);
          formData.append("phoneNumberId", phoneNumberId);
          formData.append("wabaId", wabaId);
          setState(await completeMetaEmbeddedSignupAction({}, formData));
        });
      },
      {
        config_id: embedded.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  };

  return (
    <div className="space-y-2" data-testid="meta-embedded">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="meta-embedded-name" className="text-12">
            {t("new.name")}
          </Label>
          <Input
            id="meta-embedded-name"
            value={name}
            maxLength={80}
            placeholder={t("meta.namePlaceholder")}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="button" disabled={!ready || pending} onClick={start}>
          {t("meta.embedded")}
        </Button>
      </div>
      <p className="text-11 text-text-secondary">{t("meta.embeddedHint")}</p>
    </div>
  );
}
