# C09 — Convite vinculado ao destinatário e rota `/invite/[token]`

> Copie todo o conteúdo abaixo da linha para o Antigravity.

---

Você vai trabalhar no repositório **console-guidu-gemini** (Next.js 16, React 19, Prisma 6, Supabase Auth SSR, pnpm).

**Antes de qualquer alteração, leia:** `AGENTS.md`, a Especificação §8 (convites), §10 (rota `/invite/[token]`), §11 (regra de redirecionamento) e §18 (vagas), `src/core/organizations/invitations.ts`, `src/core/auth/identity.ts`, `docs/correcoes/README.md` (regras comuns, que valem integralmente) e o guia de rotas dinâmicas e Server Actions em `node_modules/next/dist/docs/`.

**Branch:** `fix/C09-convite-destinatario`, a partir da `main` com a C08 integrada. Entregue via PR.

## Contexto

- `acceptInvitation(prisma, { rawToken, userId })` **não confere** se o usuário autenticado é o destinatário do convite. Quem tiver o link aceita. A §8 exige: "Convites têm uso único e vínculo com destinatário verificado. A conta existente aceita o convite sem duplicar identidade."
- Não existe a rota `/invite/[token]` (§10), então o fluxo de convite não pode ser usado de ponta a ponta.
- `organizations.max_seats` tem `default 5`. Esse número foi inventado: planos, preços e cotas são pendência do Comercial.

## Objetivo

Aceite de convite seguro e utilizável: só o destinatário verificado aceita, por uma rota que não expõe o token em logs, com estados claros.

## Requisitos

1. **Vínculo ao destinatário** em `acceptInvitation`:
   - a função recebe a identidade validada no servidor (`Identity` de `requireUser()`), não um `userId` solto;
   - exige que o e-mail da identidade esteja **confirmado** (`email_confirmed_at` nas claims ou no usuário; veja como `identity.ts` obtém os dados) e que `lower(identity.email) === lower(invitation.email)`;
   - se o e-mail não corresponder, `InvitationRecipientMismatchError`, com a mensagem segura "Este convite foi enviado para outro e-mail." O e-mail do convite **não** é revelado;
   - toda a lógica continua numa única transação com advisory lock (AC06).
2. **Rota `src/app/invite/[token]/page.tsx`** (Server Component):
   - sem sessão: redirecionar para `/login?next=/invite/<token>`. Use os helpers de redirect existentes (`src/core/auth/redirects.ts`) e garanta que `next` aceita esse caminho;
   - com sessão: mostrar organização e workspace de destino e o papel, lidos com o contexto `app.invitation_token_hash` (a policy `organizations_select_by_invitation` existe para isso), e um botão "Aceitar" que dispara uma Server Action `acceptInvitationAction`;
   - estados explícitos: convite expirado, revogado, já aceito, destinatário diferente, limite de vagas atingido e sucesso. No sucesso, redirecionar para `/app/<workspaceSlug>` ou `/app`;
   - **o token nunca vai para logs, telemetria ou mensagens de erro**. Não use o token como `key` de nada que seja logado. Adicione `export const dynamic = "force-dynamic"` se necessário e confira que o `proxy.ts` não loga a URL.
   - `src/proxy.ts`: incluir `/invite` no comportamento adequado (pública com redirecionamento ao login, ou só para usuário logado), mantendo o padrão do arquivo.
3. **Link do convite:** em `createInvitation`, o link retornado para a UI de equipe usa `appConfig.url` (C05) + `/invite/<rawToken>`, e é exibido uma única vez. O envio por e-mail **não** faz parte desta tarefa (o provedor de e-mail é pendência); registre isso no PR.
4. **Vagas:** **não** mude o número. Acrescente em `docs/pendencias.md`, na linha "Planos, preços e cotas", a nota "`organizations.max_seats` usa default técnico 5 até o Comercial definir; não é regra comercial". Coloque o mesmo texto num comentário na migration nova, se criar alguma. Esta tarefa não deve precisar de migration.

## Testes

- Integração (`membership.test.ts`):
  - destinatário correto e e-mail confirmado: aceita;
  - e-mail diferente: `InvitationRecipientMismatchError`, sem nenhum vínculo criado;
  - e-mail não confirmado: negado;
  - aceite duplo: negado (já existe; mantenha).
- E2E (`e2e/workspaces-and-team.spec.ts` ou novo `e2e/invite.spec.ts`), usando o `fake-gotrue` do rig:
  - abrir o link deslogado leva ao login e volta ao convite;
  - aceitar com o usuário certo leva ao workspace;
  - usuário errado vê a mensagem de destinatário diferente;
  - convite expirado mostra o estado de expirado.

## Aceite

- `pnpm generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build` sem erros, e CI verde.
- Fluxo convite → login → aceite → workspace funcionando de ponta a ponta no E2E.
