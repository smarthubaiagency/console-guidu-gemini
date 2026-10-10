import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/shared/ui/theme-provider";
import { BrandTokens } from "@/shared/ui/brand-tokens";
import { getRequestBrand } from "@/core/brand/resolve";
import "./globals.css";

const outfit = localFont({
  src: "./fonts/Outfit-Variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-outfit",
});

/** Title follows the brand of the request host (ADR 0012, P3). */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getRequestBrand();
  return {
    title: brand.name,
    description: "Plataforma SaaS modular",
  };
}
export const runtime = "nodejs";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const brand = await getRequestBrand();
  return (
    <html lang="pt-BR" className={outfit.variable} suppressHydrationWarning>
      <head>
        <BrandTokens palette={brand.palette} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
