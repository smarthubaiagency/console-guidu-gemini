import { Clock, Lock, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";

/** Texts under `modules.notice.<variant>` (I2). */
const VARIANTS = {
  denied: Lock,
  maintenance: Wrench,
  not_enabled: Clock,
  not_contracted: Lock,
  suspended: Lock,
  unavailable: Clock,
} as const;

export type ModuleNoticeVariant = keyof typeof VARIANTS;

/** Full-width state for denied, maintenance and disabled module pages. */
export function ModuleNotice({
  variant,
  text,
}: {
  variant: ModuleNoticeVariant;
  text?: string;
}) {
  const t = useTranslations("modules.notice");
  const Icon = VARIANTS[variant];
  return (
    <div className="border-border bg-surface-sidebar rounded-2xl border p-8 text-center">
      <div className="bg-info-bg text-info-text mx-auto flex h-10 w-10 items-center justify-center rounded-xl">
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="text-14 text-text mt-4 font-semibold">
        {t(`${variant}.title`)}
      </h2>
      <p className="text-12 text-text-secondary mx-auto mt-2 max-w-md leading-relaxed">
        {text ?? t(`${variant}.text`)}
      </p>
    </div>
  );
}
