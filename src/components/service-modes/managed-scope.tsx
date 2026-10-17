import {
  Bot,
  KeyRound,
  Megaphone,
  MessagesSquare,
  ScrollText,
  Settings,
  Star,
  Users,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  Item,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

const AREAS = [
  { key: "guids", icon: Bot },
  { key: "campaigns", icon: Megaphone },
  { key: "reviews", icon: Star },
  { key: "crm", icon: Users },
  { key: "conversations", icon: MessagesSquare },
  { key: "settings", icon: Settings },
] as const;

/**
 * What the managing team sees in the managed mode (ADR 0020): the whole
 * workspace, never the company's AI key, every action audited. Shared by
 * Configurações › Modo de serviço and the page of the secure link.
 */
export async function ManagedScope() {
  const t = await getTranslations("serviceMode.scope");
  return (
    <div className="flex flex-col gap-3" data-testid="managed-scope">
      <p className="text-14 text-text font-semibold">{t("title")}</p>
      <ItemGroup className="grid gap-2 sm:grid-cols-2">
        {AREAS.map(({ key, icon: Icon }) => (
          <Item key={key} variant="inset" size="sm">
            <ItemMedia>
              <Icon className="text-text-secondary size-4" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t(key)}</ItemTitle>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
      <ItemGroup className="gap-2">
        <Item variant="card" size="sm">
          <ItemMedia>
            <KeyRound className="text-text-secondary size-4" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{t("keyNote")}</ItemTitle>
          </ItemContent>
        </Item>
        <Item variant="card" size="sm">
          <ItemMedia>
            <ScrollText className="text-text-secondary size-4" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{t("auditNote")}</ItemTitle>
          </ItemContent>
        </Item>
      </ItemGroup>
    </div>
  );
}
