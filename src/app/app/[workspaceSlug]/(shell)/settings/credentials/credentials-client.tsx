"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { KeyRound, Plus, Shield, Trash2, Lock } from "lucide-react";
import {
  registerCredentialAction,
  revokeCredentialAction,
  type CredentialActionState,
} from "@/core/credentials/credentials-actions";
import { type MediaKind, missingMedia } from "@/core/ai/media";
import { AI_PROVIDERS } from "@/core/credentials/providers";
import type {
  CredentialItem,
  AIProvider,
  CredentialPurpose,
} from "@/core/credentials/vault";
import { useStatus } from "@/components/feedback/status-context";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type CredentialsCapabilities = {
  canManage: boolean;
  canRead: boolean;
};

interface CredentialsClientProps {
  workspaceSlug: string;
  credentials: CredentialItem[];
  capabilities: CredentialsCapabilities;
  /** Providers the platform and the partner offer (CF6a). */
  providers?: readonly AIProvider[];
}

export function CredentialsClient({
  workspaceSlug,
  credentials,
  capabilities,
  providers = Object.keys(AI_PROVIDERS) as AIProvider[],
}: CredentialsClientProps) {
  const t = useTranslations("credentials");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<CredentialActionState | null>(null);
  const tCommon = useTranslations("common");
  const { confirmStatus } = useStatus();
  useActionStatus(feedback);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [provider, setProvider] = useState<AIProvider>(
    providers[0] ?? "openai",
  );
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [purpose, setPurpose] = useState<CredentialPurpose>("all");

  const activeProviderMeta = AI_PROVIDERS[provider];
  const locale = useLocale();
  // What the agents cannot read with a key of this provider (A5c).
  const mediaList = (kinds: readonly MediaKind[]) =>
    new Intl.ListFormat(locale, { type: "conjunction" }).format(
      kinds.map((kind) => t(`mediaKinds.${kind}`)),
    );
  const activeMissing = missingMedia(provider);

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label || !secret) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("provider", provider);
      formData.append("label", label);
      formData.append("secret", secret);
      formData.append("purpose", purpose);

      const res = await registerCredentialAction({}, formData);
      setFeedback(res);
      if (res.success) {
        setLabel("");
        setSecret("");
        setIsModalOpen(false);
      }
    });
  };

  const handleRevoke = async (credentialId: string, itemLabel: string) => {
    const confirmed = await confirmStatus({
      title: t("revokeTitle"),
      message: t("confirmRevoke", { label: itemLabel }),
      checkboxLabel: tCommon("confirmIrreversible"),
      confirmLabel: t("revokeTitle"),
      cancelLabel: t("cancel"),
      tone: "destructive",
    });
    if (!confirmed) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("credentialId", credentialId);

      const res = await revokeCredentialAction({}, formData);
      setFeedback(res);
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Action */}
      <div className="border-card-border bg-surface-card flex flex-col justify-between gap-4 rounded-xl border p-5 shadow-xs md:flex-row md:items-center">
        <div>
          <h2 className="text-16 text-text flex items-center gap-2 font-semibold">
            <Lock className="text-text-secondary h-4 w-4" />
            <span>{t("vaultTitle")}</span>
          </h2>
          <p className="text-12 text-text-secondary mt-0.5">
            {t("vaultDescription")}
          </p>
        </div>

        {capabilities.canManage && (
          <Button type="button" onClick={() => setIsModalOpen(true)}>
            <Plus />
            <span>{t("newCredential")}</span>
          </Button>
        )}
      </div>

      {/* Register form */}
      {capabilities.canManage && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="text-text-subtle h-4 w-4" />
                <span>{t("modalTitle")}</span>
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleRegister} className="space-y-4">
              <fieldset className="grid gap-2">
                <legend className="text-14 mb-2 font-medium">
                  {t("providerLabel")}
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {providers.map((pKey) => {
                    const pMeta = AI_PROVIDERS[pKey];
                    const isSelected = provider === pKey;
                    return (
                      <Button
                        key={pKey}
                        type="button"
                        variant="outline"
                        aria-pressed={isSelected}
                        onClick={() => setProvider(pKey)}
                        className={cn(
                          "text-12 h-auto flex-col items-start gap-0 p-2.5 text-left",
                          isSelected
                            ? "border-focus-ring bg-surface-raised text-text font-semibold"
                            : "text-text-subtle font-normal",
                        )}
                      >
                        <span>{pMeta.name}</span>
                        <span className="text-10 text-text-tertiary font-mono">
                          {pMeta.keyPrefix}*
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="grid gap-2">
                <Label htmlFor="credential-label">{t("labelLabel")}</Label>
                <Input
                  id="credential-label"
                  type="text"
                  required
                  placeholder={t("labelPlaceholder")}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="credential-secret">{t("secretLabel")}</Label>
                <Input
                  id="credential-secret"
                  type="password"
                  required
                  placeholder={t("secretPlaceholder", {
                    provider: activeProviderMeta.name,
                  })}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  aria-describedby="credential-secret-hint"
                  className="font-mono"
                />
                <p
                  id="credential-secret-hint"
                  className="text-11 text-text-tertiary"
                >
                  {t("expectedFormat", {
                    prefix: activeProviderMeta.keyPrefix,
                  })}
                </p>
                <p
                  className="text-11 text-text-secondary"
                  data-testid="credential-media"
                >
                  {activeMissing.length === 0
                    ? t("mediaAll")
                    : t("mediaMissing", { list: mediaList(activeMissing) })}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="credential-purpose">{t("purposeLabel")}</Label>
                <NativeSelect
                  id="credential-purpose"
                  value={purpose}
                  onChange={(e) =>
                    setPurpose(e.target.value as CredentialPurpose)
                  }
                  className="w-full"
                >
                  <NativeSelectOption value="all">
                    {t("purposeAll")}
                  </NativeSelectOption>
                  <NativeSelectOption value="chat">
                    {t("purposeChat")}
                  </NativeSelectOption>
                  <NativeSelectOption value="embeddings">
                    {t("purposeEmbeddings")}
                  </NativeSelectOption>
                </NativeSelect>
              </div>

              <div className="bg-surface-raised border-border text-11 text-text-subtle flex items-start gap-2 rounded-lg border p-3">
                <Shield className="text-success-solid mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {t.rich("encryptionNotice", {
                    strong: (chunks) => <strong>{chunks}</strong>,
                  })}
                </span>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsModalOpen(false)}
                >
                  {t("cancel")}
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? t("encrypting") : t("save")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Credentials Table */}
      <div className="border-card-border bg-surface-card overflow-hidden rounded-xl border shadow-xs">
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <h3 className="text-14 text-text font-semibold">
            {t("activeTitle", { count: credentials.length })}
          </h3>
          <span className="text-12 text-text-tertiary">
            {t("maskedNotice")}
          </span>
        </div>

        {credentials.length === 0 ? (
          <div className="text-12 text-text-tertiary p-8 text-center">
            {!capabilities.canRead ? t("noPermission") : t("empty")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-12">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-5">{t("colProvider")}</TableHead>
                  <TableHead className="px-5">{t("colLabel")}</TableHead>
                  <TableHead className="px-5">{t("colMasked")}</TableHead>
                  <TableHead className="px-5">{t("colPurpose")}</TableHead>
                  <TableHead className="px-5">{t("colStatus")}</TableHead>
                  <TableHead className="px-5 text-right">
                    {capabilities.canManage ? t("colActions") : ""}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credentials.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-text px-5 font-semibold">
                      <span className="capitalize">{item.provider}</span>
                      {missingMedia(item.provider).length > 0 ? (
                        <span
                          className="text-10 text-text-tertiary block font-normal"
                          data-testid="credential-media-short"
                        >
                          {t("mediaShort", {
                            list: mediaList(missingMedia(item.provider)),
                          })}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-text px-5 font-medium">
                      {item.label}
                    </TableCell>
                    <TableCell className="text-text-subtle bg-surface-sidebar rounded-sm px-5 font-mono">
                      {item.maskedValue}
                    </TableCell>
                    <TableCell className="text-text-subtle px-5 capitalize">
                      {item.purpose === "all"
                        ? t("purposeGeneral")
                        : item.purpose}
                    </TableCell>
                    <TableCell className="px-5">
                      <span
                        className={`text-10 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                          item.status === "active"
                            ? "bg-success-bg text-success-text border-success-border border"
                            : "bg-surface-hover text-text-secondary"
                        }`}
                      >
                        {item.status === "active" && (
                          <span className="bg-success-solid h-1.5 w-1.5 rounded-full" />
                        )}
                        {item.status === "active"
                          ? t("statusActive")
                          : t("statusRevoked")}
                      </span>
                    </TableCell>
                    <TableCell className="px-5 text-right">
                      {capabilities.canManage && item.status === "active" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={isPending}
                          onClick={() => handleRevoke(item.id, item.label)}
                          className="text-text-tertiary hover:text-danger-text hover:bg-danger-bg"
                          title={t("revokeTitle")}
                          aria-label={t("revokeTitle")}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
