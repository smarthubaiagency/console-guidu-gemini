"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
  CheckCircle2,
  Bot,
  X,
} from "lucide-react";
import {
  createApiKeyAction,
  revokeApiKeyAction,
  type ApiKeyActionState,
} from "@/core/credentials/api-keys-actions";
import type { ApiKeyItem } from "@/core/credentials/api-keys";
import { SCOPE_DEFINITIONS, DEFAULT_WORKSPACE_SCOPES } from "@/core/mcp/scopes";
import type { WorkspaceRole } from "@/core/permissions/roles";
import { useStatus } from "@/components/feedback/status-context";
import { cn } from "@/lib/utils";
import { useActionStatus } from "@/components/feedback/use-action-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type McpKeysCapabilities = {
  canManage: boolean;
  canCreate: boolean;
  canRevokeOwn: boolean;
  canRevokeAny: boolean;
  isViewer: boolean;
};

interface McpKeysClientProps {
  workspaceSlug: string;
  apiKeys: ApiKeyItem[];
  capabilities: McpKeysCapabilities;
  currentUserId: string;
  userRole: WorkspaceRole | null;
}

export function McpKeysClient({
  workspaceSlug,
  apiKeys,
  capabilities,
  currentUserId,
  userRole,
}: McpKeysClientProps) {
  const t = useTranslations("mcp");
  const format = useFormatter();
  const scopeKey = (id: string) => `scopes.${id.replace(/:/g, "_")}`;
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ApiKeyActionState | null>(null);
  const tCommon = useTranslations("common");
  const { confirmStatus } = useStatus();
  useActionStatus(feedback);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([...DEFAULT_WORKSPACE_SCOPES]);
  const [expiresInDays, setExpiresInDays] = useState(90);

  const isViewer = capabilities.isViewer || userRole === "viewer";

  const handleCopy = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 3000);
  };

  const handleScopeToggle = (scopeId: string) => {
    if (isViewer && scopeId === "proposals:write") {
      return;
    }
    setScopes((prev) =>
      prev.includes(scopeId)
        ? prev.filter((s) => s !== scopeId)
        : [...prev, scopeId],
    );
  };

  const handleCreateKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || name.trim().length === 0) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("name", name.trim());
      formData.append("expiresInDays", expiresInDays.toString());
      scopes.forEach((s) => formData.append("scopes", s));

      const res = await createApiKeyAction({}, formData);
      setFeedback(res);
      if (res.success) {
        setName("");
        setScopes([...DEFAULT_WORKSPACE_SCOPES]);
        setIsModalOpen(false);
      }
    });
  };

  const handleRevoke = async (apiKeyId: string, keyName: string) => {
    const confirmed = await confirmStatus({
      title: t("revokeTitle"),
      message: t("confirmRevoke", { name: keyName }),
      checkboxLabel: tCommon("confirmIrreversible"),
      confirmLabel: t("revokeTitle"),
      cancelLabel: t("cancel"),
      tone: "destructive",
    });
    if (!confirmed) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("apiKeyId", apiKeyId);

      const res = await revokeApiKeyAction({}, formData);
      setFeedback(res);
    });
  };

  const canRevokeItem = (item: ApiKeyItem) =>
    capabilities.canRevokeAny ||
    (capabilities.canRevokeOwn && item.userId === currentUserId);

  const hasWriteScopeSelected = scopes.includes("proposals:write");

  return (
    <div className="space-y-6">
      {/* The new key is shown once: it stays on the page to copy (ADR 0016). */}
      {feedback?.success && feedback.rawKey && (
        <div className="border-success-border bg-success-bg text-12 text-success-text space-y-3 rounded-xl border p-5">
          <div className="flex items-center justify-between">
            <div className="text-14 flex items-center gap-2 font-bold">
              <CheckCircle2 className="text-success-solid h-4 w-4" />
              <span>{t("issuedTitle")}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setFeedback(null)}
              aria-label={t("cancel")}
            >
              <X />
            </Button>
          </div>
          <p className="text-text-subtle">{t("issuedNotice")}</p>
          {
            <div className="bg-surface-card border-success-border mt-2 flex items-center justify-between gap-3 rounded-lg border p-3 shadow-xs">
              <div className="text-12 text-text truncate font-mono font-semibold select-all">
                {feedback.rawKey}
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => handleCopy(feedback.rawKey!)}
              >
                {copiedKey === feedback.rawKey ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>{t("copied")}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>{t("copyKey")}</span>
                  </>
                )}
              </Button>
            </div>
          }
        </div>
      )}

      {/* Top Banner & Action */}
      <div className="border-card-border bg-surface-card flex flex-col justify-between gap-4 rounded-xl border p-5 shadow-xs md:flex-row md:items-center">
        <div>
          <h2 className="text-16 text-text flex items-center gap-2 font-semibold">
            <Bot className="text-text-secondary h-4 w-4" />
            <span>{t("connectionTitle")}</span>
          </h2>
          <p className="text-12 text-text-secondary mt-0.5">
            {t("connectionDescription")}
          </p>
        </div>

        {capabilities.canCreate && (
          <Button type="button" onClick={() => setIsModalOpen(true)}>
            <Plus />
            <span>{t("newKey")}</span>
          </Button>
        )}
      </div>

      {/* Create key form */}
      {capabilities.canCreate && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-h-full overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="text-text-subtle h-4 w-4" />
                <span>{t("newKey")}</span>
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleCreateKey} className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="mcp-key-name">{t("nameLabel")}</Label>
                <Input
                  id="mcp-key-name"
                  type="text"
                  required
                  placeholder={t("namePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <fieldset className="grid gap-2">
                <legend className="text-14 mb-2 font-medium">
                  {t("scopesLabel")}
                </legend>
                <div className="space-y-2">
                  {SCOPE_DEFINITIONS.map((sc) => {
                    const isChecked = scopes.includes(sc.id);
                    const isWrite = sc.isWrite;
                    const isDisabled = isWrite && isViewer;
                    const id = `mcp-scope-${sc.id}`;

                    return (
                      <Label
                        key={sc.id}
                        htmlFor={id}
                        className={cn(
                          "items-start gap-3 rounded-lg border p-2.5 font-normal transition",
                          isDisabled
                            ? "border-border bg-surface-raised cursor-not-allowed opacity-60"
                            : isChecked
                              ? "border-focus-ring bg-surface-raised cursor-pointer"
                              : "border-border hover:bg-surface-hover cursor-pointer",
                        )}
                      >
                        <Checkbox
                          id={id}
                          value={sc.id}
                          checked={isChecked}
                          disabled={isDisabled}
                          onCheckedChange={() => handleScopeToggle(sc.id)}
                          className="mt-0.5"
                        />
                        <div>
                          <div className="text-12 text-text flex items-center gap-1.5 font-medium">
                            <span>
                              {t.has(`${scopeKey(sc.id)}.label`)
                                ? t(`${scopeKey(sc.id)}.label`)
                                : sc.label}
                            </span>
                            {isWrite && (
                              <Badge
                                variant="outline"
                                className="bg-warning-bg text-warning-text border-warning-border"
                              >
                                {t("write")}
                              </Badge>
                            )}
                          </div>
                          <div className="text-11 text-text-secondary">
                            {t.has(`${scopeKey(sc.id)}.desc`)
                              ? t(`${scopeKey(sc.id)}.desc`)
                              : sc.desc}
                          </div>
                          {isDisabled && (
                            <div className="text-10 text-danger-text mt-0.5 font-medium">
                              {t("viewerReadOnly")}
                            </div>
                          )}
                        </div>
                      </Label>
                    );
                  })}
                </div>

                {/* Mandatory Warning for proposals:write */}
                {hasWriteScopeSelected && (
                  <div className="border-warning-border bg-warning-bg text-11 text-warning-text mt-3 flex items-start gap-2 rounded-lg border p-3 font-medium">
                    <AlertTriangle className="text-warning-text mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <span>{t("writeWarning")}</span>
                    </div>
                  </div>
                )}
              </fieldset>

              <div className="grid gap-2">
                <Label htmlFor="mcp-key-expiry">{t("expiryLabel")}</Label>
                <NativeSelect
                  id="mcp-key-expiry"
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                  className="w-full"
                >
                  <NativeSelectOption value={30}>
                    {t("days", { days: 30 })}
                  </NativeSelectOption>
                  <NativeSelectOption value={60}>
                    {t("days", { days: 60 })}
                  </NativeSelectOption>
                  <NativeSelectOption value={90}>
                    {t("daysRecommended", { days: 90 })}
                  </NativeSelectOption>
                  <NativeSelectOption value={180}>
                    {t("days", { days: 180 })}
                  </NativeSelectOption>
                  <NativeSelectOption value={365}>
                    {t("daysOneYear", { days: 365 })}
                  </NativeSelectOption>
                </NativeSelect>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsModalOpen(false)}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={isPending || scopes.length === 0}
                >
                  {isPending ? t("issuing") : t("issue")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Keys Table */}
      <div className="border-card-border bg-surface-card overflow-hidden rounded-xl border shadow-xs">
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <h3 className="text-14 text-text font-semibold">
            {t("keysTitle", { count: apiKeys.length })}
          </h3>
          <span className="text-12 text-text-tertiary">{t("keysNotice")}</span>
        </div>

        {apiKeys.length === 0 ? (
          <div className="text-12 text-text-tertiary p-8 text-center">
            {t("empty")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-12">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-5">{t("colName")}</TableHead>
                  <TableHead className="px-5">{t("colPrefix")}</TableHead>
                  <TableHead className="px-5">{t("colScopes")}</TableHead>
                  <TableHead className="px-5">{t("colExpires")}</TableHead>
                  <TableHead className="px-5">{t("colLastUsed")}</TableHead>
                  <TableHead className="px-5">{t("colStatus")}</TableHead>
                  <TableHead className="px-5 text-right">
                    {t("colActions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-text px-5 font-semibold">
                      {item.name}
                    </TableCell>
                    <TableCell className="text-text-subtle px-5 font-mono">
                      {item.prefix}
                    </TableCell>
                    <TableCell className="px-5">
                      <div className="flex flex-wrap gap-1">
                        {item.scopes.map((sc) => (
                          <span
                            key={sc}
                            className={`text-10 rounded-xs px-1.5 py-0.5 font-mono ${
                              sc === "proposals:write"
                                ? "bg-warning-bg text-warning-text border-warning-border border font-medium"
                                : "bg-surface-hover text-text-subtle"
                            }`}
                          >
                            {sc}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-text-secondary px-5">
                      {format.dateTime(new Date(item.expiresAt), {
                        dateStyle: "short",
                      })}
                    </TableCell>
                    <TableCell className="text-text-secondary px-5">
                      {item.lastUsedAt
                        ? format.dateTime(new Date(item.lastUsedAt), {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : t("neverUsed")}
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
                      {item.status === "active" && canRevokeItem(item) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={isPending}
                          onClick={() => handleRevoke(item.id, item.name)}
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
