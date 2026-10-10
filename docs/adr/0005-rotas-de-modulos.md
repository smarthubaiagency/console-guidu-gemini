# ADR 0005 — Rotas distintas para módulos e configurações

- **Status:** Aceito
- **Data:** 07/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** D5, documento `decisoes` da [SMA-88](https://paperclip.local/SMA/issues/SMA-88)
- **Alterada por:** [ADR 0012](0012-plataforma-de-parceiros.md). O console da plataforma passou de `/admin` para `/platform` na etapa P1; as rotas abaixo valem com esse prefixo, e `/admin` fica reservado ao console do parceiro.

## Contexto

A especificação e o adendo deixavam sobreposição entre habilitação, estado e configuração de módulos nas áreas de cliente e administração.

## Decisão

- App: `/app/[workspaceSlug]/settings/modules` é o índice de habilitação e estado; `/app/[workspaceSlug]/settings/modules/[moduleKey]` configura o módulo no workspace.
- Admin: `/admin/modules` trata disponibilidade, beta, manutenção e rollout; `/admin/settings/modules/[moduleKey]` trata políticas e configurações globais.

## Consequências

Índices operacionais e telas de configuração têm responsabilidades e destinos diferentes no registro de módulos.
