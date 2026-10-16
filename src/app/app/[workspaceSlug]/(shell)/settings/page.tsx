import { redirect } from "next/navigation";

import { requireUserPage } from "@/core/auth/page-guard";
import { requireWorkspaceAreaPage } from "@/core/module-runtime/page-access";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";

export default async function WorkspaceSettingsIndex({
  params,
}: Readonly<{ params: Promise<{ workspaceSlug: string }> }>) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(`/app/${workspaceSlug}/settings`);
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  // Areas beyond the dashboard need workspace.read (AT1): 404 before the
  // redirect, so the Attendant never learns the settings exist.
  await requireWorkspaceAreaPage(context);
  redirect(`/app/${workspaceSlug}/settings/general`);
}
