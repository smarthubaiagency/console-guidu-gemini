import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/shared/ui/theme-provider";
import { appConfig } from "@/core/config/app";
import "./globals.css";

const outfit = localFont({
  src: "./fonts/Outfit-Variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: appConfig.name,
  description: "Plataforma SaaS modular",
};
export const runtime = "nodejs";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={outfit.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
