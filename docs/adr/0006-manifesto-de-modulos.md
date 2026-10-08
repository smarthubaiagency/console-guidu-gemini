# ADR 0006 — Um único mecanismo de configuração no manifesto

- **Status:** Aceito
- **Data:** 07/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** D6, documento `decisoes` da [SMA-88](https://paperclip.local/SMA/issues/SMA-88)

## Contexto

O manifesto menciona `configurationSchema` e componentes em `settings`, o que poderia ser interpretado como dois mecanismos concorrentes.

## Decisão

`configurationSchema` valida os dados que os componentes declarados em `settings` salvam. Eles formam um único mecanismo de configuração.

## Consequências

O contrato comum mantém validação e interface alinhadas, sem duplicar a configuração. As regras internas de cada módulo continuam dependentes de especificação própria.

