# Contrato de módulos

Implementação da F2 (ADRs [0005](../adr/0005-rotas-de-modulos.md) e [0006](../adr/0006-manifesto-de-modulos.md), Adendo v1.1 §4–§9 e §17). O módulo de referência é o [`hello-world`](../../src/modules/hello-world/MODULE_SPEC.md); o modelo para novos módulos está em [`module-templates/standard`](../../module-templates/standard/README.md).

## Peças

| Peça                    | Onde                                                                                       | Papel                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manifesto               | `src/core/module-contracts/manifest.ts`                                                    | Schema Zod dos metadados seguros: rotas, navegação, settings, permissões, entitlements, dependências, `configurationSchema`, capacidades                                             |
| Validação do registro   | `src/core/module-contracts/validate.ts`                                                    | Duplicidades, rotas fora do namespace ou em conflito, navegação para rota inexistente, permissões não declaradas, dependências ausentes e ciclos, versão de contrato e de plataforma |
| Registro central        | `src/modules/registry.ts`                                                                  | Lista explícita dos manifestos; validado na importação, então um manifesto quebrado falha teste e build                                                                              |
| Componentes de Settings | `src/modules/settings-components.ts`                                                       | Mapa estático `componentKey` → componente                                                                                                                                            |
| Estado de acesso        | `src/core/module-runtime/state.ts`                                                         | Decisão única usada por menu, páginas, ações e serviços                                                                                                                              |
| Navegação gerada        | `src/core/module-runtime/navigation.ts`                                                    | Sidebars do app e do admin montadas a partir do núcleo e do registro                                                                                                                 |
| Configuração            | `src/core/module-runtime/settings.ts`                                                      | Serviços separados para workspace e global, com permissão, schema e auditoria                                                                                                        |
| Hosts                   | `/app/[workspaceSlug]/settings/modules/[moduleKey]`, `/admin/settings/modules/[moduleKey]` | Resolvem contexto, estado e permissão e renderizam o componente do módulo                                                                                                            |
| Índices                 | `/app/[workspaceSlug]/settings/modules`, `/admin/modules`                                  | Habilitação por workspace; disponibilidade global                                                                                                                                    |

## Estado de um módulo

Avaliado nesta ordem; a primeira condição que bloqueia decide.

| Camada                   | Fonte                                              | Efeito                                                                |
| ------------------------ | -------------------------------------------------- | --------------------------------------------------------------------- |
| Trava técnica            | `technicalGate` no registro (variável de ambiente) | Desligada: oculto e bloqueado em tudo                                 |
| Disponibilidade global   | `platform_modules.availability` (admin)            | `disabled`: oculto para clientes; `maintenance`: operações bloqueadas |
| Estado de lançamento     | `releaseStatus` do manifesto                       | `coming_soon`: só placeholder; `maintenance`: bloqueado               |
| Habilitação no workspace | `workspace_modules.status`                         | Desabilitado: some do menu e as rotas mostram "Módulo desabilitado"   |
| Contratação              | Planos e entitlements                              | **Ainda não avaliada (F3).** O manifesto já declara os entitlements   |
| Permissão                | Matriz do núcleo e defaults do manifesto           | Itens e ações sem permissão somem e são negados no servidor           |

## Decisões tomadas na F2 (propostas, sujeitas à confirmação do produto)

- Permissões de módulo são declaradas no manifesto com os papéis de workspace que as recebem por padrão. O guard do servidor resolve permissões do núcleo pela matriz e as de módulo pelo registro; permissão desconhecida é negada.
- Papéis da empresa não concedem nada nas tabelas de módulo, em linha com a pendência de herança empresarial.
- `workspace.modules.manage` (owner e admin do workspace) habilita módulos. `platform.modules.read` e `platform.modules.manage` são do admin: owner e operations gerenciam; billing e support só leem.
- Escritas em `workspace_modules` são restritas no RLS a owner/admin do workspace. Um módulo que conceda a outro papel a escrita de configuração precisa de nova política.
- O Agentes de IA continua congelado (C04): entra no registro como `beta` atrás da trava `GUIDU_MODULE_AI_AGENTS_ENABLED`. Com a flag ligada, o menu só aparece depois de habilitado no workspace; a página congelada ainda usa apenas a trava técnica.

## Checklist

### Criação

- [ ] `MODULE_SPEC.md` aprovada, respondendo às perguntas do Adendo §3, sem regra interna inventada.
- [ ] Pasta copiada de `module-templates/standard`, placeholders trocados, `templateVersion` preenchido.
- [ ] Manifesto registrado em `src/modules/registry.ts`; `technicalGate` quando o módulo precisa ficar desligado por ambiente.
- [ ] Componentes de Settings registrados em `src/modules/settings-components.ts`.
- [ ] Páginas de ligação finas em `src/app`, uma por rota declarada, com `resolveModulePageAccess`.
- [ ] Serviços chamam `assertModuleOperational` e `requireWorkspacePermission` e filtram por `ctx.workspaceId`, além do RLS.
- [ ] Migration nova em `supabase/migrations/` com FK composta, `FORCE RLS` e sem grants para `anon`/`authenticated`; Prisma schema atualizado.
- [ ] Auditoria na mesma transação das mudanças relevantes.

### Revisão

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` sem erros.
- [ ] Teste SQL de RLS no job `db`; teste de integração com dois workspaces, papel sem permissão, módulo desabilitado, limite e manutenção.
- [ ] E2E com o módulo habilitado em um workspace só e usuários com papéis diferentes.
- [ ] Nenhum segredo em manifesto, configuração, DTO, log ou erro.
- [ ] Alterações fora da pasta do módulo listadas no PR.

### Atualização

- [ ] `moduleVersion` incrementado; `contractVersion` só muda com a interface comum.
- [ ] Migrations compatíveis (expandir, publicar, depois remover); nunca editar migration aplicada.
- [ ] Recuperação e mudanças irreversíveis documentadas.

### Habilitação

- [ ] Migration aplicada no dev depois do PR aprovado por Marcelo.
- [ ] Disponibilidade global conferida em `/admin/modules`.
- [ ] Habilitado primeiro em workspace de teste ou piloto.
- [ ] Liberação por plano e rollout só depois da F3.
