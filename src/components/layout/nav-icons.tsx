import { createElement } from "react";
import {
  Activity,
  Bot,
  BellRing,
  Building2,
  Code2,
  CreditCard,
  FileText,
  Gauge,
  Globe,
  Hand,
  Handshake,
  Inbox,
  KeyRound,
  Languages,
  Layers,
  LayoutDashboard,
  List,
  Mail,
  MapPin,
  Palette,
  PlayCircle,
  Plug,
  Puzzle,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";

/** Allowlisted icons for generated navigation (Adendo §8.1). */
const NAV_ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  bell: BellRing,
  bot: Bot,
  building: Building2,
  code: Code2,
  "credit-card": CreditCard,
  "file-text": FileText,
  gauge: Gauge,
  hand: Hand,
  globe: Globe,
  mail: Mail,
  handshake: Handshake,
  inbox: Inbox,
  key: KeyRound,
  layers: Layers,
  "layout-dashboard": LayoutDashboard,
  list: List,
  "map-pin": MapPin,
  palette: Palette,
  languages: Languages,
  "play-circle": PlayCircle,
  plug: Plug,
  puzzle: Puzzle,
  "scroll-text": ScrollText,
  settings: Settings,
  shield: ShieldCheck,
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
