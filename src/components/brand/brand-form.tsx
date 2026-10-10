"use client";

import { useActionState } from "react";

import { saveBrandAction, type BrandActionState } from "@/core/brand/actions";

const INITIAL: BrandActionState = {};

const field =
  "border-border bg-surface-input text-14 text-text w-full rounded-lg border px-3 py-2";
const label = "text-12 text-text-subtle font-medium";

/** Brand editor of the platform console (ADR 0012, P3). */
export function BrandForm({
  defaults,
  hasLogo,
}: Readonly<{
  defaults: {
    displayName: string;
    primaryColor: string;
    supportEmail: string;
    supportUrl: string;
  };
  hasLogo: boolean;
}>) {
  const [state, action, pending] = useActionState(saveBrandAction, INITIAL);

  return (
    <form action={action} className="space-y-4" data-testid="brand-form">
      <div className="space-y-1">
        <label htmlFor="displayName" className={label}>
          Nome exibido
        </label>
        <input
          id="displayName"
          name="displayName"
          required
          maxLength={60}
          defaultValue={defaults.displayName}
          className={field}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="primaryColor" className={label}>
          Cor primária (#rrggbb, opcional)
        </label>
        <input
          id="primaryColor"
          name="primaryColor"
          placeholder="#1976d2"
          pattern="#[0-9a-fA-F]{6}"
          defaultValue={defaults.primaryColor}
          className={field}
        />
        <p className="text-11 text-text-tertiary">
          As cores de texto e de destaque são calculadas para manter contraste
          mínimo de 4,5:1 nos temas claro e escuro.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="supportEmail" className={label}>
            E-mail de suporte (opcional)
          </label>
          <input
            id="supportEmail"
            name="supportEmail"
            type="email"
            defaultValue={defaults.supportEmail}
            className={field}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="supportUrl" className={label}>
            Página de suporte (https, opcional)
          </label>
          <input
            id="supportUrl"
            name="supportUrl"
            type="url"
            defaultValue={defaults.supportUrl}
            className={field}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="logo" className={label}>
          Logo (PNG, JPEG ou WebP, até 256 KB)
        </label>
        <input
          id="logo"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="text-12 text-text-subtle"
        />
        {hasLogo ? (
          <label className="text-12 text-text-subtle flex items-center gap-2">
            <input type="checkbox" name="removeLogo" />
            Remover o logo atual
          </label>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-on-primary text-12 rounded-lg px-4 py-2 font-semibold disabled:opacity-60"
        >
          {pending ? "Salvando..." : "Salvar nova versão"}
        </button>
        {state.error ? (
          <p role="alert" className="text-12 text-danger-text">
            {state.error}
            {state.requestId ? ` (ref. ${state.requestId.slice(0, 8)})` : ""}
          </p>
        ) : null}
        {state.message ? (
          <p role="status" className="text-12 text-success-text">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
