# C05 — Nome e domínio somente por configuração (ADR 0004)

> Copie todo o conteúdo abaixo da linha para o Antigravity.

---

Você vai trabalhar no repositório **console-guidu-gemini** (Next.js 16, React 19, pnpm).

**Antes de qualquer alteração, leia:** `AGENTS.md`, `docs/adr/0004-nome-e-dominio.md` e `docs/correcoes/README.md` (regras comuns, que valem integralmente).

**Branch:** `fix/C05-branding-configuravel`, a partir da `main` atualizada. Entregue via PR.

## Contexto

A ADR 0004 diz que o nome provisório **GUIDU** e o domínio **console.guidu.co** são **configuráveis por ambiente e nunca ficam fixos no código**. Hoje `APP_NAME` é lido com `process.env.APP_NAME ?? "GUIDU"`, repetido em três arquivos (`src/app/layout.tsx`, `src/app/page.tsx` e `src/shared/ui/auth-shell.tsx`), e o nome aparece fixo em:
- `src/components/layout/app-header.tsx` (cerca da linha 33)
- `src/components/layout/admin-header.tsx` (cerca da linha 20, "GUIDU Admin")
- `src/app/app/page.tsx` (linhas 37 e 126)
- `src/app/login/page.tsx` (linha 39, "sua conta GUIDU")
- prompts padrão de agentes (removidos na C04; confira)

Os testes (`origin.test.ts`, `route.test.ts`) usam `console.guidu.co` como **dado de teste**. Isso é aceitável e deve continuar.

## Objetivo

Uma única fonte de configuração de marca, usada por todos os textos e URLs.

## Requisitos

1. Criar `src/core/config/app.ts` exportando `appConfig = { name, url }`:
   - `name` vem de `APP_NAME`; `url` vem de `APP_URL`, passando pelo `parseAppOrigin` já existente em `src/core/auth/origin.ts`;
   - em produção (`NODE_ENV === "production"`), `APP_NAME` e `APP_URL` são **obrigatórios**: falhar com erro claro, sem fallback silencioso;
   - em desenvolvimento e teste, o padrão de `name` pode ser `"GUIDU"` e o de `url`, `http://localhost:3000`, ambos documentados no `.env.example`.
2. Componentes de **servidor** leem `appConfig` direto. Para componentes **cliente** (headers, se forem `"use client"`), passar o nome como prop a partir do layout de servidor. **Não** criar `NEXT_PUBLIC_APP_NAME`, a menos que seja inevitável; nesse caso, justifique no PR.
3. Substituir todas as ocorrências fixas listadas acima, incluindo os textos "GUIDU Admin" e "GUIDU Plataforma SaaS Modular…" (`${appConfig.name} Admin` etc.).
4. Remover as três cópias de `process.env.APP_NAME ?? "GUIDU"`.
5. Verificar com `git grep -n "GUIDU\|guidu\.co" src` que só sobram testes e comentários.

## Testes

- Unitário de `appConfig`: produção sem a variável lança erro; com a variável, usa o valor; em dev, usa o padrão.
- E2E existente `home.spec.ts` / `auth-login.spec.ts` continua passando. Se o rig definir `APP_NAME`, verifique que o texto exibido vem dele.

## Aceite

- `pnpm generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build` sem erros. `build` com `NODE_ENV=production` exige `APP_NAME` e `APP_URL`: documente isso no `.env.example` e garanta que o CI define as variáveis no job `quality`.
- Nenhum nome ou domínio fixo em código de produto.
