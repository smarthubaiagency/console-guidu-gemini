import { notFound } from "next/navigation";

import { inboxPocEnabled } from "@/core/channels/matrix-poc/config";

import { InboxPoc } from "./inbox-poc";

/**
 * PROVA DE CONCEITO (IN1, docs/modules/inbox/prova-de-conceito.md): tela
 * crua do Inbox em `(fullscreen)/`, sem o AppShell (ADR 0014, revisão de
 * 16/10/2026). As guardas de sessão e de membro vêm do layout do
 * workspace. Só existe com GUIDU_INBOX_POC=1. A janela de verdade
 * (sidebar-09, chatbot-template, permissões `inbox.*`) é a IN4.
 */
export default async function InboxPocPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ sync?: string }>;
}) {
  if (!inboxPocEnabled()) notFound();
  const { workspaceSlug } = await params;
  const { sync } = await searchParams;
  return (
    <InboxPoc
      workspaceSlug={workspaceSlug}
      mode={sync === "sliding" ? "sliding" : "classic"}
    />
  );
}
