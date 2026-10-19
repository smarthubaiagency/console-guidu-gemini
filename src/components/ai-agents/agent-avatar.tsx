"use client";

import {
  Bot,
  Briefcase,
  Compass,
  Headset,
  type LucideIcon,
  ShoppingBag,
  Smile,
  Sparkles,
  Store,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  type AvatarColor,
  type AvatarIcon,
  DEFAULT_AVATAR,
  parseAvatar,
} from "@/modules/ai-agents/avatars";

/** The avatar of a GUIDS (GF1): an icon of the gallery on a soft colour. */

export const AVATAR_ICON: Readonly<Record<AvatarIcon, LucideIcon>> = {
  bot: Bot,
  headset: Headset,
  smile: Smile,
  "shopping-bag": ShoppingBag,
  briefcase: Briefcase,
  sparkles: Sparkles,
  store: Store,
  compass: Compass,
};

export const AVATAR_TONE: Readonly<Record<AvatarColor, string>> = {
  info: "bg-info-bg text-info-text",
  success: "bg-success-bg text-success-text",
  warning: "bg-warning-bg text-warning-text",
  danger: "bg-danger-bg text-danger-text",
  neutral: "bg-surface-inset text-text-secondary",
};

export function AgentAvatar({
  value,
  size = "md",
  className,
}: Readonly<{
  value: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}>) {
  const avatar = parseAvatar(value) ?? DEFAULT_AVATAR;
  const Icon = AVATAR_ICON[avatar.icon];
  return (
    <span
      aria-hidden
      data-avatar={`${avatar.icon}:${avatar.color}`}
      className={cn(
        "rounded-inner inline-flex shrink-0 items-center justify-center",
        AVATAR_TONE[avatar.color],
        size === "sm" && "size-6",
        size === "md" && "size-9",
        size === "lg" && "size-12",
        className,
      )}
    >
      <Icon
        className={
          size === "sm" ? "size-3.5" : size === "md" ? "size-4.5" : "size-6"
        }
      />
    </span>
  );
}
