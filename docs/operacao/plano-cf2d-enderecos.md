# Plano da CF2d — Unidades e endereço fiscal

- **Versão:** 0.1, 15/10/2026. Nada aqui foi implementado.
- **Tipo:** ajuste de plataforma (núcleo), não regra de módulo.
- **Origem:** decisões do Marcelo em 15/10/2026, durante o planejamento do [perfil digital](../modules/perfil-digital/plano-perfil-digital.md). Pré-requisito da DP2 do perfil digital.

## 1. Decisões

1. `workspace_locations` passa a ser o cadastro de endereços do workspace usados dentro da plataforma, não só de lojas.
2. Cada endereço diz para que serve (finalidade). Um endereço pode ter mais de uma.
3. A tela "Lojas" passa a se chamar **"Unidades"**.
4. O endereço fiscal fica no **cadastro da empresa**, não em `workspace_locations`, porque a cobrança é por empresa (`subscriptions.organization_id`) e uma empresa pode ter vários workspaces. Ele será usado para cobrança e notas fiscais.
5. Uma unidade não é apagada enquanto algo apontar para ela; o normal é desativar.

## 2. Estado atual

- `workspace_locations` foi criada na F5a como cadastro de lojas e propriedades no formato Location do UCP (`docs/operacao/plano-f5.md:34`, `supabase/migrations/20261022090000_f5a_portfolio.sql:59-84`). Não tem coluna de finalidade: todo registro é tratado como loja.
- Quem lê: Portfólio (itens apontam para lojas), agente (horários) e, no futuro, Google Business (`docs/operacao/plano-f5.md:134`, `src/core/locations/service.ts:13-19`).
- Um local é desativado, nunca apagado (`status` `active` ou `inactive`).
- A empresa (`organizations`) não tem razão social, documento nem endereço. O parceiro tem `partner_billing_profiles` com `legal_name` e `tax_id` (`supabase/migrations/20261012090000_p5m_billing.sql:289-298`).

## 3. Modelo proposto

Nomes são propostas; a migration final sai na implementação.

| Onde                              | Mudança                                                                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_locations`             | Coluna `purposes text[]`, não vazia, com valores de um catálogo do núcleo: `store` (loja) e `digital_profile` (unidade do perfil digital). Linhas existentes recebem `{store}`. Novos módulos acrescentam valores.               |
| Leitores atuais                   | Portfólio, agente e Google Business passam a ler só endereços com `store`.                                                                                                                                                       |
| Cadastro da empresa (nova tabela) | `organization_billing_profiles`: razão social, documento (CNPJ com 14 dígitos ou CPF com 11, porque o plano individual pode ser pessoa física), e-mail de cobrança e endereço no mesmo formato de `workspace_locations.address`. |
| Tela                              | "Configurações › Unidades" no `/app`, com a finalidade em cada unidade. A rota e a permissão `workspace.locations.manage` continuam com o nome atual.                                                                            |
| Exclusão                          | Apagar uma unidade só quando nada aponta para ela (itens do Portfólio, template do perfil digital). Do contrário, só desativar.                                                                                                  |

## 4. Etapas

| Etapa  | Entrega                                                                                                                                                                          | Migration |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| CF2d-1 | Finalidades em `workspace_locations`, filtro nos leitores atuais, tela "Unidades" nos três idiomas, testes de que uma unidade sem `store` não aparece no Portfólio nem no agente | Sim       |
| CF2d-2 | Cadastro de cobrança da empresa (razão social, documento, e-mail e endereço fiscal), editável no `/app` pelo owner da empresa e no `/admin` pelo parceiro                        | Sim       |

## 5. Em aberto

1. Quem edita o endereço fiscal no `/app`: só o owner da empresa ou também o admin do workspace. Recomendo só o owner da empresa.
2. Se a exclusão de unidade entra na CF2d-1 ou fica para quando o perfil digital precisar dela.

## 6. Histórico

| Versão | Data       | Mudança         |
| ------ | ---------- | --------------- |
| 0.1    | 15/10/2026 | Primeira versão |
