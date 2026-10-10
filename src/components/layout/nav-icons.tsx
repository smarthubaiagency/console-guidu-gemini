import { createElement } from "react";
import {
  Bot,
  Building2,
  Code2,
  FileText,
  Gauge,
  Hand,
  KeyRound,
  Layers,
  LayoutDashboard,
  List,
  Palette,
  PlayCircle,
  Puzzle,
  Settings,
  ShoppingBag,
  Sparkles,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";

/** Allowlisted icons for generated navigation (Adendo §8.1). */
const NAV_ICONS: Record<string, LucideIcon> = {
  bot: Bot,
  building: Building2,
  code: Code2,
  "file-text": FileText,
  gauge: Gauge,
  hand: Hand,
  key: KeyRound,
  layers: Layers,
  "layout-dashboard": LayoutDashboard,
  list: List,
  palette: Palette,
  "play-circle": PlayCircle,
  puzzle: Puzzle,
  settings: Settings,
  "shopping-bag": ShoppingBag,
  sparkles: Sparkles,
  store: Store,
  users: Users,
};

export function navIcon(key: string | null | undefined): LucideIcon {
  return (key && NAV_ICONS[key]) || Puzzle;
}

/** Renders an allowlisted navigation icon. */
export function NavIcon({
  iconKey,
  className,
}: {
  iconKey: string | null;
  className?: string;
}) {
  return createElement(navIcon(iconKey), { className });
}
