import type { InputHTMLAttributes, ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Labelled input. The hint is wired with `aria-describedby` instead of living
 * inside the label, so assistive technology (and the test selectors) read the
 * field name on its own. Built on the shadcn `Label` and `Input` (ADR 0014).
 */
export function Field({
  label,
  name,
  hint,
  ...input
}: Readonly<
  {
    label: string;
    name: string;
    hint?: ReactNode;
  } & InputHTMLAttributes<HTMLInputElement>
>) {
  const hintId = `${name}-hint`;

  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        {...input}
        id={name}
        name={name}
        {...(hint ? { "aria-describedby": hintId } : {})}
      />
      {hint ? (
        <p id={hintId} className="text-text-secondary text-12">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({
  children,
  pending = false,
}: Readonly<{ children: ReactNode; pending?: boolean }>) {
  const t = useTranslations("ui");
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? t("submitPending") : children}
    </Button>
  );
}
