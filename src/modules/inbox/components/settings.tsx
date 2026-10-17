import { getTranslations } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/core/auth/identity";
import type { ModuleSettingsComponentProps } from "@/core/module-contracts/settings";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { listHubGuids } from "@/modules/ai-agents/server";

import { inboxConfigOf, resolveInboxService } from "../settings";
import { InboxSettingsForm } from "./settings-form";

/**
 * Inbox settings of a workspace (inbox.workspace-settings, IN6): which
 * GUIDS answers the pending conversations, or none, and the service rules
 * of the A5b. The host already checked the module and `inbox.view`; saving
 * needs `inbox.manage`, checked again by the action.
 */
export async function InboxWorkspaceSettings(
  props: ModuleSettingsComponentProps,
) {
  const t = await getTranslations("inboxGuids");
  const config = inboxConfigOf(props.config);
  const identity = await requireUser();
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    props.workspaceSlug ?? "",
  );
  const choices = await withContext(prisma, context, (tx) =>
    listHubGuids(tx, context),
  );
  return (
    <Card variant="surface" data-testid="inbox-settings">
      <CardHeader>
        <CardTitle className="text-14">{t("settings.title")}</CardTitle>
        <p className="text-12 text-text-secondary">
          {t("settings.description")}
        </p>
      </CardHeader>
      <CardContent>
        <InboxSettingsForm
          workspaceSlug={props.workspaceSlug ?? ""}
          canWrite={props.canWrite}
          agentId={config.guids_agent_id}
          choices={choices}
          service={resolveInboxService(props.config)}
        />
      </CardContent>
    </Card>
  );
}
