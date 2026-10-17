"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";

import type { ConversationStatus } from "../views";

const VARIANT = {
  open: "info",
  pending: "warning",
  resolved: "success",
} as const;

/** Status of a conversation as a situation badge (ADR 0021). */
export function StatusBadge({
  status,
}: Readonly<{ status: ConversationStatus }>) {
  const t = useTranslations("inbox");
  return (
    <Badge variant={VARIANT[status]} data-status={status}>
      {t(`status.${status}`)}
    </Badge>
  );
}
