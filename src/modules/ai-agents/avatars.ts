/**
 * The fixed gallery of GUIDS avatars (GF1): an icon and a colour, stored as
 * `icon:colour` in `ai_agents.avatar`. Image upload waits for the Storage
 * (F5e). Shared by the server, which validates, and the screens.
 */

export const AVATAR_ICONS = [
  "bot",
  "headset",
  "smile",
  "shopping-bag",
  "briefcase",
  "sparkles",
  "store",
  "compass",
] as const;

export const AVATAR_COLORS = [
  "info",
  "success",
  "warning",
  "danger",
  "neutral",
] as const;

export type AvatarIcon = (typeof AVATAR_ICONS)[number];
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export type AgentAvatar = Readonly<{ icon: AvatarIcon; color: AvatarColor }>;

export const DEFAULT_AVATAR: AgentAvatar = { icon: "bot", color: "neutral" };

export function parseAvatar(value: unknown): AgentAvatar | null {
  if (typeof value !== "string") return null;
  const [icon, color] = value.split(":");
  return (AVATAR_ICONS as readonly string[]).includes(icon ?? "") &&
    (AVATAR_COLORS as readonly string[]).includes(color ?? "")
    ? { icon: icon as AvatarIcon, color: color as AvatarColor }
    : null;
}

export function formatAvatar(avatar: AgentAvatar): string {
  return `${avatar.icon}:${avatar.color}`;
}
