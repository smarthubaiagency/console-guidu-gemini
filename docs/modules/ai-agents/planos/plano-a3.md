# Plano da A3 — Telas do `/platform` e do `/admin`

Marcelo deu o "pode começar" em 13/10/2026. Base: especificação (`docs/modules/ai-agents/especificacao.md`, seções 4, 5.2, 6, 11 e 13), `campos.md` (as 5 abas e os campos mínimos) e o que a A1 e a A2 deixaram na `main` (PRs #61 a #64).

## O que já existe

- Tabelas e RLS da A1: modelos (`ai_agent_templates`), agentes (`ai_agents`) e o acesso do parceiro só à configuração dos GUIDS dos clientes.
- Configuração validada por Zod (`src/core/ai/config/`), com `parseAgentConfig` por tipo.
- Serviços do cofre do parceiro (chave do admin) e do backup da plataforma (`src/core/ai/keys.ts`), ainda sem tela.
- O motor (A2) e o teste da chave (A2c).
- Faltam os serviços de modelos (criar, editar, publicar e excluir), de edição da configuração de um agente e do Assistente.

## Como dividir

Três PRs, cada uma com o seu "pode começar" depois da primeira:

| Parte   | Entrega                                                                                                                                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A3a** | Editor de configuração reutilizável (5 abas, campos de `campos.md`, quem edita o quê) e, no `/platform`, as telas **Modelos da casa** (GUIDS e modelo de admin) e **Backup de IA** (chave e modelo barato)              |
| **A3b** | No `/admin`: **Assistente GUIDU** do parceiro (nome, instruções, conexão de modelo), **Chaves de IA do admin** (cofre do parceiro) e **Modelos do parceiro**                                                            |
| **A3c** | No `/admin`: **GUIDS dos clientes** (lista com busca e filtro por cliente e status, editor na gaveta), auditoria visível ao cliente ("Alterado por parceiro em data") e a política para o parceiro editar as indicações |

## Regras que valem para as três

- shadcn (ADR 0014), gaveta interna (ADR 0015), SmartStatusBanner (ADR 0016), `NativeSelect` nos formulários, textos em pt-BR, en e es.
- O editor mostra só as abas e os campos que quem está editando pode mudar (especificação §5.2). O servidor confere de novo: o Zod valida o documento inteiro e o serviço recusa campo fora da divisão.
- Toda alteração é auditada com antes e depois, sem segredo. Chaves aparecem só mascaradas.
- O módulo continua atrás da flag `GUIDU_MODULE_AI_AGENTS_ENABLED`; as telas do `/platform` e do `/admin` também ficam atrás dela.

## Fora da A3

- Base de conhecimento (A7): a aba aparece sem o campo de base até lá.
- Stats e leads do mês na lista do `/admin`: o parceiro não lê consumo nem leads dos clientes sem concessão. **Proposta:** a lista mostra status, estado da chave e última alteração; números entram quando houver um resumo agregado aprovado.
- Telas do `/app` e "Testar agente" (A4).

## Testes

- Unitários do editor (divisão de campos por papel) e dos serviços novos.
- Integração dos serviços com RLS (casa, parceiro, cliente).
- E2E de cada tela nova, no padrão dos atuais.
- Aceite local completo em cada parte: SQL, typecheck, lint, testes, build e e2e.

## Como ficou a A3a

- **Sem migration.** As políticas da A1 já cobrem os modelos da casa (owner e operations) e o backup (A2a).
- **Divisão de campos** em `src/core/ai/config/editing.ts`: quatro editores (`template`, `partner`, `customer`, `customer_custom`) conforme a §5.2. O editor mostra só o que a pessoa pode mudar; o serviço aplica de novo e recusa campo fora da divisão. As versões do prompt e das regras sobem sozinhas.
- **Serviços dos modelos** em `src/core/ai/templates.ts`, já com o dono parametrizado (casa agora, parceiro na A3b): listar, abrir, criar, salvar (com publicação) e excluir. A versão do modelo sobe só quando o conteúdo muda. O modelo do Assistente fica sempre publicado e não é excluído. A auditoria guarda os campos alterados e a versão e a publicação de antes e depois.
- **Prompt do modelo:** passa a ser o `overview.system_prompt`, gravado também em `prompt_template`. Os modelos semeados na A1 tinham o prompt só em `prompt_template`; a tela e a criação de GUIDS leem dali quando o outro está vazio. Um GUIDS criado de um modelo agora nasce com o prompt (antes vinha vazio e não podia ser testado). O Assistente de cada parceiro ainda nasce sem prompt; isso entra na A3b, junto com a tela dele.
- **Telas** no `/platform`, com a flag ligada e `platform.ai.manage`: Agentes de IA › Modelos de agente (lista e editor na gaveta larga) e Backup de IA (chave mascarada e modelo barato).
- **CI:** o e2e das telas roda num passo próprio com a flag ligada (`e2e/platform-ai.spec.ts` e `e2e/ai-agents.spec.ts`); o teste do módulo desligado só roda sem a flag.

## Como ficou a A3b

- **Migration só de dados** (`20261102090000_a3b_ai_prompts.sql`): copia o `prompt_template` dos modelos semeados para `defaults.overview.system_prompt` e dá aos Assistentes já criados o prompt do modelo de admin. Prompt já escrito nunca é trocado. Aplicar no dev depois do PR.
- **Assistente GUIDU** (`/admin/ai/assistant`, serviço `src/core/ai/assistant-config.ts`): novo editor `assistant` com a aba Visão geral (nome, idioma, tom, instruções) e a Conexão de modelo (chave do cofre do parceiro, modelo, RAG). O provedor vem da chave escolhida. Ligar exige os campos mínimos; desligar sempre pode. Leitura com `partner.ai_agents.read`, alteração com `manage`, auditoria `ai.assistant.update`.
- **Ferramentas do Assistente ficam fixas**, as do modelo de admin; o parceiro não muda.
- **Avatar** fica para depois: não há coluna para ele ainda.
- **Chaves de IA** (`/admin/ai/keys`): cadastrar (provedor, finalidade, nome, chave) e revogar com confirmação; só mascaradas.
- **Modelos do parceiro** (`/admin/ai/templates`): mesma lista e gaveta do `/platform`, com o dono sendo o parceiro; um parceiro não vê os do outro.
- **Menu** "Agentes de IA" no `/admin`, só com a flag ligada e conforme o papel. O e2e `e2e/partner-ai.spec.ts` entra no passo do CI com a flag ligada.

## Como ficou a A3c

- **Migration só de políticas** (`20261103090000_a3c_partner_referrals.sql`): o parceiro lê (owner, admin e suporte) e altera (owner e admin) as indicações dos clientes dele. Aplicar no dev depois do PR.
- **GUIDS dos clientes** (`/admin/ai/guids`, serviço `src/core/ai/customer-guids.ts`): lista com busca pelo nome do agente ou do cliente e filtros por cliente e status; na gaveta, ligar e pausar, a configuração (editor `partner`) e as indicações do cliente (criar, editar e excluir).
- **Decisão tomada:** a chave de IA do GUIDS é do cofre do cliente, que o parceiro não lê. O parceiro vê o estado da chave e altera o modelo, mas não troca a chave; o editor `partner` deixou de mostrar esse campo e o serviço recusa a troca.
- **Auditoria visível ao cliente:** cada alteração assina o agente com o parceiro e é auditada. Até as telas da A4, a página de agentes do `/app` (com a flag ligada) lista os GUIDS com "Alterado por <parceiro> em <data>".
- **Fora daqui:** números de uso e leads na lista continuam dependendo da concessão de suporte.
