# Modelo de módulo `standard` (versão 1.0.0)

Ponto de partida para um módulo da plataforma (Adendo v1.1 §4, §9 e §10). Copiar a pasta é só o começo: o módulo ainda precisa ser registrado, ter páginas de ligação, permissões, migrations e testes. O módulo de referência completo, que segue este modelo, está em `src/modules/hello-world`.

Esta pasta é excluída do TypeScript, do ESLint e do build. Os arquivos não compilam até os placeholders serem trocados.

## Placeholders

| Placeholder | Exemplo | Uso |
| --- | --- | --- |
| `__MODULE_KEY__` | `appointment` | `moduleKey`, pasta e rotas (minúsculas com hífen) |
| `__MODULE_NS__` | `appointment` | namespace das permissões (`moduleKey` com `_` no lugar de `-`) |
| `__MODULE_NAME__` | `Agendamento` | nome exibido |
| `__ModuleName__` | `Appointment` | prefixo de componentes e funções |

## Passo a passo

1. Escrever `MODULE_SPEC.md` antes do código e obter aprovação. Sem especificação, nada de regra interna inventada.
2. Copiar esta pasta para `src/modules/__MODULE_KEY__` e trocar os placeholders.
3. Registrar o manifesto em `src/modules/registry.ts`, com `technicalGate` se o módulo precisar ficar desligado por ambiente.
4. Registrar os componentes de Settings em `src/modules/settings-components.ts`.
5. Copiar `app-wrappers/page.tsx` para `src/app/app/[workspaceSlug]/__MODULE_KEY__/page.tsx`, um arquivo por rota declarada.
6. Propor a migration em `database-proposals/` e, depois de revisada, movê-la para `supabase/migrations/` com timestamp maior que o último. Atualizar `prisma/schema.prisma`. Tabelas com `workspace_id NOT NULL`, FK composta, `ENABLE` e `FORCE RLS`, nenhum grant para `anon`/`authenticated`.
7. Escrever os testes: isolamento entre dois workspaces, bloqueio sem permissão, módulo desabilitado e limite. Usar `tests/` deste modelo como ponto de partida.
8. Seguir o checklist em `docs/modules/README.md` e abrir o PR.

## O que o núcleo já oferece

- Estado e acesso: `assertModuleOperational`, `resolveModulePageAccess` (`src/core/module-runtime`).
- Permissões: `requireWorkspacePermission`, que já entende as permissões declaradas no manifesto.
- Configuração: `getWorkspaceModuleConfig`, `saveWorkspaceModuleConfig`, `getPlatformModuleConfig`, `savePlatformModuleConfig`, validadas pelo `configurationSchema`.
- Navegação e Settings gerados pelo registro; hosts em `/app/[workspaceSlug]/settings/modules/[moduleKey]` e `/admin/settings/modules/[moduleKey]`.
- Auditoria: `recordAudit` na mesma transação da mudança.

Alterar este modelo não atualiza módulos já criados. Cada manifesto registra `templateVersion`.
