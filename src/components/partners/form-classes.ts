/**
 * Classes of the hand-made form fields (until U3 moves them to shadcn).
 * Kept out of `action-form.tsx`: a `"use client"` module hands server
 * components a client reference instead of the string.
 */
export const inputClass =
  "border-border bg-surface-input text-14 text-text rounded-lg border px-3 py-2";
export const labelClass =
  "text-12 text-text-subtle flex flex-col gap-1 font-medium";
