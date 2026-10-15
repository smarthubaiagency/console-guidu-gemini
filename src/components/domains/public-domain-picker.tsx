import { getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { choosePublicDomainAction } from "@/core/domains/actions";
import type { PublicDomainChoice } from "@/core/domains/public-service";

/**
 * Selector of the domain a tool with a public route answers on (CF2c).
 * Contract for the tools (DP1a on): load the choice in the page with
 * `publicDomainChoice(tx, { workspaceId, workspaceSlug }, { toolKey,
 * routeType })` inside the workspace context and render
 * `<PublicDomainPicker choice={…} workspaceSlug={…} canManage={…} />`.
 * "Padrão" is the default subdomain of the route type
 * (`{workspace}.{default domain}`); the other options are the workspace's
 * active own domains. Saving goes to the SmartStatusBanner; the server
 * checks the role (owner and admin) again.
 */
export async function PublicDomainPicker({
  choice,
  workspaceSlug,
  canManage,
  testId = "public-domain-picker",
}: Readonly<{
  choice: PublicDomainChoice;
  workspaceSlug: string;
  canManage: boolean;
  testId?: string;
}>) {
  const t = await getTranslations("domains");
  const select = (
    <NativeSelect
      name="domainId"
      defaultValue={choice.domainId ?? ""}
      disabled={!canManage}
      className="w-full"
    >
      <NativeSelectOption value="">
        {choice.defaultHost
          ? t("picker.default", { host: choice.defaultHost })
          : t("picker.defaultNone")}
      </NativeSelectOption>
      {choice.domains.map((domain) => (
        <NativeSelectOption key={domain.id} value={domain.id}>
          {domain.host}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );

  return (
    <div className="space-y-2" data-testid={testId}>
      {canManage ? (
        <ActionForm
          action={choosePublicDomainAction}
          submitLabel={t("picker.save")}
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          <input type="hidden" name="toolKey" value={choice.toolKey} />
          <input type="hidden" name="routeType" value={choice.routeType} />
          <Label className="flex-col items-start">
            {t("picker.label")}
            {select}
          </Label>
        </ActionForm>
      ) : (
        <Label className="flex-col items-start">
          {t("picker.label")}
          {select}
        </Label>
      )}
      <p
        className="text-12 text-text-secondary"
        data-testid="public-domain-address"
      >
        {choice.host
          ? t("picker.address", { url: `https://${choice.host}/` })
          : t("picker.none")}
      </p>
    </div>
  );
}
