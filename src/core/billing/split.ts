import { AppError } from "@/shared/errors";

/**
 * Division of a payment between platform and partner (especificação de
 * parceiros §3.2). Integer cents only:
 *
 *   platform = max(round(price × percent), minimum platform share)
 *   partner  = price − platform
 *   rule: price ≥ floor and partner ≥ 0
 *
 * In the partner pays mode there is no division: the whole amount is the
 * platform's (§3.1).
 */

export type Shares = Readonly<{
  platformShareCents: number;
  partnerShareCents: number;
}>;

export type SplitInput = Readonly<{
  priceCents: number;
  minPriceCents: number;
  minPlatformShareCents: number;
  /** Platform percentage in basis points (3000 = 30%). */
  platformPercentBp: number;
}>;

export function isCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function belowFloor(minPriceCents: number): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: `O preço não pode ficar abaixo do piso de ${formatCents(minPriceCents)}.`,
  });
}

export function computeSplit(input: SplitInput): Shares {
  const {
    priceCents,
    minPriceCents,
    minPlatformShareCents,
    platformPercentBp,
  } = input;
  if (
    !isCents(priceCents) ||
    !isCents(minPriceCents) ||
    !isCents(minPlatformShareCents) ||
    !Number.isInteger(platformPercentBp) ||
    platformPercentBp < 0 ||
    platformPercentBp > 10_000
  ) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Valores de cobrança inválidos.",
    });
  }
  if (priceCents < minPriceCents) throw belowFloor(minPriceCents);

  const byPercent = Math.round((priceCents * platformPercentBp) / 10_000);
  const platformShareCents = Math.max(byPercent, minPlatformShareCents);
  const partnerShareCents = priceCents - platformShareCents;
  if (partnerShareCents < 0) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "O repasse mínimo da plataforma é maior que o preço.",
    });
  }
  return { platformShareCents, partnerShareCents };
}

export function partnerPaysShares(amountCents: number): Shares {
  return { platformShareCents: amountCents, partnerShareCents: 0 };
}

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatCents(cents: number): string {
  return BRL.format(cents / 100);
}

/**
 * Parses an amount typed in reais ("1.234,56", "1234.56", "30") into cents.
 * Returns null for anything else; never goes through floating point sums.
 */
export function parseReais(input: string): number | null {
  const text = input.trim().replace(/^R\$\s*/, "");
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:[,.](\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const units = Number(match[1]!.replaceAll(".", ""));
  const fraction = Number((match[2] ?? "0").padEnd(2, "0"));
  const cents = units * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}
