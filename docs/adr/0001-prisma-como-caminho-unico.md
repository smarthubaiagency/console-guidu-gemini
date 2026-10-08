# ADR 0001 — Prisma como caminho único de acesso a dados

- **Status:** Aceito — validado tecnicamente
- **Data:** 07/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** D1, documento `decisoes` da [SMA-88](https://paperclip.local/SMA/issues/SMA-88)

## Contexto

A plataforma precisa manter uma única regra de isolamento para os acessos de domínio. Manter em paralelo policies baseadas em contexto do Prisma e policies da Data API baseadas em JWT criaria dois modelos de autorização.

## Decisão

- O runtime usa Prisma conectado com o papel `app_runtime`, sem superuser, `BYPASSRLS`, propriedade das tabelas ou `SET ROLE` para papel privilegiado.
- Toda consulta de domínio roda em transação interativa com `set_config(..., true)` para `app.user_id`, `app.workspace_id`, `app.organization_id`, `app.principal_type` e `app.grant_id`. Contexto ausente nega acesso.
- As tabelas de domínio usam RLS e `FORCE ROW LEVEL SECURITY`; as policies leem apenas o contexto `app.*`.
- A Data API fica fechada para tabelas de domínio: `anon` e `authenticated` não recebem grants nelas.
- Supabase continua responsável por Auth e Storage. Buckets restritos são privados e acessados por URL assinada curta, gerada no servidor após autorização.
- Pooler: `DATABASE_URL` em modo transação (6543) com `pgbouncer=true&connection_limit=1`; a conexão "direta" dos agentes usa o Session pooler (5432), porque a conexão direta do Supabase é IPv6-only.
- Esta decisão substitui o caminho alternativo com JWT da seção 9 da especificação.

## Consequências

Repositories precisam operar dentro da transação contextualizada. O isolamento continua sendo provado com contexto ausente, inválido, concorrência e reutilização de conexão em cada mudança de schema. A equipe não implementa o caminho alternativo por conta própria; qualquer retorno a ele volta ao Marcelo como nova decisão.

## Validação técnica

**Validada tecnicamente.** O spike [SMA-92 / F0.4](https://paperclip.local/SMA/issues/SMA-92) foi concluído e revisado na [SMA-108](https://paperclip.local/SMA/issues/SMA-108); a validação independente da [SMA-111](https://paperclip.local/SMA/issues/SMA-111) fechou 11/11 testes no Supavisor 6543 e no Session pooler 5432, e a [SMA-113](https://paperclip.local/SMA/issues/SMA-113) deixou o CI local verde. A prova cobre o isolamento SQL entre dois workspaces, a negação sem contexto, a FK composta, a ausência de grants para `anon`/`authenticated`, a identidade Prisma `app_runtime` sem `BYPASSRLS`, reutilização de conexão, rollback, 60 requisições concorrentes e a negação HTTP da Data API. Registro completo em [`docs/spikes/prisma-rls.md`](../spikes/prisma-rls.md).

