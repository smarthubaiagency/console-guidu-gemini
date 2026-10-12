/**
 * Machine translation of the dashboard texts and legal documents (I6,
 * ADR 0013). The jobs talk to a `MachineTranslator`; the provider is chosen
 * by the environment of the process (`./provider.ts`). No implementation
 * writes to the database: the jobs validate every output and insert it
 * with origin `machine`.
 */

export type TextEntry = Readonly<{ key: string; text: string }>;

export type LanguageRef = Readonly<{
  /** BCP 47 code, such as `fr` or `es-MX`. */
  code: string;
  /** Name of the language as the platform registered it. */
  name: string;
}>;

export type LegalDocumentInput = Readonly<{ title: string; body: string }>;

export interface MachineTranslator {
  /** Provider name, for audit and results (`anthropic`, `fake`). */
  readonly provider: string;
  /**
   * Translates a chunk of dashboard texts. Returns the translations by key;
   * a key may be missing from the answer (the caller counts it as skipped).
   */
  translateTexts(
    source: LanguageRef,
    target: LanguageRef,
    entries: readonly TextEntry[],
  ): Promise<Record<string, string>>;
  /** Translates one legal document (title and body). */
  translateDocument(
    source: LanguageRef,
    target: LanguageRef,
    document: LegalDocumentInput,
  ): Promise<LegalDocumentInput>;
}

/**
 * The provider declined the request (`stop_reason: refusal`, after the
 * server-side fallback) or cut it short (`max_tokens`). Not retried: the
 * same input would end the same way. The job counts it and moves on.
 */
export class TranslationIncompleteError extends Error {
  constructor(readonly reason: "refusal" | "max_tokens" | "invalid_output") {
    super(`Machine translation incomplete: ${reason}`);
    this.name = "TranslationIncompleteError";
  }
}
