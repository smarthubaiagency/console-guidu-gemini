# Matriz de Permissões e Controle de Acesso (RBAC)

Este documento define o modelo de autorização, o catálogo de permissões, a matriz papel × permissão e os guards de segurança da plataforma, conforme a **Especificação v1.0 (§4, §7 e §25)** e a correção **C06**.

---

## 1. Origem e Fundamentação

A **Especificação v1.0 (§7)** estabelece:

> _"Papéis mapeiam permissões, como `workspace.members.invite` e `integrations.manage`. Não espalhar comparações de nome de papel pelo código. Exportar, excluir, publicar, alterar credenciais e delegar acesso são permissões distintas."_

E a **Seção 25 (Invariantes)** reforça:

- Nenhuma consulta de cliente sem contexto (`withContext`);
- Nenhuma autorização apenas no layout ou menu;
- Papel é dado; permissão é a pergunta. Centralizar a verificação no servidor com resolução em tempo real no banco garante revogação imediata (**AC03**).

---

## 2. Decisões Firmes vs. Propostas do Produto

### 2.1 Decisões Firmes (Invariantes do Sistema)

- **Centralização:** Comparações diretas de nome de papel (`role === 'admin'`) são restritas ao núcleo de permissões (`src/core/permissions/`).
- **Resolução em Banco:** Toda verificação de permissão é executada dentro de `withContext` via guard de servidor (`src/core/permissions/guard.ts`), lendo o vínculo ativo diretamente de `workspace_members` e `organization_members`. Vínculos inativos (`status !== 'active'`) são rejeitados imediatamente (**AC03**).
- **Proteção ao Último Owner (AC04):** O último proprietário ativo de uma organização não pode ser removido, demitido ou suspenso.
- **Escalonamento de Privilégios (AC04):** Admins não podem promover outros a `owner`, nem remover ou rebaixar `owners`.
- **Erros Seguros:** Falhas de autorização lançam `PermissionDeniedError` (código `forbidden`, HTTP 403) sem divulgar metadados ou existência de recursos a usuários não autorizados.

### 2.2 Proposta da Matriz (Sujeita à Confirmação do Produto)

A atribuição das permissões específicas para os papéis `editor` e `viewer`, e a granularidade de escopos de API keys / credenciais BYOK são uma proposta de arquitetura operacional que permanece sujeita à validação da equipe de produto antes da fase comercial.

### 2.3 Herança Empresarial (Pendência Aberta)

- Registrada em [`docs/pendencias.md`](../pendencias.md): _"Herança de acesso empresarial: proposta de concessão explícita; produto confirma."_
- Conforme a **§7**: _"Por padrão, vínculo na empresa não concede leitura de todos os dados dos workspaces."_
- **Regra aplicada:** Não concedemos permissões de dados de workspace (leitura de tabelas, credenciais, chaves, agentes) a membros da organização pela matriz. Mantém-se exclusivamente a atribuição explícita da §7 ao **Organization Owner** para _"concessão de acesso aos workspaces"_ (capacidade de gerir e convidar membros para os workspaces da organização).

---

## 3. Catálogo de Permissões do Núcleo

As permissões possuem namespace estável declarado em [`src/core/permissions/catalog.ts`](../../src/core/permissions/catalog.ts):

| Permissão                       | Namespace          | Descrição                                                                     |
| ------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `workspace.read`                | Workspace          | Visualizar metadados básicos e dashboard do workspace                         |
| `workspace.settings.update`     | Workspace          | Alterar configurações gerais do workspace                                     |
| `workspace.members.read`        | Workspace          | Listar membros do workspace                                                   |
| `workspace.members.invite`      | Workspace          | Adicionar ou convidar novos membros para o workspace                          |
| `workspace.members.manage`      | Workspace          | Atualizar papéis ou remover membros do workspace                              |
| `credentials.read`              | Credenciais BYOK   | Visualizar metadados e valores mascarados de credenciais                      |
| `credentials.manage`            | Credenciais BYOK   | Cadastrar, atualizar, substituir e revogar credenciais                        |
| `channels.read`                 | Canais de mensagem | Ver conexões, rotas e eventos recebidos dos canais (A5a)                      |
| `channels.manage`               | Canais de mensagem | Cadastrar, testar e remover conexões e trocar rotas (ADR 0011)                |
| `api_keys.create_own`           | Chaves de API      | Criar chaves de API próprias para acesso à plataforma / MCP                   |
| `api_keys.revoke_own`           | Chaves de API      | Revogar as próprias chaves de API                                             |
| `api_keys.revoke_any`           | Chaves de API      | Revogar chaves de API de qualquer membro do workspace                         |
| `api_keys.read_all`             | Chaves de API      | Listar metadados de todas as chaves de API do workspace                       |
| `ai_agents.use`                 | Agentes de IA      | Executar prompts e interagir com sessões de agentes (módulo congelado na C04) |
| `ai_agents.manage`              | Agentes de IA      | Criar, configurar e alterar agentes de IA (módulo congelado na C04)           |
| `ai_agents.conversations.read`  | Agentes de IA      | Ler conversas, transcrições e áudios dos GUIDS (A2a)                          |
| `organization.read`             | Organização        | Visualizar dados institucionais da organização contratante                    |
| `organization.members.invite`   | Organização        | Convidar novos membros para a organização                                     |
| `organization.members.manage`   | Organização        | Atualizar papéis, transferir propriedade e remover membros da organização     |
| `organization.settings.update`  | Organização        | Alterar razão social, cotas e configurações corporativas                      |
| `workspace.service_mode.manage` | Modo de serviço    | Aprovar ou recusar o pedido de gerenciado e voltar para o padrão (GB1c)       |
| `partner.service_mode.request`  | Modo de serviço    | Pedir o modo gerenciado para um cliente e cancelar o pedido (GB1c)            |
| `platform.service_mode.request` | Modo de serviço    | Pedir o modo gerenciado para um cliente direto, parceiro zero (GB1c)          |
| Permissão                       | Namespace          | Descrição                                                                     |
| ------------------------------  | ------------------ | ----------------------------------------------------------------------------- |
| `workspace.read`                | Workspace          | Abrir as áreas do workspace além do dashboard (configurações, módulos, API)   |
| `workspace.settings.update`     | Workspace          | Alterar configurações gerais do workspace                                     |
| `workspace.members.read`        | Workspace          | Listar membros do workspace                                                   |
| `workspace.members.invite`      | Workspace          | Adicionar ou convidar novos membros para o workspace                          |
| `workspace.members.manage`      | Workspace          | Atualizar papéis ou remover membros do workspace                              |
| `credentials.read`              | Credenciais BYOK   | Visualizar metadados e valores mascarados de credenciais                      |
| `credentials.manage`            | Credenciais BYOK   | Cadastrar, atualizar, substituir e revogar credenciais                        |
| `channels.read`                 | Canais de mensagem | Ver conexões, rotas e eventos recebidos dos canais (A5a)                      |
| `channels.manage`               | Canais de mensagem | Cadastrar, testar e remover conexões e trocar rotas (ADR 0011)                |
| `api_keys.create_own`           | Chaves de API      | Criar chaves de API próprias para acesso à plataforma / MCP                   |
| `api_keys.revoke_own`           | Chaves de API      | Revogar as próprias chaves de API                                             |
| `api_keys.revoke_any`           | Chaves de API      | Revogar chaves de API de qualquer membro do workspace                         |
| `api_keys.read_all`             | Chaves de API      | Listar metadados de todas as chaves de API do workspace                       |
| `ai_agents.use`                 | Agentes de IA      | Executar prompts e interagir com sessões de agentes (módulo congelado na C04) |
| `ai_agents.manage`              | Agentes de IA      | Criar, configurar e alterar agentes de IA (módulo congelado na C04)           |
| `ai_agents.conversations.read`  | Agentes de IA      | Ler conversas, transcrições e áudios dos GUIDS (A2a)                          |
| `inbox.view`                    | Inbox              | Abrir o Inbox e ler as conversas (especificação do Inbox §3, AT1)             |
| `inbox.reply`                   | Inbox              | Responder, assumir conversa não atribuída, mudar status e etiquetas           |
| `inbox.manage`                  | Inbox              | Atribuir a outros, criar etiquetas e escolher a rota de cada número           |
| `organization.read`             | Organização        | Visualizar dados institucionais da organização contratante                    |
| `organization.members.invite`   | Organização        | Convidar novos membros para a organização                                     |
| `organization.members.manage`   | Organização        | Atualizar papéis, transferir propriedade e remover membros da organização     |
| `organization.settings.update`  | Organização        | Alterar razão social, cotas e configurações corporativas                      |

_Nota: Permissões para módulos não especificados (Catálogo, Google Business) ou áreas não implementadas (cobrança, exportação) não foram inventadas._

---

## 4. Matriz Papel × Permissão

### 4.1 Papéis de Workspace (`WorkspaceRole`)

| Permissão                       | `owner` | `admin` | `editor` | `viewer` |
| ------------------------------- | :-----: | :-----: | :------: | :------: |
| `workspace.read`                |   ✅    |   ✅    |    ✅    |    ✅    |
| `workspace.settings.update`     |   ✅    |   ✅    |    ❌    |    ❌    |
| `workspace.members.read`        |   ✅    |   ✅    |    ✅    |    ✅    |
| `workspace.members.invite`      |   ✅    |   ✅    |    ❌    |    ❌    |
| `workspace.members.manage`      |   ✅    |   ✅*   |    ❌    |    ❌    |
| `credentials.read`              |   ✅    |   ✅    |    ✅    |    ❌    |
| `credentials.manage`            |   ✅    |   ✅    |    ❌    |    ❌    |
| `channels.read`                 |   ✅    |   ✅    |    ✅    |    ❌    |
| `channels.manage`               |   ✅    |   ✅    |    ❌    |    ❌    |
| `api_keys.create_own`           |   ✅    |   ✅    |    ✅    |   ✅**   |
| `api_keys.revoke_own`           |   ✅    |   ✅    |    ✅    |    ✅    |
| `api_keys.revoke_any`           |   ✅    |   ✅    |    ❌    |    ❌    |
| `api_keys.read_all`             |   ✅    |   ✅    |    ❌    |    ❌    |
| `ai_agents.use`                 |   ✅    |   ✅    |    ✅    |    ❌    |
| `ai_agents.manage`              |   ✅    |   ✅    |    ❌    |    ❌    |
| `ai_agents.conversations.read`  |   ✅    |   ✅    |    ✅    |    ❌    |
| `workspace.service_mode.manage` |  ✅***  |   ❌    |    ❌    |    ❌    |
| Permissão                       | `owner` | `admin` | `editor` | `viewer` | `attendant` |
| ------------------------------  | :-----: | :-----: | :------: | :------: | :---------: |
| `workspace.read`                |   ✅    |   ✅    |    ✅    |    ✅    | ❌          |
| `workspace.settings.update`     |   ✅    |   ✅    |    ❌    |    ❌    | ❌          |
| `workspace.members.read`        |   ✅    |   ✅    |    ✅    |    ✅    | ❌          |
| `workspace.members.invite`      |   ✅    |   ✅    |    ❌    |    ❌    | ❌          |
| `workspace.members.manage`      |   ✅    |   ✅*   |    ❌    |    ❌    | ❌          |
| `credentials.read`              |   ✅    |   ✅    |    ✅    |    ❌    | ❌          |
| `credentials.manage`            |   ✅    |   ✅    |    ❌    |    ❌    | ❌          |
| `channels.read`                 |   ✅    |   ✅    |    ✅    |    ❌    | ❌          |
| `channels.manage`               |   ✅    |   ✅    |    ❌    |    ❌    | ❌          |
| `api_keys.create_own`           |   ✅    |   ✅    |    ✅    |   ✅**   | ❌          |
| `api_keys.revoke_own`           |   ✅    |   ✅    |    ✅    |    ✅    | ❌          |
| `api_keys.revoke_any`           |   ✅    |   ✅    |    ❌    |    ❌    | ❌          |
| `api_keys.read_all`             |   ✅    |   ✅    |    ❌    |    ❌    | ❌          |
| `ai_agents.use`                 |   ✅    |   ✅    |    ✅    |    ❌    | ❌          |
| `ai_agents.manage`              |   ✅    |   ✅    |    ❌    |    ❌    | ❌          |
| `ai_agents.conversations.read`  |   ✅    |   ✅    |    ✅    |    ❌    | ❌          |
| `inbox.view`                    |   ✅    |   ✅    |    ✅    |    ❌    | ✅          |
| `inbox.reply`                   |   ✅    |   ✅    |    ✅    |    ❌    | ✅          |
| `inbox.manage`                  |   ✅    |   ✅    |    ❌    |    ❌    | ❌          |

_\* Sujeito à verificação de escalonamento em `roles.ts` (admins não podem alterar ou remover owners)._
_\*\* No viewer, criação de chaves de API é restrita a escopos puramente de leitura (restrição aplicada na C12)._
_\*\*\* GB1c: o consentimento do gerenciado é do owner da empresa. O banco confere `organization_members.role = 'owner'` (não basta ser owner de um workspace): `private.service_mode_request_decide` e a política `organization_service_modes_owner_update`. Os demais membros só leem o card Configurações › Modo de serviço._

**Atendente (`attendant`, AT1, decisão do Marcelo de 16/10/2026):** só entra no dashboard e no Inbox (o Inbox chega na IN4). Não tem `workspace.read`, então todas as outras áreas respondem como para quem não é membro: as páginas de configurações, execuções, propostas e módulos dão 404 (`requireWorkspaceAreaPage` em cada página e `resolveModulePageAccess`), a API v1 do workspace dá 403, o MCP recusa qualquer escopo e ele não cria chave de API. O menu do `/app` mostra só a Visão Geral, e o dashboard dele não mostra assentos, módulos nem atalhos de equipe e configurações. Nas permissões dos módulos (`defaultWorkspaceRoles` dos manifestos) ele não aparece. Owner e admin o convidam e trocam seu papel em Configurações › Equipe & Membros; ele não convida nem promove ninguém. No banco, `credentials` e a inserção em `api_keys` listam os quatro outros papéis (migration `20261127090000_at1_attendant_role.sql`); as políticas de escrita por lista de papéis seguem sem ele.

### 4.2 Papéis de Organização (`OrganizationRole`)

| Permissão                      | `owner` | `admin` | `member` |
| ------------------------------ | :-----: | :-----: | :------: |
| `organization.read`            |   ✅    |   ✅    |    ✅    |
| `organization.members.invite`  |   ✅    |   ✅*   |    ❌    |
| `organization.members.manage`  |   ✅    |   ✅*   |    ❌    |
| `organization.settings.update` |   ✅    |   ✅    |    ❌    |

_\* Sujeito à verificação de escalonamento em `roles.ts` (admins não podem convidar owners nem alterar/remover owners)._

### 4.3 Papéis da Plataforma (`PlatformAdminRoleKey`)

Permissões da área `/platform` (`PLATFORM_ROLE_PERMISSIONS` em [`src/core/permissions/matrix.ts`](../../src/core/permissions/matrix.ts)), concedidas só pelo papel interno ativo em `platform_admin_members`.

| Permissão                       | `owner` | `operations` | `billing` | `support` |
| ------------------------------- | :-----: | :----------: | :-------: | :-------: |
| `platform.modules.read`         |   ✅    |      ✅      |    ✅     |    ✅     |
| `platform.modules.manage`       |   ✅    |      ✅      |    ❌     |    ❌     |
| `platform.customers.read`       |   ✅    |      ✅      |    ✅     |    ✅     |
| `platform.brand.manage`         |   ✅    |      ✅      |    ❌     |    ❌     |
| `platform.legal.manage`         |   ✅    |      ✅      |    ❌     |    ❌     |
| `platform.partners.read`        |   ✅    |      ✅      |    ✅     |    ✅     |
| `platform.partners.manage`      |   ✅    |      ✅      |    ❌     |    ❌     |
| `platform.billing.read`         |   ✅    |      ✅      |    ✅     |    ❌     |
| `platform.billing.manage`       |   ✅    |      ❌      |    ✅     |    ❌     |
| `platform.operations.read`      |   ✅    |      ✅      |    ❌     |    ✅     |
| `platform.languages.manage`     |   ✅    |      ✅      |    ❌     |    ❌     |
| `platform.ai.manage`            |   ✅    |      ✅      |    ❌     |    ❌     |
| `platform.settings.manage`      |   ✅    |      ✅      |    ❌     |    ❌     |
| `platform.security.read`        |   ✅    |      ✅      |    ❌     |    ✅     |
| `platform.audit.read`           |   ✅    |      ✅      |    ✅*    |    ✅     |
| `platform.service_mode.request` |   ✅    |      ✅      |    ❌     |    ❌     |

_\* AUD1: o `billing` abre Plataforma › Auditoria, mas o banco (`private.platform_audit_events` e `private.is_billing_audit_action`) devolve a ele só as ações de cobrança (`billing.`, `platform.billing.`, `partner.billing.`, `partner.payment.`, `partner.subscription.` e `partner.checkout.`). Os demais papéis veem toda a trilha, com os metadados já filtrados pela allowlist na gravação._

### 4.4 Central de Eventos na plataforma (H1, ADR 0022)

| Permissão                                                                   | `owner` | `operations` | `support` | `billing` | capacidade `keychain` |
| --------------------------------------------------------------------------- | :-----: | :----------: | :-------: | :-------: | :-------------------: |
| `platform.events.read` (situação dos eventos e das entregas, sem dados)     |   ✅    |      ✅      |    ✅     |    ✅*    |           —           |
| `platform.events.read_all_data` (dados completos de qualquer evento)        |   ❌    |      ❌      |    ❌     |    ❌     |         ✅**          |
| `platform.capabilities.manage` (conceder e retirar `keychain`)              |   ✅    |      ❌      |    ❌     |    ❌     |           —           |
| `platform.events.request_access` (pedir ao cliente os dados de eventos, H2) |   ✅    |      ✅      |    ✅     |    ❌     |           —           |
| `platform.events.manage` (resolver ou ignorar os eventos da plataforma, H2) |   ✅    |      ✅      |    ❌     |    ❌     |           —           |

_\* `billing` vê só os eventos do módulo `billing`; o banco corta o resto (`private.platform_events`)._
_\*\* `keychain` é uma capacidade somada ao papel principal (tabela `platform_admin_capabilities`), não um papel; dá só essa permissão. O `owner` não a tem por padrão e pode concedê-la a si mesmo (auditado em `platform.capability.grant`/`.revoke`). Cada abertura exige MFA (AAL2), motivo de 10 a 500 caracteres e grava `platform.event.view_data` (event_id, tipo, motivo, IP) na auditoria da plataforma, sem empresa nem workspace: o cliente não é avisado. A leitura e o registro acontecem na mesma chamada (`private.read_event_data`)._

### 4.5 Modos de serviço (GB1c, ADR 0020)

| Quem                                                   | Pede o gerenciado | Cancela o pedido | Decide (link ou `/app`) |      Volta para o padrão       |  Lê o workspace no gerenciado   |
| ------------------------------------------------------ | :---------------: | :--------------: | :---------------------: | :----------------------------: | :-----------------------------: |
| `partner_owner`, `partner_admin` (parceiro da empresa) |        ✅         |        ✅        |           ❌            | ✅ (fim do contrato, sem tela) |               ✅                |
| `partner_support` (parceiro da empresa)                |        ❌         |        ❌        |           ❌            |               ❌               |               ✅                |
| `partner_finance`                                      |        ❌         |        ❌        |           ❌            |               ❌               |               ❌                |
| Plataforma `owner`, `operations` (clientes diretos)    |        ✅         |        ✅        |           ❌            |               ❌               | só como membro do parceiro zero |
| Owner da empresa                                       |        ❌         |        ❌        |           ✅            |               ✅               |                —                |
| Admin e demais membros do workspace                    |        ❌         |        ❌        |           ❌            |               ❌               |                —                |

O acesso do gerenciado não passa pela matriz: as políticas RLS de CRM, GUIDS (escrita), conversas, leads, avisos, canais, portfólio e configurações do workspace aceitam `private.partner_manages_organization(org)`. A chave de IA (`credentials`) nunca. Toda escrita de quem gerencia vira `audit_events` com origem `partner`.

No parceiro, `partner_owner`, `partner_admin` e `partner_support` leem a situação dos eventos dos seus clientes (`private.partner_events`); os dados só das empresas que gerenciam (`private.partner_manages_organization`) e dos eventos endereçados ao próprio parceiro. Os membros do workspace leem os eventos com audiência cliente, com os dados (RLS da tabela `events`).

**H2 (Central de Eventos: regras, telas e acesso por evento):**

| Permissão                                                               | Quem                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------- |
| `workspace.events.read` (Eventos do workspace e o rastro)               | `owner`, `admin`, `editor`, `viewer`                |
| `workspace.events.manage` (resolver/ignorar, decidir pedidos de acesso) | `owner`, `admin`                                    |
| `partner.events.read` (Eventos dos clientes no `/admin`)                | `partner_owner`, `partner_admin`, `partner_support` |
| `partner.events.request_access` (pedir ao cliente os dados de eventos)  | `partner_owner`, `partner_admin`, `partner_support` |

As regras de aviso, a janela de silêncio e o horário do resumo usam as permissões das configurações de cada nível (`platform.settings.manage`, `partner.settings.manage`, `workspace.settings.update`); os modelos de WhatsApp, `platform.settings.manage` e `partner.settings.manage`. O acesso por evento (`event_access_grants`) só deixa ler quem pediu, só os eventos do pedido, com o papel ainda ativo e dentro do prazo aprovado; cada leitura grava `event.data.viewed` com a empresa e o workspace (o cliente vê no próprio evento) na mesma chamada (`private.read_event_data_by_grant`). O número de WhatsApp de Minha conta é só da própria pessoa.

---

## 5. Implementação dos Guards de Servidor

O módulo [`src/core/permissions/guard.ts`](../../src/core/permissions/guard.ts) (`server-only`) exporta duas funções centrais:

```typescript
export async function requireWorkspacePermission(
  tx: ContextTransaction,
  ctx: RequestContext,
  permission: Permission,
): Promise<{
  workspaceRole: WorkspaceRole;
  organizationRole: OrganizationRole | null;
}>;

export async function requireOrganizationPermission(
  tx: ContextTransaction,
  ctx: RequestContext,
  permission: Permission,
): Promise<{
  organizationRole: OrganizationRole;
}>;
```

### Fluxo de Validação

1. Recebe a transação com contexto (`tx`) e o `ctx: RequestContext` autenticado no servidor.
2. Consulta as tabelas de associação `workspace_members` e `organization_members`.
3. Valida que o vínculo possui `status === "active"`. Vínculos inativos ou ausentes provocam imediatamente `throw new PermissionDeniedError()`.
4. Avalia a permissão solicitada contra a matriz correspondente.
5. Retorna os papéis resolvidos para posterior aplicação de regras adicionais de fronteira (AC04).
