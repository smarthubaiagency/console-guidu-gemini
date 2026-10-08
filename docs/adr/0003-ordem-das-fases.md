# ADR 0003 — Operação antecede API e MCP

- **Status:** Aceito
- **Data:** 07/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** D3, documento `decisoes` da [SMA-88](https://paperclip.local/SMA/issues/SMA-88)

## Contexto

API e MCP dependem de controles operacionais de credenciais, consumo, execução e rastreabilidade.

## Decisão

A ordem é: F0 Decisões → F1 Fundação → F2 Dashboard e contrato de módulos → F3 Operação → F4 API REST e MCP de leitura → F5 Primeiro módulo (Catálogo) → F6 Produção.

## Consequências

Cofre BYOK, quotas, jobs e auditoria precisam estar prontos antes da exposição da API e do MCP. Esta ordem substitui a seção 23 da especificação onde houver conflito.

