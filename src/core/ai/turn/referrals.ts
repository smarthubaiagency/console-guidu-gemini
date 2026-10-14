import type { PromptTexts } from "../prompt/texts";

/**
 * The business's referrals in the instructions of a GUIDS that may refer
 * (A6b): one line each, with the tag the tool takes. Written by the
 * workspace and its partner, so trusted; cut to a short size anyway.
 */

export const MAX_REFERRALS_IN_PROMPT = 50;

export type PromptReferral = Readonly<{
  name: string;
  referralTag: string;
  specialties: readonly string[];
  city: string | null;
  remote: boolean;
}>;

const clip = (value: string, max: number) =>
  value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

export function referralsInstruction(
  referrals: readonly PromptReferral[],
  texts: PromptTexts,
): string | null {
  if (referrals.length === 0) return null;
  const lines = referrals.slice(0, MAX_REFERRALS_IN_PROMPT).map((r) => {
    const details = [
      r.specialties.length > 0 ? clip(r.specialties.join(", "), 300) : null,
      r.city ? clip(r.city, 80) : null,
      r.remote ? texts.referral.remote : null,
    ].filter(Boolean);
    const tail = details.length > 0 ? `: ${details.join("; ")}` : "";
    return `- ${clip(r.name, 120)} (tag: ${clip(r.referralTag, 80)})${tail}`;
  });
  return [texts.referral.block, ...lines].join("\n");
}
