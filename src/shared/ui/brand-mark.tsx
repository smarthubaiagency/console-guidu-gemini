import Image from "next/image";

/**
 * Brand mark of the request host (ADR 0012, P3): the partner logo when one
 * is set, otherwise the first letter of the brand name on the primary color.
 * The logo is served by `/brand/logo/[version]` from the same origin.
 */
export function BrandMark({
  name,
  logoUrl,
  size = "sm",
}: Readonly<{
  name: string;
  logoUrl?: string | null | undefined;
  size?: "sm" | "md";
}>) {
  const box =
    size === "md" ? "h-7 w-7 rounded-lg text-14" : "h-6 w-6 rounded-sm text-12";
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt={name}
        width={size === "md" ? 28 : 24}
        height={size === "md" ? 28 : 24}
        unoptimized
        className={`${size === "md" ? "h-7" : "h-6"} w-auto object-contain`}
        data-testid="brand-logo"
      />
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
