# ADR 0001 — Prisma como caminho único de acesso a dados

- **Status:** Aceito
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
- Esta decisão substitui o caminho alternativo com JWT da seção 9 da especificação.

## Consequências

Repositories precisam operar dentro da transação contextualizada. O isolamento deve ser provado com contexto ausente, inválido, concorrência e reutilização de conexão. Se o spike falhar, a decisão volta ao Marcelo; a equipe não implementa o caminho alternativo por conta própria.

## Validação técnica

**Parcial; pendente concluir o spike [SMA-92 / F0.4](https://paperclip.local/SMA/issues/SMA-92).** Já foram provados o isolamento SQL entre dois workspaces, a negação sem contexto, a FK composta, a ausência de grants para `anon`/`authenticated` e a identidade Prisma `app_runtime` sem `BYPASSRLS`. Permanecem pendentes os testes de reutilização, rollback, 60 requisições concorrentes e overhead no Supavisor 6543, porque a URL não inclui `pgbouncer=true`, além da validação HTTP da Data API.

