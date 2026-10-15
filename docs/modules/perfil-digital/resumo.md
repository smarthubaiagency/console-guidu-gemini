# Perfil digital — resumo para decisão

Resumo do relatório completo em [analise-legado.md](analise-legado.md). Os números de seção citados aqui apontam para ele.

## O que é a feature no legado

Cartão de visita digital público, com página própria por pessoa, vCard (`.vcf`), QR Code, formulário de contato e troca de contato que vira lead, e métricas de visualização. Quem decide o visual é o admin do workspace, por meio de um **template**. Cada template fica preso a uma **unidade** (filial), e cada pessoa pertence a uma unidade e a uma empresa.

Os dados vivem no **Directus** (CMS), e não no Postgres com RLS. Por isso a segurança depende de permissões que não estão no repositório (seção 1.1).

## Hierarquia real

```
workspace (conta: planos, domínios, contatos)
 └─ company (marca)
     └─ unit (filial: endereço, horário, template)
         └─ profile (pessoa: slug, dados públicos)
```

A premissa "empresa > unidade > usuário" está incompleta: a empresa fica dentro do workspace (seção 3.1).

## Correções às premissas

- **Papéis:** `is_workspace_admin` e `workspace_users.role` coexistem sem reconciliação (seção 3.2).
- **Usuário altera só dados pessoais:** falso. Links e SEO ficam no template, compartilhado pela unidade (seção 3.3).
- **Módulos:** além das oito seções previstas, há Bio, Contato, Unidade, Site, Arquivos, Google Business, Horário e Chat (seção 5.1).

## Achados que mudam o plano

| Sev. | Achado | Onde |
| --- | --- | --- |
| Alta | Perfil buscado só por `slug` quando o host não resolve; `slug` sem constraint única no banco | P-01 |
| Alta | Rota de SEO e de design gravam em `templateId` vindo do corpo, sem conferir a unidade | P-02, P-02b |
| Alta (produto) | Links e redes de um membro gravam no template da unidade e aparecem para todos | P-03 |
| Média | Métrica de vCard sempre zero (evento escrito com outro nome) | P-08 |
| Média | Hash de IP sem sal (reversível), formulário sem anti-spam, webhook sem bloqueio de rede interna | P-04, P-05, P-07 |
| Média | Limites de plano não aplicados na criação de membros e nas seções | P-09 |

O repositório tem 2 arquivos de teste, e nenhum cobre a feature (seção 13).

## Mapeamento para o GUIDU

| Legado | GUIDU |
| --- | --- |
| Workspace (conta) | `Organization` (hipótese, a confirmar) |
| Company (marca) | `Workspace` (hipótese, a confirmar) |
| Unit (filial) | `WorkspaceLocation` (recomendado) |
| Profile | `WorkspaceMember` + tabela nova do cartão |
| Template | Tabela nova do módulo, design validado por Zod |
| Contacts (leads) | `CrmContact` com origem registrada |
| Domínio | `WorkspaceDomain` e runtime de domínios, já prontos |
| Roles | `owner`, `admin`, `editor`, `viewer` (o legado tem `member`, que vira `editor`) |

**Unidade no GUIDU.** Recomendo a **opção A**: `WorkspaceLocation`, com um vínculo `location_members` para restringir acesso quando preciso. Mantém o workspace como fronteira de isolamento e não exige nova ADR. As opções B (um workspace por unidade) e C (equipe dentro do workspace, que altera a ADR 0018) estão detalhadas na seção 15.2.

**Rota pública.** O contrato de módulos aceita só destinos `app` e `admin` (`src/core/module-contracts/manifest.ts:81`). Para a página pública é preciso estender o contrato, com ADR própria (seção 16.4).

## Proposta de módulo (resumo)

- **Chave:** `digital-card`, nome "Perfil digital".
- **Tabelas:** `digital_card_templates`, `digital_card_sections`, `digital_cards`, `digital_card_slug_history`, `digital_card_events`, `digital_card_leads` e, se a opção A for aceita, `location_members`. Todas com RLS por `workspace_id`.
- **Telas:** editor em gaveta (`WorkbenchLayout`), lista no `AppShell`, configuração em `settings/modules/digital-card` e nos níveis plataforma e parceiro.
- **Etapas:** MVP com template, cartão do membro, página pública, vCard, QR, métricas e leads com consentimento. Fase 2 com mapa e horário, webhooks e mídia. Fase 3 com Wallet e modelos do parceiro.

## Bloqueios externos

- **Mídia:** escolha entre Supabase Storage e Cloudflare R2 (pendência F5e).
- **E-mail:** provedor transacional (pendência D-PA-08), para enviar leads por e-mail.

## Perguntas em aberto para Marcelo

1. **Mapeamento de níveis.** Confirma que workspace do legado vira `Organization`, company vira `Workspace` e unit vira `WorkspaceLocation`? **Recomendo sim.**
2. **Unidade.** Opção A (localidade dentro do workspace), B (um workspace por unidade) ou C (equipe nova)? **Recomendo A.**
3. **Links e redes por membro.** Passam a ser do membro, e não do template compartilhado? **Recomendo sim**, porque corrige P-03.
4. **Quem edita o design.** Só o admin do workspace, como no legado? O parceiro terá modelos compartilhados (fase 3)? **Recomendo que o admin do workspace edite, e o parceiro entre só na fase 3.**
5. **Rota pública.** Aprova a extensão do contrato de módulos com destino público e a ADR correspondente? Sem isso, não há página pública.
6. **Papel `member`.** Mapeia para `editor`, como proposto? Ou o GUIDU precisa de um papel novo?
7. **Retenção e IP.** O jurídico define a base legal e o prazo para leads e para o consentimento (IP cru)?
8. **Mídia e e-mail.** Quando Marcelo escolhe o Storage (F5e) e o provedor de e-mail (D-PA-08)? Ambos bloqueiam partes do MVP.
9. **Nome e chave.** `digital-card` / "Perfil digital" está bom?

As cinco primeiras são as que mudam o plano. As perguntas 6 a 9 podem ser decididas durante a implementação.
