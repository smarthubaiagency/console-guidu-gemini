import { NextResponse, type NextRequest } from "next/server";

import { getRequestOrigin } from "@/core/partners/resolve";
import { isFakeGoogleBusinessProvider } from "@/modules/google-business/provider";
import { GB_CALLBACK_PATH } from "@/modules/google-business/server/connect-flow";

/**
 * Consent of the fake Google Business provider (GB1a), for tests and e2e
 * only (`GOOGLE_BUSINESS_PROVIDER=fake`, refused in production): a page
 * with one checkbox per permission, like Google's screen. "Permitir" goes
 * back to our callback with the permissions ticked (`fake_grant`);
 * "Cancelar" goes back with `error`. It returns only to our own callback on
 * this host, never to another address. Everywhere else it does not exist.
 */

function allowedReturn(raw: string | null, origin: string): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.origin === new URL(origin).origin &&
      url.pathname === GB_CALLBACK_PATH
      ? url
      : null;
  } catch {
    return null;
  }
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export async function GET(request: NextRequest) {
  const origin = (await getRequestOrigin()) ?? request.nextUrl.origin;
  const back = allowedReturn(
    request.nextUrl.searchParams.get("return"),
    origin,
  );
  if (!isFakeGoogleBusinessProvider() || !back) {
    return new NextResponse(null, { status: 404 });
  }
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Google (teste)</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:40px auto">
<h1>Google (teste)</h1>
<p>A GUIDU quer acessar sua Conta do Google.</p>
<form method="post">
<input type="hidden" name="return" value="${escape(back.toString())}">
<label><input type="checkbox" name="grant" value="manage_profile" checked> Ver, editar, criar e excluir seus perfis da Empresa no Google</label><br>
<label><input type="checkbox" name="grant" value="account_identity" checked> Ver seu nome e endereço de e-mail</label><br><br>
<button type="submit" name="decision" value="allow">Permitir</button>
<button type="submit" name="decision" value="deny">Cancelar</button>
</form></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  const origin = (await getRequestOrigin()) ?? request.nextUrl.origin;
  const form = await request.formData();
  const back = allowedReturn(String(form.get("return") ?? ""), origin);
  if (!isFakeGoogleBusinessProvider() || !back) {
    return new NextResponse(null, { status: 404 });
  }
  if (form.get("decision") === "deny") {
    back.searchParams.set("error", "access_denied");
  } else {
    back.searchParams.set(
      "fake_grant",
      form.getAll("grant").map(String).join(","),
    );
  }
  return NextResponse.redirect(back, 303);
}
