# Especificação do módulo Hello World (`hello-world`)

- **Versão:** 1.0.0
- **Estado:** módulo de referência (Adendo v1.1 §9). Não é produto comercial.
- **Modelo de origem:** `module-templates/standard` 1.0.0
- **Disponibilidade:** só com `GUIDU_MODULE_HELLO_WORLD_ENABLED="true"` (desenvolvimento e testes). Em produção a variável não é definida e o módulo fica oculto e bloqueado.

## 1. Problema que resolve

Provar, com uma funcionalidade mínima, que o contrato de módulos funciona de ponta a ponta: manifesto validado, registro, menu com submenu gerado, hosts de Settings de cliente e admin, permissões próprias, limite, auditoria e isolamento entre workspaces.

## 2. Quem usa e com quais permissões

| Permissão                                    | Papéis padrão                                                          | Uso                             |
| -------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| `hello_world.read`                           | owner, admin, editor, viewer                                           | Ver a saudação e os registros   |
| `hello_world.records.write`                  | owner, admin, editor                                                   | Criar registros                 |
| `hello_world.settings.manage`                | owner, admin                                                           | Alterar a saudação do workspace |
| `platform.modules.read` / `.manage` (núcleo) | papéis internos (owner e operations gerenciam; billing e support leem) | Política global                 |

Habilitar ou desabilitar o módulo no workspace exige `workspace.modules.manage` (owner e admin do workspace).

## 3. Dados que guarda

- `public.hello_world_records`: título (1 a 120 caracteres), autor e data, por workspace. Sem dados pessoais além do id do autor. Sem seed em nenhum ambiente.
- Configuração do workspace em `workspace_modules.config`: `{ greeting?: string }`.
- Configuração global em `platform_modules.config`: `{ defaultGreeting?: string }`.

## 4. Ações

| Ação                         | Regra                                                                                | Auditoria                          |
| ---------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------- |
| Ver saudação                 | Saudação do workspace, senão a global, senão `Hello, World!`, com a origem explícita | —                                  |
| Listar registros             | Do workspace do contexto, mais recentes primeiro                                     | —                                  |
| Consultar registro           | Id de outro workspace responde "não encontrado"                                      | —                                  |
| Criar registro               | Limite de demonstração de 10 por workspace, serializado por advisory lock            | `hello_world.record.create`        |
| Salvar saudação do workspace | Validada pelo `configurationSchema.workspace`; vazio herda                           | `workspace.module.settings.update` |
| Salvar saudação global       | Validada pelo `configurationSchema.admin`                                            | `platform.module.settings.update`  |

## 5. Conexões

Nenhuma.

## 6. Limites

`HELLO_WORLD_DEMO_RECORD_LIMIT = 10` é limite de demonstração do módulo, não cota comercial. O manifesto declara o entitlement `hello-world.records` para quando a F3 trouxer planos e quotas.

## 7. Exportação, exclusão e retenção

Os registros são apagados em cascata com o workspace. Exportação e retenção seguem o processo geral da F3; o módulo não define nada próprio.

## 8. Jobs, eventos e MCP

Nenhum.

## 9. Critérios de aceite e testes

| Critério                                              | Evidência                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| Manifesto válido e registro sem conflitos             | `src/modules/registry.test.ts`, `src/core/module-contracts/validate.test.ts` |
| Menu e Settings gerados, por estado e permissão       | `src/core/module-runtime/navigation.test.ts`                                 |
| Isolamento, permissão, limite, manutenção e auditoria | `tests/core/modules-hello-world.test.ts` (job `db`)                          |
| RLS das tabelas de módulo                             | `tests/core/modules-rls.sql` (job `db`)                                      |
| Fluxos de UI com dois workspaces e papéis distintos   | `e2e/modules-hello-world.spec.ts`                                            |
