# Plano da F6a — Revisão de segurança

Proposta para aprovação do Marcelo, 12/10/2026. Nada foi codado ainda.

## Contexto

- Fontes lidas: handoff de 12/10, `AGENTS.md`, `CLAUDE.md`, `docs/context.md`, `docs/pendencias.md` e `docs/operacao/plano-f6.md`.
- Branch de trabalho: `claude/loving-davinci-f0g1ux`, a partir de `main`. Hoje ele está 1 commit à frente do `main` (o handoff de 12/10 e o `scripts/local/rebuild-db.sh`). Esse commit vai junto no PR da F6a, a menos que você prefira abrir um PR só dele antes.
- Tudo roda no banco local descartável (`rebuild-db.sh`) e no CI. Nenhum acesso ao dev remoto nem à produção.

## Objetivo

Revisar a segurança de ponta a ponta antes da produção, corrigir o que for seguro corrigir agora e registrar o resto num relatório em `docs/auditoria/`, com evidência verificável de cada ponto.

## Frentes de trabalho

### 1. Cabeçalhos HTTP, CSP, cookies e CSRF

- Hoje o `next.config.ts` não define nenhum cabeçalho de segurança. Entram: HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, bloqueio de iframe (`frame-ancestors`) e uma CSP.
- CSP com nonce gerado no `src/proxy.ts` (as páginas já são dinâmicas por causa da autenticação). Checar antes a documentação do Next 16.4 em `node_modules/next/dist/docs/`.
- Cookies do Supabase: conferir `Secure`, `SameSite` e o prazo. Os cookies do Supabase SSR não são `HttpOnly` por desenho; isso vai documentado com a mitigação (CSP).
- CSRF:
  - **Server actions:** o Next confere o `Origin` contra o host, mas não há `serverActions.allowedOrigins` configurado. Testar com domínio de parceiro e `X-Forwarded-Host` atrás do proxy do Coolify.
  - **API REST com sessão do navegador:** já exige JSON e a mesma origem. Hoje aceita escrita **sem** cabeçalho `Origin`. Avaliar se isso deve virar recusa, como no logout.
  - **Logout:** já está correto.

### 2. Segredos

- Varredura do repositório e do histórico git atrás de chaves, senhas e tokens.
- Logs (`src/lib/telemetry/log.ts`) e mensagens de erro da API, do MCP e das telas: nenhum segredo, hash de chave ou stack de erro vazando.
- Variáveis `NEXT_PUBLIC_*`: só o que pode ir ao navegador.
- **Conferência das variáveis na subida:** hoje cada módulo lê `process.env` por conta própria. Proposta: um esquema Zod único, validado ao iniciar o web e o worker, que falha com mensagem clara em produção se faltar algo obrigatório (sem imprimir valores).

### 3. Dependências

- `pnpm audit`, com cada achado classificado (afeta ou não o GUIDU) e atualizado quando houver versão corrigida com pelo menos duas semanas.
- Conferir que o `package.json` não tem `^` nem `~` e que o CI instala com `--frozen-lockfile`.
- Novo passo no CI que falha com vulnerabilidade alta ou crítica.

### 4. RLS e permissões de ponta a ponta

- **Nova suíte SQL** (entra no job `db` do CI), rodando sobre o catálogo real do banco e não sobre os arquivos (armadilha 1 do handoff). Ela confere que:
  - toda tabela de `public` e `private` tem RLS e FORCE RLS;
  - `anon` e `authenticated` não têm grant em nenhuma tabela;
  - toda função SECURITY DEFINER tem `search_path` fixo, o dono esperado (`app_rls_helper`) e `EXECUTE` só para os papéis previstos;
  - os papéis `app_runtime`, `app_worker` e `app_migrations` têm só os privilégios esperados.
- **Pontos já conhecidos:**
  - variáveis de contexto definidas por quem chama (`app.notification_email`, `app.platform_api_key_hash`): provar que nenhuma outra função do helper as usa para ampliar o acesso;
  - `private.resolve_api_key` e o parceiro da chave;
  - jobs de plataforma (I6 e F3c) que não revalidam a permissão de quem pediu na hora de executar.
- **Matriz de permissões contra o código:** um teste que percorre as páginas, os Route Handlers e as server actions e confere que cada um passa por um guard de servidor, e não só pelo layout.
- **Autenticação:** MFA (AAL2) no `/admin` e no `/platform`, redirecionamentos (`safeInternalPath`), tokens de convite e de troca de senha.

### 5. API REST e MCP

- Todas as rotas exigem o escopo certo; um teste compara o catálogo de escopos com as rotas e ferramentas.
- Limites de requisição aplicados em todas as rotas, inclusive `/api/v1/platform`, `/mcp` e `/mcp/platform`, e o comportamento quando o Redis cai.
- **Origem do MCP:** já recusa `Origin` de outro host. Confirmar o uso de `X-Forwarded-Host` e o caso sem `Origin`, que é o normal de clientes MCP.
- Revalidação das chaves a cada requisição: revogada, expirada, de outro parceiro ou de membro removido. Conferir também que só o hash fica gravado.

## Entrega

1. **Relatório** `docs/auditoria/2026-10-xx-revisao-seguranca-f6a.md`. Cada item terá a severidade (crítica, alta, média, baixa), a evidência (`arquivo:linha`, consulta SQL ou teste), o estado (corrigido ou pendente) e o PR correspondente.
2. **PR da F6a, um só, como no combinado.** Leva o relatório e as correções de baixo risco: cabeçalhos e CSP, conferência de variáveis, passo de auditoria no CI, a suíte SQL nova e os testes de cobertura de guards e escopos.
3. **Correções que precisam de migration ou de mudança de desenho** (por exemplo, a revalidação nos jobs de plataforma) ficam descritas no relatório e viram PRs próprios (F6a-2, F6a-3…), cada um depois do seu "pode começar".

## Testes e aceite

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, mais o e2e completo e `rebuild-db.sh` com 29 suítes PASS (as 28 de hoje mais a nova).
- E2E novo que confere os cabeçalhos e a CSP numa página do `/app`, do `/admin` e do `/platform`, sem erro de CSP no console.
- CI verde nos jobs `quality`, `db` e `e2e`.

## Fora do escopo

Produção, banco dev remoto, teste de invasão externo e as etapas F6b a F6f.

## Preciso de você

1. **Acesso de escrita ao repositório.** Hoje esta sessão só lê. Quando você disser "pode começar", eu peço o acesso de escrita ao GitHub e você aprova.
2. **CSP:** proponho já aplicar (enforce) com nonce. A alternativa é começar só reportando (Report-Only) e aplicar depois.
3. **API sem `Origin`:** proponho recusar escrita por sessão sem o cabeçalho `Origin`, como no logout. Isso não afeta chaves de API.
