/**
 * Logout control. A plain form post, so it works without client JavaScript and
 * carries the Origin header the route checks.
 */
export function SignOutForm({ label = "Sair" }: Readonly<{ label?: string }>) {
  return (
    <form method="post" action="/auth/signout">
      <button
        type="submit"
        data-testid="sign-out"
        className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium"
      >
        {label}
      </button>
    </form>
  );
}
