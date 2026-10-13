# Revisão de segurança F6a

- **Data:** 13/10/2026
- **Plano:** F6a do [plano da F6](../operacao/plano-f6.md#f6a--revisão-de-segurança), detalhado em 12/10 e aprovado pelo Marcelo ("pode prosseguir", 13/10/2026).
- **Escopo:** código do repositório, banco local descartável (`scripts/local/rebuild-db.sh`) e CI. Sem acesso à produção nem ao banco dev remoto.
- **Decisões do plano aplicadas:** CSP já em vigor (enforce) com nonce; escrita por sessão na API sem cabeçalho `Origin` passa a ser recusada.

## Resumo

| Severidade | Achados | Corrigidos neste PR | Pendentes                                |
| ---------- | ------- | ------------------- | ---------------------------------------- |
| Crítica    | 1       | 0                   | 1 (só o Marcelo resolve: troca de senha) |
| Alta       | 2       | 2                   | 0                                        |
| Média      | 5       | 5                   | 0                                        |
| Baixa      | 9       | 1                   | 8                                        |

O que entra no CI a partir deste PR:

- `e2e/security-headers.spec.ts`: cabeçalhos e CSP em `/app`, `/admin` e `/platform`, nenhuma violação de CSP no console, logout no domínio de parceiro.
- `tests/core/security-catalog.sql` (job `db`, 29ª suíte SQL): RLS, grants, funções `SECURITY DEFINER`, papéis e variáveis de contexto, lidos do catálogo real.
- `src/core/auth/guard-coverage.test.ts`: toda página, Route Handler e Server Action chama o guard de servidor da sua área.
- `src/core/config/env.test.ts`: conferência das variáveis na subida.
- Passo `pnpm audit --prod --audit-level high` no job `quality`.

## Achados

### Crítica

**C1. Senha do `app_migrations` do projeto dev no histórico do git.** Pendente, depende do Marcelo.

- Evidência: os commits `98ace62`, `f370c9f` e `b3c192b` (08/10) têm a URL completa com senha em `scripts/migrate.ts` e `scripts/seed-admin.ts`; `git merge-base --is-ancestor 98ace62 origin/main` confirma que estão na `main`. O `c17f998` (C01) tirou do código, mas o histórico continua público.
- Já registrado como M1 em [`docs/correcoes/README.md`](../correcoes/README.md) e na [homologação de 09/10](2026-10-09-homologacao-correcoes.md), sem confirmação de que a troca foi feita.
- Ação: `alter role app_migrations password '<nova>'` no SQL Editor do `console-guidu` e atualizar o `.env.local` de quem usa. Reescrever o histórico é opcional depois da troca.

### Alta

**A1. Nenhum cabeçalho de segurança nem CSP.** Corrigido.

- Antes: `next.config.ts` não definia cabeçalhos.
- Agora: `src/core/security/headers.ts` define a CSP e os cabeçalhos fixos.
  - Em toda resposta (`next.config.ts:15`): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` sem câmera, microfone, localização, pagamento e USB; em produção, HSTS de um ano.
  - Em cada navegação (`src/proxy.ts:67`): CSP com nonce novo por requisição. `script-src 'self' 'nonce-…' 'strict-dynamic'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src 'self'`; em produção também `upgrade-insecure-requests`. O layout raiz passa o nonce ao script do tema (`next-themes`).
- Escolhas registradas:
  - `style-src` mantém `'unsafe-inline'`: componentes shadcn/Radix definem estilos inline e injetam `<style>` sem nonce. Estilo não executa código; o bloqueio que importa é o de scripts.
  - HSTS sem `includeSubDomains`: os domínios de parceiro (ADR 0012) são do parceiro, e os outros subdomínios deles não são nossos.
  - Desenvolvimento usa `'unsafe-eval'` (exigido pelo React em dev) e não força HTTPS.
- Prova: o e2e falha se o nonce não chega ao script do tema (testado removendo o nonce: o navegador reportou 4 violações e o teste quebrou).

**A2. `@modelcontextprotocol/sdk` 1.30.1 com aviso alto** (cliente OAuth podia mandar credenciais a outro servidor de autorização). Corrigido.

- O GUIDU usa só o lado servidor do SDK em `src/core/mcp/`; o cliente aparece só em teste. Mesmo assim, atualizado para 1.31.0, a versão corrigida com mais de duas semanas (28/09/2026).

### Média

**M1. Logout bloqueado nos domínios de parceiro.** Corrigido.

- Antes: `src/app/auth/signout/route.ts` só aceitava `Origin` igual ao `APP_URL`; no domínio do parceiro o navegador manda a origem do parceiro e recebia 403. Quem conseguia sair era levado ao domínio principal.
- Agora: a origem confiável é a do host da requisição (`getRequestOrigin`): o `APP_URL` nos hosts da plataforma, o domínio do parceiro depois de confirmado como domínio ativo. Host desconhecido continua recusado. Depois de sair, a pessoa fica no mesmo domínio.
- Prova: `route.test.ts` (5 casos) e o passo de logout em `e2e/security-headers.spec.ts`.

**M2. Revogar chave de API da plataforma sem MFA.** Corrigido.

- Antes: `revokePlatformKeyAction` rodava com `requireUser` (AAL1), fora da regra de AAL2 no `/platform`. Criar chave já exigia MFA (`keys.ts:94`).
- Agora: `revokePlatformApiKey` exige MFA (`src/core/platform-api/keys.ts:194`); `tests/core/platform-api.test.ts` confere a recusa sem MFA.

**M3. Escrita na API pela sessão aceita sem `Origin`.** Corrigido (decisão do plano).

- Agora `src/core/api/handler.ts:254` só aceita escrita pela sessão com JSON e `Origin` do próprio host. Navegadores mandam `Origin` em toda escrita; clientes sem navegador usam chave de API. `tests/core/crm.test.ts` cobre formulário, outro site, sem origem e o caso válido.

**M4. Cookies de sessão sem `Secure`.** Corrigido.

- O `@supabase/ssr` não marca `Secure` por padrão. Agora os dois clientes de servidor usam `supabaseCookieOptions()` (`src/lib/supabase/config.ts:54`): `Secure` quando o `APP_URL` é HTTPS. `SameSite=Lax` e o prazo seguem o padrão da biblioteca.
- Os cookies continuam sem `HttpOnly`, por desenho do `@supabase/ssr`. A mitigação é a CSP de A1, que impede script injetado de rodar.

**M5. Variáveis de ambiente sem conferência central.** Corrigido.

- Antes: cada módulo lia `process.env` sozinho e falhava só no primeiro uso.
- Agora: `src/core/config/env.ts` valida na subida, só em produção. O web chama em `src/instrumentation.ts` e o worker em `src/worker/index.ts`. Mensagens dizem a variável e a regra, nunca o valor.
  - Web: `DATABASE_URL`, `APP_URL` (origem HTTPS), `APP_NAME`, `ENCRYPTION_KEY` (32 bytes), `PARTNER_SUBDOMAIN_BASE`, URL e chave pública do Supabase.
  - Worker: `WORKER_DATABASE_URL`, `APP_URL`, `APP_NAME`.
  - Os dois recusam `TRANSLATION_PROVIDER=fake` em produção.

### Baixa

**B1. Página do Google Business sem guard próprio.** Corrigido: agora chama `requireUserPage` e o contexto do workspace, como as demais.

**B2. Ações de plataforma sem checagem de host.** Pendente. As ações de idiomas (`src/core/i18n/actions.ts:41`), disponibilidade de módulos (`src/core/module-runtime/actions.ts:107`) e configurações de admin de Hello World e Portfólio exigem MFA e papel de admin da plataforma, mas não conferem se o host é da plataforma. O papel e o MFA continuam valendo; a diferença é só a regra da ADR 0012 de responder 404 fora dos hosts da plataforma. Proposta: usar o `platformActor` de `src/core/partners/actors.ts`.

**B3. Limite de requisições só depois da autenticação.** Pendente. Requisições com chave inválida não contam no limite (`src/core/api/rate-limit.ts`), e cada uma custa uma consulta a `resolve_api_key`. `/api/v1/me`, `/api/v1/platform/session`, o download de exportação, os comprovantes de cobrança e o logo da marca não têm limite. Proposta: limite por IP no proxy reverso (Coolify) na F6c ou F6d.

**B4. Confiança no `X-Forwarded-Host`.** Pendente, depende da implantação. `requestHost` (`src/core/partners/hosts.ts:24`) usa o primeiro `X-Forwarded-Host`. É seguro só se o proxy da produção sobrescrever esse cabeçalho. Conferir na configuração do Coolify (F6c).

**B5. Lacunas na lista de campos ocultos do log.** Pendente. `SECRET_KEY` em `src/lib/telemetry/log.ts:28` não cobre `hash`, `keyHash`, `prefix`, `dsn` e `url`. Nenhuma chamada atual registra esses campos.

**B6. Script de migration imprime o erro inteiro do Postgres** (`scripts/migrate.ts:76`). Pendente. É uma ferramenta local, mas o erro pode trazer detalhes do SQL.

**B7. Ações do GitHub fixadas por versão principal, não por SHA** (`actions/checkout@v5` e outras em `.github/workflows/ci.yml`). Pendente.

**B8. `braces` 3.0.3 com aviso alto, só em ferramentas de desenvolvimento** (`eslint-config-next` e a CLI do `shadcn`). Pendente: não há versão corrigida, e o pacote não vai para a produção. Por isso o passo do CI audita só as dependências de produção (`--prod`).

**B9. Senhas locais curtas nos handoffs** (`docs/handoff/2026-10-10-handoff.md`, `2026-10-12-handoff.md`) para `app_runtime` e `app_worker` em `127.0.0.1`. Pendente. Valem só para o banco descartável; não reutilizar em nenhum banco remoto.

## Pontos conferidos sem achado

- **RLS e grants** (catálogo real, `tests/core/security-catalog.sql`):
  - todas as tabelas de `public` e `private` têm RLS e FORCE RLS;
  - `anon`, `authenticated` e `PUBLIC` não têm privilégio em tabela, sequence ou função desses schemas, nem `CREATE` neles;
  - as 31 funções `SECURITY DEFINER` têm `search_path` vazio, pertencem ao `app_rls_helper` (as duas de gatilho são exceção) e só `app_runtime` e `app_worker` as executam;
  - só `app_runtime` e `app_worker` fazem login; nenhum papel da aplicação é superusuário, cria papel ou banco, ou ignora RLS;
  - o `app_worker` assume o `app_runtime` só com `SET ROLE`, sem herdar (F3a);
  - o schema `pgboss` é do `app_worker` por desenho, porque a fila cria as próprias tabelas.
- **Variáveis de contexto do chamador** (`app.api_key_hash`, `app.platform_api_key_hash`, `app.notification_email`): só `resolve_api_key`, `resolve_platform_api_key`, `notification_locale` e quatro políticas do `app_rls_helper` as leem.
  - As funções do helper que leem `profiles` ou `partner_members` filtram pelo próprio usuário (`current_partner_role`) ou exigem admin da plataforma antes (`get_admin_metrics`, `list_admin_users`).
  - `notification_locale` é só do worker e restaura a variável ao sair.
  - Nenhuma amplia o acesso com o valor do chamador. A suíte SQL falha se surgir uma leitura nova.
- **Guards:**
  - as 9 páginas do `/admin` usam `requirePartnerConsolePage`, as 19 do `/platform` usam `requirePlatformAdminPage`, e todas as do `/app/[workspaceSlug]` usam `requireUserPage` e o contexto do workspace;
  - as rotas da API passam por `handleApiRoute` ou `handlePlatformApiRoute`; as do MCP, pelos handlers MCP;
  - as 24 Server Actions conferem a identidade, menos o login e o pedido de recuperação de senha (que responde igual para qualquer e-mail).
- **Escopos:** toda rota REST e toda ferramenta MCP tem escopo. Nenhum escopo do catálogo fica sem uso, e nenhuma escrita usa escopo de leitura. Os escopos são conferidos em `handler.ts:214`, `platform-api/handler.ts:169` e `mcp/server.ts:177`.
- **Chaves de API:**
  - só o hash SHA-256 fica gravado;
  - a cada requisição, a chave é recusada se estiver revogada, vencida, pertencer a outro parceiro, ou se o membro tiver saído, o papel não permitir o escopo ou o workspace estiver inativo (`src/core/mcp/authenticate.ts:123-228`);
  - a chave da plataforma exige admin ativo (`src/core/platform-api/keys.ts:228-276`).
- **Limite de requisições:** com o Redis fora do ar, o limite passa a ser contado no Postgres (`src/core/api/rate-limit.ts:120-130`), sem liberar tudo. Se o Postgres também falhar, a requisição falha.
- **MCP:** recusa `Origin` de outro host. Sem `Origin` é aceito, porque é o caso normal de clientes MCP, e só autentica com chave (nunca com cookie).
- **Server Actions e CSRF:** o Next.js compara `Origin` com o host (`X-Forwarded-Host` ou `Host`). Domínios de parceiro funcionam, porque a origem e o host são o mesmo domínio. `serverActions.allowedOrigins` não é necessário.
- **Segredos no código atual:**
  - nenhuma chave privada, token, `service_role` ou senha remota no código nem no histórico, fora C1;
  - as chaves que aparecem em testes são falsas;
  - o `.gitignore` cobre `.env*`;
  - as três variáveis `NEXT_PUBLIC_*` (URL e chave pública do Supabase) podem ser públicas.
- **Logs e erros:**
  - todo log passa por `src/lib/telemetry/log.ts`, que mascara segredos e e-mails e não grava stack;
  - API, MCP e Server Actions devolvem só mensagens seguras (`toSafeError`, `actionFailure`).
- **Dependências:** nenhuma versão com `^` ou `~`, e todos os jobs do CI instalam com `--frozen-lockfile`.

## Fora do escopo

Produção, banco dev remoto, teste de invasão externo e as etapas F6b a F6f.
