# Contexto do GUIDU

## Produto

GUIDU é uma plataforma SaaS multiempresa e modular. A empresa é a unidade contratante; o workspace é a fronteira principal de isolamento dos dados operacionais. O produto reúne dashboard de cliente, administração interna, API REST, MCP e módulos independentes no mesmo monólito modular.

O nome GUIDU e o domínio futuro `console.guidu.co` são provisórios e configuráveis. O projeto é independente do CartãoPRO.

## Stack e execução

A base definida é Next.js App Router e React, TypeScript estrito, Supabase Postgres/Auth/SSR/Storage, Prisma, Tailwind CSS, shadcn/ui, Zod, OpenAPI, SDK MCP oficial para TypeScript, Vitest e Playwright. Jobs persistentes usam pg-boss 12.37.0 em processo worker separado.

Páginas e layouts carregam dados no servidor. Componentes cliente cuidam da interação, não da autorização definitiva. Route Handlers REST e o adaptador MCP validam transporte e identidade e chamam os mesmos serviços. Serviços revalidam autorização, plano e quotas; repositories acessam o banco em transação contextualizada. Segredos e regras de negócio permanecem no servidor.

## Invariantes

Estas invariantes vêm da seção 25 da especificação e não podem ser relaxadas silenciosamente:

- nenhuma consulta de cliente sem contexto;
- nenhuma autorização apenas no layout;
- nenhum segredo no client;
- nenhuma operação MCP sem grant;
- nenhuma ferramenta genérica privilegiada;
- nenhuma migration remota automática fora da exceção controlada da ADR 0008;
- nenhum dado fictício apresentado como métrica real;
- nenhuma mudança de plano que apague recursos implicitamente;
- nenhuma configuração interna de módulo preenchida por suposição.

## Fontes de verdade

1. [Especificação v1.0](spec/especificacao-v1.0.md).
2. [Adendo de módulos v1.1](spec/adendo-modulos-v1.1.md).
3. [ADRs aceitos](adr/), que registram as decisões D1–D8 validadas por Marcelo e prevalecem sobre os documentos anteriores onde houver conflito.
4. [Pendências abertas](pendencias.md), que não autorizam preenchimento por inferência.
5. Migrations versionadas em `supabase/migrations`, fonte de verdade do schema aplicado.

