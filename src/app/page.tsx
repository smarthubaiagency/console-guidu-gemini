import { getTranslations } from "next-intl/server";

import { getRequestBrand } from "@/core/brand/resolve";

export default async function Home() {
  const brand = await getRequestBrand();
  const t = await getTranslations("auth.home");
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6">
      <section>
        <p className="text-text-secondary text-14 font-medium">
          {t("eyebrow")}
        </p>
        <h1 className="text-48 mt-3 font-semibold tracking-tight">
          {brand.name}
        </h1>
        <p className="text-text-secondary text-18 mt-4 max-w-xl">
          {t("tagline")}
        </p>
      </section>
    </main>
  );
}
