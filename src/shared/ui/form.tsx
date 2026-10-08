import type { InputHTMLAttributes, ReactNode } from "react";

/**
 * Labelled input. The hint is wired with `aria-describedby` instead of living
 * inside the label, so assistive technology (and the test selectors) read the
 * field name on its own.
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
    <div>
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        {...input}
        id={name}
        name={name}
        {...(hint ? { "aria-describedby": hintId } : {})}
        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
      {hint ? (
        <p id={hintId} className="text-muted-foreground mt-1 text-xs">
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
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
    >
      {pending ? "Enviando…" : children}
    </button>
  );
}
