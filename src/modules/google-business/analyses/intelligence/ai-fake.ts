import type { AiSuggestions, SuggestionsInput } from "./ai-schema";
import { templateReply } from "./ai-safety";

/**
 * Deterministic AI of the suggestions for tests and e2e
 * (`GB_SUGGESTIONS_PROVIDER=fake`); production refuses it at startup.
 * Same input, same answer, already within the rules.
 */
export function fakeSuggestions(input: SuggestionsInput): AiSuggestions {
  const { business } = input;
  const category = business.primaryCategory ?? "negócio local";
  const place = business.locality ? ` em ${business.locality}` : "";
  const description =
    `${business.name} é ${category}${place}. ` +
    "Atendemos com hora marcada, equipe experiente e foco em um atendimento claro do começo ao fim. " +
    "Nosso espaço foi pensado para receber bem cada pessoa, com conforto e pontualidade. " +
    "Veja os horários na ficha e fale com a gente pelos canais de atendimento.";
  return {
    description: { suggested: description.slice(0, 750) },
    name: { hasKeywords: false, suggested: null },
    categories: {
      primary: business.primaryCategory,
      additional: business.additionalCategories.slice(0, 3),
    },
    replies: input.reviews.map((review) => ({
      reviewId: review.reviewId,
      text: templateReply(
        input.language,
        review.rating,
        review.authorFirstName,
      ),
    })),
  };
}
