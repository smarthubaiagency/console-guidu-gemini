import { cn } from "@/lib/utils";

/** Splits a formatted number into the whole part and the decimal part. */
export function splitAmount(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): { whole: string; fraction: string } {
  const parts = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  }).formatToParts(value);
  const start = parts.findIndex((part) => part.type === "decimal");
  if (start === -1) {
    return { whole: parts.map((part) => part.value).join(""), fraction: "" };
  }
  const end = parts.findLastIndex((part) => part.type === "fraction");
  const join = (list: Intl.NumberFormatPart[]) =>
    list.map((part) => part.value).join("");
  return {
    whole: join(parts.slice(0, start)) + join(parts.slice(end + 1)),
    fraction: join(parts.slice(start, end + 1)),
  };
}

/**
 * A number or amount with the cents in grey (U4, ADR 0021), as in the
 * model cards. Optional: plain text is still fine.
 */
export function Amount({
  value,
  locale,
  currency,
  className,
}: Readonly<{
  value: number;
  locale: string;
  currency?: string;
  className?: string;
}>) {
  const { whole, fraction } = splitAmount(
    value,
    locale,
    currency ? { style: "currency", currency } : {},
  );
  return (
    <span className={cn("tabular-nums", className)}>
      {whole}
      {fraction ? <span className="text-text-tertiary">{fraction}</span> : null}
    </span>
  );
}
