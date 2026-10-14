import { describe, expect, it } from "vitest";

import { promptTexts } from "../prompt/texts";
import { referralsInstruction } from "./referrals";

describe("referrals in the instructions (A6b)", () => {
  const texts = promptTexts("pt-BR");

  it("lists each referral with its tag and details", () => {
    const text = referralsInstruction(
      [
        {
          name: "Dr. Paulo",
          referralTag: "dermato",
          specialties: ["dermatologia", "laser"],
          city: "São Paulo",
          remote: true,
        },
        {
          name: "Ótica {Central}",
          referralTag: "otica",
          specialties: [],
          city: null,
          remote: false,
        },
      ],
      texts,
    );
    expect(text?.split("\n")).toEqual([
      texts.referral.block,
      "- Dr. Paulo (tag: dermato): dermatologia, laser; São Paulo; atende remoto",
      "- Ótica Central (tag: otica)",
    ]);
  });

  it("says nothing without referrals", () => {
    expect(referralsInstruction([], texts)).toBeNull();
  });
});
