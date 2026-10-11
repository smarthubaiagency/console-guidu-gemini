import { useTranslations } from "next-intl";

/**
 * Logout control. A plain form post, so it works without client JavaScript and
 * carries the Origin header the route checks.
 */
export function SignOutForm({ label }: Readonly<{ label?: string }>) {
  const t = useTranslations("ui");
  return (
    <form method="post" action="/auth/signout">
      <button
        type="submit"
        data-testid="sign-out"
        className="border-border-strong text-14 rounded-md border px-3 py-2 font-medium"
      >
        {label ?? t("signOut")}
      </button>
    </form>
  );
}
