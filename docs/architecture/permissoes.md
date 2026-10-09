# Matriz de Permissões e Controle de Acesso (RBAC)

Este documento define o modelo de autorização, o catálogo de permissões, a matriz papel × permissão e os guards de segurança da plataforma, conforme a **Especificação v1.0 (§4, §7 e §25)** e a correção **C06**.

---

## 1. Origem e Fundamentação

A **Especificação v1.0 (§7)** estabelece:
> *"Papéis mapeiam permissões, como `workspace.members.invite` e `integrations.manage`. Não espalhar comparações de nome de papel pelo código. Exportar, excluir, publicar, alterar credenciais e delegar acesso são permissões distintas."*

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
- Registrada em [`docs/pendencias.md`](../pendencias.md): *"Herança de acesso empresarial: proposta de concessão explícita; produto confirma."*
- Conforme a **§7**: *"Por padrão, vínculo na empresa não concede leitura de todos os dados dos workspaces."*
- **Regra aplicada:** Não concedemos permissões de dados de workspace (leitura de tabelas, credenciais, chaves, agentes) a membros da organização pela matriz. Mantém-se exclusivamente a atribuição explícita da §7 ao **Organization Owner** para *"concessão de acesso aos workspaces"* (capacidade de gerir e convidar membros para os workspaces da organização).

---

## 3. Catálogo de Permissões do Núcleo

As permissões possuem namespace estável declarado em [`src/core/permissions/catalog.ts`](../../src/core/permissions/catalog.ts):

| Permissão | Namespace | Descrição |
| --- | --- | --- |
| `workspace.read` | Workspace | Visualizar metadados básicos e dashboard do workspace |
| `workspace.settings.update` | Workspace | Alterar configurações gerais do workspace |
| `workspace.members.read` | Workspace | Listar membros do workspace |
| `workspace.members.invite` | Workspace | Adicionar ou convidar novos membros para o workspace |
| `workspace.members.manage` | Workspace | Atualizar papéis ou remover membros do workspace |
| `credentials.read` | Credenciais BYOK | Visualizar metadados e valores mascarados de credenciais |
| `credentials.manage` | Credenciais BYOK | Cadastrar, atualizar, substituir e revogar credenciais |
| `api_keys.create_own` | Chaves de API | Criar chaves de API próprias para acesso à plataforma / MCP |
| `api_keys.revoke_own` | Chaves de API | Revogar as próprias chaves de API |
| `api_keys.revoke_any` | Chaves de API | Revogar chaves de API de qualquer membro do workspace |
| `api_keys.read_all` | Chaves de API | Listar metadados de todas as chaves de API do workspace |
| `ai_agents.use` | Agentes de IA | Executar prompts e interagir com sessões de agentes (módulo congelado na C04) |
| `ai_agents.manage` | Agentes de IA | Criar, configurar e alterar agentes de IA (módulo congelado na C04) |
| `organization.read` | Organização | Visualizar dados institucionais da organização contratante |
| `organization.members.invite` | Organização | Convidar novos membros para a organização |
| `organization.members.manage` | Organização | Atualizar papéis, transferir propriedade e remover membros da organização |
| `organization.settings.update` | Organização | Alterar razão social, cotas e configurações corporativas |

*Nota: Permissões para módulos não especificados (Catálogo, Google Business) ou áreas não implementadas (cobrança, exportação) não foram inventadas.*

---

## 4. Matriz Papel × Permissão

### 4.1 Papéis de Workspace (`WorkspaceRole`)

| Permissão | `owner` | `admin` | `editor` | `viewer` |
| --- | :---: | :---: | :---: | :---: |
| `workspace.read` | ✅ | ✅ | ✅ | ✅ |
| `workspace.settings.update` | ✅ | ✅ | ❌ | ❌ |
| `workspace.members.read` | ✅ | ✅ | ✅ | ✅ |
| `workspace.members.invite` | ✅ | ✅ | ❌ | ❌ |
| `workspace.members.manage` | ✅ | ✅* | ❌ | ❌ |
| `credentials.read` | ✅ | ✅ | ✅ | ❌ |
| `credentials.manage` | ✅ | ✅ | ❌ | ❌ |
| `api_keys.create_own` | ✅ | ✅ | ✅ | ✅** |
| `api_keys.revoke_own` | ✅ | ✅ | ✅ | ✅ |
| `api_keys.revoke_any` | ✅ | ✅ | ❌ | ❌ |
| `api_keys.read_all` | ✅ | ✅ | ❌ | ❌ |
| `ai_agents.use` | ✅ | ✅ | ✅ | ❌ |
| `ai_agents.manage` | ✅ | ✅ | ❌ | ❌ |

*\* Sujeito à verificação de escalonamento em `roles.ts` (admins não podem alterar ou remover owners).*
*\*\* No viewer, criação de chaves de API é restrita a escopos puramente de leitura (restrição aplicada na C12).*

### 4.2 Papéis de Organização (`OrganizationRole`)

| Permissão | `owner` | `admin` | `member` |
| --- | :---: | :---: | :---: |
| `organization.read` | ✅ | ✅ | ✅ |
| `organization.members.invite` | ✅ | ✅* | ❌ |
| `organization.members.manage` | ✅ | ✅* | ❌ |
| `organization.settings.update` | ✅ | ✅ | ❌ |

*\* Sujeito à verificação de escalonamento em `roles.ts` (admins não podem convidar owners nem alterar/remover owners).*

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
