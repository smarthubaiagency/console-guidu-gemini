import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { requireUserPage } from "@/core/auth/page-guard";
import { requestWorkspaceSync } from "@/core/matrix";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { Permissions } from "@/core/permissions/catalog";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { InboxShell } from "@/modules/inbox/components/inbox-shell";
import { loadInboxViewer } from "@/modules/inbox/server/access";
import { INBOX_SIDEBAR_COOKIE, isInboxView } from "@/modules/inbox/views";

export async function generateMetadata() {
  const t = await getTranslations("inbox");
  return { title: t("metaTitle") };
}

interface InboxPageProps {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ view?: string; room?: string }>;
}

/**
 * The Inbox in full screen (IN4a; ADR 0014, revision of 16/10/2026). The
 * guards of the parent layout ran; this page checks the module (state,
 * plan, permission) and the person's level: an unmarked editor, like
 * someone outside the workspace, gets a 404.
 */
export default async function InboxPage({
  params,
  searchParams,
}: InboxPageProps) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const identity = await requireUserPage(`/app/${workspaceSlug}/inbox`);
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  const data = await withContext(prisma, context, async (tx) => {
    const access = await resolveModulePageAccess(
      tx,
      context,
      "inbox",
      Permissions.INBOX_VIEW,
    );
    if (access.kind === "missing" || access.kind === "denied") return null;
    const viewer = await loadInboxViewer(tx, context.userId);
    if (viewer.level === null) return null;
    if (access.kind !== "ok") return { blocked: access.kind } as const;
    const [workspace, address] = await Promise.all([
      tx.workspace.findUnique({
        where: { id: context.workspaceId },
        select: { name: true },
      }),
      tx.matrixWorkspaceAddress.findUnique({
        where: { workspaceId: context.workspaceId },
        select: { mxid: true, state: true },
      }),
    ]);
    // The address of the store on the chat is made by the worker.
    if (address?.state !== "active") {
      await requestWorkspaceSync(tx, context.workspaceId);
    }
    return {
      blocked: null,
      viewer: { ...viewer, level: viewer.level },
      workspaceName: workspace?.name ?? workspaceSlug,
      address: address?.state === "active" ? address.mxid : null,
    } as const;
  });
  if (!data) notFound();

  if (data.blocked) {
    const t = await getTranslations("inbox");
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <Empty data-testid="inbox-blocked">
          <EmptyHeader>
            <EmptyTitle>{t(`blocked.${data.blocked}`)}</EmptyTitle>
            <EmptyDescription>{t("blocked.description")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link href={`/app/${workspaceSlug}`}>{t("dashboard")}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </main>
    );
  }

  const cookieStore = await cookies();
  // Who only reads has nothing of their own: they start on "Todas".
  const view = isInboxView(query.view)
    ? query.view
    : data.viewer.level === "reply"
      ? "mine"
      : "all";
  const room =
    typeof query.room === "string" && /^![^\s]{1,255}$/.test(query.room)
      ? query.room
      : null;
  return (
    <InboxShell
      workspaceSlug={workspaceSlug}
      workspaceName={data.workspaceName}
      viewer={data.viewer}
      address={data.address}
      defaultOpen={cookieStore.get(INBOX_SIDEBAR_COOKIE)?.value !== "false"}
      initialView={view}
      initialRoomId={room}
    />
  );
}
