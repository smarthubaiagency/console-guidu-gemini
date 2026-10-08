/** Where a signed-in identity lands when no explicit target was requested. */
export const DEFAULT_SIGNED_IN_PATH = "/app";

/**
 * Narrows a caller-supplied `next` parameter to a path inside this
 * application.
 *
 * Rejects absolute URLs, protocol-relative URLs (`//evil.example`) and
 * backslash variants that some browsers normalise into them, so a crafted
 * sign-in link cannot bounce a freshly authenticated user off-site.
 */
export function safeInternalPath(
  candidate: string | null | undefined,
  fallback: string = DEFAULT_SIGNED_IN_PATH,
): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//") || candidate.startsWith("/\\"))
    return fallback;
  if (candidate.includes("\\")) return fallback;
  return candidate;
}
