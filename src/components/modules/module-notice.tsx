import { Clock, Lock, Wrench } from "lucide-react";

const VARIANTS = {
  denied: {
    icon: Lock,
    title: "Acesso negado",
    text: "Você não tem permissão para acessar esta área.",
  },
  maintenance: {
    icon: Wrench,
    title: "Módulo em manutenção",
    text: "As operações deste módulo estão suspensas temporariamente.",
  },
  not_enabled: {
    icon: Clock,
    title: "Módulo desabilitado",
    text: "Este módulo não está habilitado neste workspace.",
  },
  unavailable: {
    icon: Clock,
    title: "Módulo Indisponível",
    text: "Este módulo não está disponível nesta etapa da plataforma.",
  },
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
  const { icon: Icon, title, text: defaultText } = VARIANTS[variant];
  return (
    <div className="border-border bg-surface-sidebar rounded-2xl border p-8 text-center">
      <div className="bg-info-bg text-info-text mx-auto flex h-10 w-10 items-center justify-center rounded-xl">
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="text-14 text-text mt-4 font-semibold">{title}</h2>
      <p className="text-12 text-text-secondary mx-auto mt-2 max-w-md leading-relaxed">
        {text ?? defaultText}
      </p>
    </div>
  );
}
