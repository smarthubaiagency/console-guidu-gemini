import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/**
 * Logout control. A plain form post, so it works without client JavaScript and
 * carries the Origin header the route checks.
 */
export function SignOutForm({ label }: Readonly<{ label?: string }>) {
  const t = useTranslations("ui");
  return (
    <form method="post" action="/auth/signout">
      <Button type="submit" variant="outline" data-testid="sign-out">
        {label ?? t("signOut")}
      </Button>
    </form>
  );
}
