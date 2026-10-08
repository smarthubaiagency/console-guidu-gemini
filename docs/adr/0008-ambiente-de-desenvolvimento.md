# ADR 0008 — Supabase remoto dedicado como ambiente de desenvolvimento

- **Status:** Aceito
- **Data:** 07/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** D8, documento `decisoes` da [SMA-88](https://paperclip.local/SMA/issues/SMA-88)

## Contexto

O runtime dos agentes não tem Docker nem Podman, portanto não executa `supabase start`.

## Decisão

O desenvolvimento usa o projeto Supabase dedicado `guidu`, ref `mmwmhlafzewdyqsgfkzk`, região `sa-east-1`, Postgres 17, separado da produção do CartãoPRO. Agentes podem aplicar migrations e executar SQL somente nesse projeto de desenvolvimento, sempre a partir de arquivos versionados em `supabase/migrations`. Qualquer outro projeto Supabase continua proibido e a produção será aplicada manualmente por Marcelo.

Somente dados sintéticos podem ser usados. O banco é compartilhado: apenas um agente aplica migrations por vez, depois de conferir o histórico, e migrations já aplicadas não são editadas. Reset exige pedido explícito na issue e confirmação de Marcelo. O CI sobe Supabase local e reaplica o histórico do zero.

As credenciais do ambiente de desenvolvimento chegam aos agentes como segredos de nome prefixado: `GUIDU_DEV_*` / `GUIDU_SUPABASE_*`. Agentes que atuam também no CartãoPRO recebem **apenas** os nomes prefixados e mapeiam esses valores para `DATABASE_URL` e afins **somente no comando de teste**. O motivo do prefixo é um alerta operacional: o runtime do Paperclip injeta um `DATABASE_URL` próprio, que aponta para o **banco de controle** do Paperclip e não para o `guidu`; usar a variável herdada sem mapeamento explícito leva o comando ao banco errado.

## Consequências

`supabase/migrations` é a única fonte de verdade do schema. Alterações ad hoc no painel ou SQL sem migration são proibidas. Trabalho paralelo de schema pode exigir outro projeto de desenvolvimento, mediante decisão de Marcelo.

