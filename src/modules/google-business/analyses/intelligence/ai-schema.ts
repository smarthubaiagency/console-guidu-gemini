import { z } from "zod";

/**
 * Structured answer of the AI suggestions (GB1b). Whatever the model (or the
 * fake) returns is validated by this schema before anything else reads it;
 * the safety filters (`./ai-safety.ts`) run after the validation.
 */

/** Google's limit for the profile description. */
export const DESCRIPTION_MAX = 750;
export const REPLY_MAX = 1500;
export const MAX_REPLY_DRAFTS = 20;

export const AiSuggestionsSchema = z.object({
  description: z
    .object({ suggested: z.string().trim().min(1).max(DESCRIPTION_MAX) })
    .nullable(),
  name: z.object({
    hasKeywords: z.boolean(),
    suggested: z.string().trim().max(120).nullable(),
  }),
  categories: z
    .object({
      primary: z.string().trim().max(100).nullable(),
      additional: z.array(z.string().trim().min(1).max(100)).max(9),
    })
    .nullable(),
  replies: z
    .array(
      z.object({
        reviewId: z.string().min(1).max(300),
        text: z.string().trim().min(1).max(REPLY_MAX),
      }),
    )
    .max(MAX_REPLY_DRAFTS),
});

export type AiSuggestions = z.infer<typeof AiSuggestionsSchema>;

export type SuggestionsLanguage = "pt-BR" | "es" | "en";

/** What the AI receives: public data of the profile and its reviews. */
export type SuggestionsInput = Readonly<{
  language: SuggestionsLanguage;
  business: Readonly<{
    name: string;
    primaryCategory: string | null;
    additionalCategories: readonly string[];
    description: string | null;
    locality: string | null;
    website: string | null;
  }>;
  reviews: readonly Readonly<{
    reviewId: string;
    rating: number;
    text: string | null;
    authorFirstName: string | null;
  }>[];
}>;
