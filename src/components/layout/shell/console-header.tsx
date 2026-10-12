import Link from "next/link";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { BrandMark } from "@/shared/ui/brand-mark";

/** Top of the sidebar in /admin and /platform: brand and console name. */
export function ConsoleHeader({
  href,
  brandName,
  logoUrl,
  title,
  subtitle,
}: Readonly<{
  href: string;
  brandName: string;
  logoUrl?: string | null | undefined;
  title: string;
  subtitle: string;
}>) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" asChild>
          <Link href={href}>
            <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg">
              <BrandMark name={brandName} logoUrl={logoUrl} size="md" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{title}</span>
              <span className="truncate text-xs">{subtitle}</span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
