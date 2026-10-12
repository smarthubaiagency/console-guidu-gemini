import { Store, Clock } from "lucide-react";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("googleBusiness");
  return { title: t("metaTitle") };
}

export default async function GoogleBusinessPage() {
  const t = await getTranslations("googleBusiness");
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
          <span>{t("breadcrumbModules")}</span>
          <span>/</span>
          <span>{t("title")}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-ai-bg text-ai-text border-ai-border rounded-lg border p-2">
            <Store className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-12 text-text-secondary">{t("description")}</p>
          </div>
        </div>
      </div>

      <div className="border-border bg-surface-sidebar rounded-2xl border p-8 text-center">
        <div className="bg-ai-bg text-ai-text mx-auto flex h-10 w-10 items-center justify-center rounded-xl">
          <Clock className="h-5 w-5" />
        </div>
        <h2 className="text-14 text-text mt-4 font-semibold">
          {t("inDevelopment.title")}
        </h2>
        <p className="text-12 text-text-secondary mx-auto mt-2 max-w-md leading-relaxed">
          {t("inDevelopment.body")}
        </p>
      </div>
    </div>
  );
}
