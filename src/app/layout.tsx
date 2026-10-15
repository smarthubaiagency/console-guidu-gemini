import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/shared/ui/theme-provider";
import { BrandTokens } from "@/shared/ui/brand-tokens";
import { getRequestBrand } from "@/core/brand/resolve";
import { getRequestOrigin } from "@/core/partners/resolve";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { headers } from "next/headers";
import { NONCE_HEADER } from "@/core/security/headers";
import { clientMessages } from "@/core/i18n/client-messages";
import { requestAnalytics } from "@/core/analytics/read";
import { ProductAnalytics } from "@/components/analytics/product-analytics";
import "./globals.css";

const outfit = localFont({
  src: "./fonts/Outfit-Variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-outfit",
});

/**
 * Title, favicon and share card follow the brand of the request host
 * (ADR 0012, P3; CF2). Image URLs are absolute on the host's own origin.
 */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getRequestBrand();
  const origin = await getRequestOrigin().catch(() => null);
  const description = brand.tagline ?? "Plataforma SaaS modular";
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: brand.name,
    description,
    ...(brand.faviconUrl ? { icons: { icon: brand.faviconUrl } } : {}),
    openGraph: {
      siteName: brand.name,
      title: brand.name,
      description,
      ...(brand.shareImageUrl && origin
        ? { images: [{ url: brand.shareImageUrl, width: 1200, height: 630 }] }
        : {}),
    },
  };
}
export const runtime = "nodejs";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const brand = await getRequestBrand();
  const locale = await getLocale();
  const messages = await getMessages();
  // Set by src/proxy.ts for the CSP; the theme script needs it to run.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  // Product analytics of the host (CF7): null while off (the default).
  const analytics = await requestAnalytics();
  return (
    <html lang={locale} className={outfit.variable} suppressHydrationWarning>
      <head>
        <BrandTokens palette={brand.palette} />
      </head>
      <body>
        {/* Only the namespaces of browser components reach the client. */}
        <NextIntlClientProvider
          locale={locale}
          messages={clientMessages(messages)}
          timeZone="America/Sao_Paulo"
        >
          <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
          {analytics ? <ProductAnalytics config={analytics} /> : null}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
