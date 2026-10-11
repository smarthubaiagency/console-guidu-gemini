# Especificação do módulo CRM (`crm`)

- **Versão:** 0.1.0
- **Estado:** beta (F4c, [plano da F4](../../../docs/operacao/plano-f4.md), decisão 3).
- **Modelo de origem:** `module-templates/standard` 1.0.0
- **Disponibilidade:** sem variável de ambiente. Aparece em Configurações › Módulos e precisa ser habilitado por workspace (owner ou admin) e estar contratado quando a empresa tem contrato.

## 1. Problema que resolve

Guardar as pessoas com quem o workspace se relaciona e servir de primeiro objeto para a API REST, o MCP e as propostas com aprovação humana (F4d). O módulo começa só com contatos. Leads, empresas, negócios e tarefas entram depois como novos objetos deste módulo, cada um com a sua tabela, as suas permissões (`crm.<objeto>.*`) e uma seção nesta especificação. Nada disso fica fixo no núcleo.

## 2. Quem usa e com quais permissões

| Permissão            | Papéis padrão                | Uso                     |
| -------------------- | ---------------------------- | ----------------------- |
| `crm.contacts.read`  | owner, admin, editor, viewer | Ver e buscar contatos   |
| `crm.contacts.write` | owner, admin, editor         | Criar e editar contatos |

Habilitar ou desabilitar o módulo no workspace exige `workspace.modules.manage` (owner e admin do workspace).

Chaves de API usam os escopos `crm:read` e `crm:write`. A chave só recebe o escopo que o papel da pessoa permite, e o papel é conferido de novo a cada requisição.

## 3. Dados que guarda

`public.crm_contacts`, por workspace:

| Campo                                                  | Regra                                                    |
| ------------------------------------------------------ | -------------------------------------------------------- |
| `name`                                                 | Obrigatório, 1 a 160 caracteres                          |
| `email`                                                | Opcional, até 254, formato de e-mail, guardado minúsculo |
| `phone`                                                | Opcional, 3 a 40 caracteres, texto livre                 |
| `company_name`                                         | Opcional, até 160; texto livre até existir "empresa"     |
| `job_title`                                            | Opcional, até 120                                        |
| `notes`                                                | Opcional, até 5.000                                      |
| `created_by`, `updated_by`, `created_at`, `updated_at` | Preenchidos pelo serviço e pelo banco                    |

São dados pessoais de terceiros (LGPD): entram na exportação e na exclusão do workspace. Sem seed em nenhum ambiente.

RLS FORCE: membros leem; owner, admin e editor inserem (assinando `created_by`) e alteram (assinando `updated_by`). Um gatilho impede mudar workspace, empresa, autor e data de criação.

## 4. Ações

| Ação            | Regra                                                           | Auditoria            |
| --------------- | --------------------------------------------------------------- | -------------------- |
| Listar e buscar | Mais recentes primeiro, cursor; busca em nome, e-mail e empresa | —                    |
| Consultar       | Id de outro workspace responde "não encontrado"                 | —                    |
| Criar           | Valida os campos, confere a cota serializada por advisory lock  | `crm.contact.create` |
| Editar          | Altera só os campos enviados; campo desconhecido é recusado     | `crm.contact.update` |

Não há exclusão de contato nesta versão.

Todas as ações conferem, nesta ordem, o estado do módulo (desabilitado ou não contratado bloqueia; suspenso deixa só a leitura), a permissão e, na criação, a cota. Telas, REST e MCP usam os mesmos serviços (`src/modules/crm/server/services/contacts.ts`). A origem da auditoria é `api` para chave de API e `app` para a tela.

## 5. Conexões

- Telas: `/app/[slug]/crm/contacts` e `/app/[slug]/crm/contacts/[contactId]`.
- REST v1: `GET`/`POST /workspaces/{id}/crm/contacts`, `GET`/`PATCH /workspaces/{id}/crm/contacts/{contactId}`.
- MCP do workspace: `list_contacts` e `get_contact` (leitura). A escrita pelo MCP só virá por proposta com aprovação humana (F4d).

## 6. Limites

Cota `crm.contacts` (contatos por workspace). Sem limite no plano, vale o padrão provisório de 5.000 (`CRM_DEFAULT_CONTACT_LIMIT`). O consumo aparece em Consumo & Limites.

## 7. Exportação, exclusão e retenção

`crmDataContract` (`src/modules/crm/data.ts`): a exportação do workspace inclui todos os contatos; a exclusão definitiva do workspace (fim da carência de 30 dias) apaga as linhas pelo worker. Sem retenção própria.

## 8. Jobs, eventos e MCP

Sem jobs nem eventos. MCP conforme a seção 5.

## 9. Critérios de aceite e testes

| Critério                                                   | Evidência                           |
| ---------------------------------------------------------- | ----------------------------------- |
| Manifesto válido e registro                                | `src/modules/registry.test.ts`      |
| RLS, autoria e imutabilidade                               | `tests/core/crm-rls.sql` (job `db`) |
| Serviços, viewer, AC08, REST com escopos, CSRF, isolamento | `tests/core/crm.test.ts` (job `db`) |
| OpenAPI das rotas                                          | `src/core/api/api.test.ts`          |
| Habilitar, adicionar, editar e buscar pela tela            | `e2e/crm.spec.ts`                   |
