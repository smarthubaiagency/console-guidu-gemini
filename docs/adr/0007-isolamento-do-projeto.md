# ADR 0007 — GUIDU é independente do CartãoPRO

- **Status:** Aceito
- **Data:** 07/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** D7, documento `decisoes` da [SMA-88](https://paperclip.local/SMA/issues/SMA-88)

## Contexto

O GUIDU nasce em projeto e repositório próprios e não pode herdar implicitamente decisões, dados ou acessos de outro produto.

## Decisão

GUIDU é independente do CartãoPRO. Código, dados, skills de referência e credenciais do CartãoPRO não são reutilizados sem decisão explícita registrada.

## Consequências

Toda dependência compartilhada precisa ser deliberada e rastreável. O repositório e os ambientes do GUIDU permanecem isolados.

