import type { Metadata } from "next";
import "./globals.css";

const appName = process.env.APP_NAME ?? "GUIDU";
export const metadata: Metadata = {
  title: appName,
  description: "Plataforma SaaS modular",
};
export const runtime = "nodejs";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
