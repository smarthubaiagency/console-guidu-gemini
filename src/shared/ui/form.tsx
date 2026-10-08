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
      <label htmlFor={name} className="text-14 font-medium">
        {label}
      </label>
      <input
        {...input}
        id={name}
        name={name}
        {...(hint ? { "aria-describedby": hintId } : {})}
        className="border-border-strong bg-surface-input text-14 text-text placeholder:text-text-secondary focus:border-focus-ring mt-1 w-full rounded-md border px-3 py-2 outline-none"
      />
      {hint ? (
        <p id={hintId} className="text-text-secondary text-12 mt-1">
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
      className="bg-primary text-14 text-on-primary w-full rounded-md px-3 py-2 font-medium disabled:opacity-60"
    >
      {pending ? "Enviando…" : children}
    </button>
  );
}
