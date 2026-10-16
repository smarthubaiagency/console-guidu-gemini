/**
 * HTTP security headers (F6a).
 *
 * The fixed headers go on every response through `next.config.ts`. The
 * Content Security Policy carries a per-request nonce, so `src/proxy.ts`
 * builds it for each page navigation; Next.js reads the nonce back from the
 * request header and stamps it on its own scripts.
 */

/** Request header that hands the nonce to the root layout. */
export const NONCE_HEADER = "x-nonce";

/** 128 random bits, base64. A fresh value for every page request. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Scripts only with the nonce (`strict-dynamic` lets them load the chunks
 * they need). Styles keep `'unsafe-inline'`: the shadcn/Radix components set
 * inline styles and inject `<style>` tags without a nonce, and a style cannot
 * run code. Development needs `'unsafe-eval'` for React's debugging and must
 * not upgrade requests, since it is served over plain HTTP. Product
 * analytics (CF7) adds its provider's origin to `connect-src`, and only
 * while it is on; scripts stay nonce-only (no third-party script is
 * loaded: the dashboard posts the events itself).
 */
export function contentSecurityPolicy(
  nonce: string,
  {
    production,
    analyticsOrigin = null,
    matrixOrigin = null,
  }: Readonly<{
    production: boolean;
    analyticsOrigin?: string | null;
    /** PROVA IN1: o homeserver Matrix, só com GUIDU_INBOX_POC=1. */
    matrixOrigin?: string | null;
  }>,
): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${analyticsOrigin && /^https:\/\/[a-z0-9.-]+$/.test(analyticsOrigin) ? ` ${analyticsOrigin}` : ""}${matrixOrigin && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(matrixOrigin) ? ` ${matrixOrigin}` : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

/**
 * Headers for every response. HSTS leaves out `includeSubDomains`: partner
 * domains (ADR 0012) belong to the partner, and their other subdomains are
 * not ours to force onto HTTPS.
 */
export function staticSecurityHeaders({
  production,
}: Readonly<{ production: boolean }>): { key: string; value: string }[] {
  return [
    ...(production
      ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
      : []),
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
  ];
}
