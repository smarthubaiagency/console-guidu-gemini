import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * Brand mark of the request host (ADR 0012, P3): the partner logo when one
 * is set, otherwise the first letter of the brand name on the primary color.
 * With a dark-theme logo (CF2), each theme shows its own. The images are
 * served by `/brand/[asset]/[version]` from the same origin.
 */
export function BrandMark({
  name,
  logoUrl,
  logoDarkUrl,
  size = "sm",
}: Readonly<{
  name: string;
  logoUrl?: string | null | undefined;
  logoDarkUrl?: string | null | undefined;
  size?: "sm" | "md";
}>) {
  const box =
    size === "md" ? "h-7 w-7 rounded-lg text-14" : "h-6 w-6 rounded-sm text-12";
  const pixels = size === "md" ? 28 : 24;
  const height = size === "md" ? "h-7" : "h-6";
  if (logoUrl) {
    const logo = (
      <Image
        src={logoUrl}
        alt={name}
        width={pixels}
        height={pixels}
        unoptimized
        className={cn(
          height,
          "w-auto object-contain",
          logoDarkUrl && "dark:hidden",
        )}
        data-testid="brand-logo"
      />
    );
    if (!logoDarkUrl) return logo;
    return (
      <>
        {logo}
        <Image
          src={logoDarkUrl}
          alt={name}
          width={pixels}
          height={pixels}
          unoptimized
          className={cn(height, "hidden w-auto object-contain dark:block")}
          data-testid="brand-logo-dark"
        />
      </>
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`bg-primary text-on-primary flex items-center justify-center font-black ${box}`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
