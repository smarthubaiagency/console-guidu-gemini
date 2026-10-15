# Plano do módulo de Agentes de IA (Assistente GUIDU e GUIDS)

12/10/2026. Base: handoff do legado CartãoPro/LinkkoPro (enviado pelo Marcelo), a especificação v0.3 do GUIDU (`docs/modules/ai-agents/especificacao.md`) e a divisão em duas verticais ([assistente-e-guids.md](assistente-e-guids.md)).

**Decisão do Marcelo (12/10/2026):** no `/admin`, o parceiro (e nós, como parceiro da casa) configura o Assistente GUIDU que atende a plataforma e também edita os agentes de IA dos clientes, sem entrar no `/app` do cliente.

## 1. O que aproveitar do legado

O legado tinha o desenho de produto pronto; o que muda é o motor (n8n → SDK dentro do GUIDU).

### Aproveita como está (desenho aprovado)

| Do legado                                                                                                                                                         | No GUIDU                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Presets** por segmento (Anna SDR, Assistente de Onboarding) com prompt template e defaults                                                                      | **Modelos de GUIDS** (SDR, agendador, suporte…). Os 2 presets entram como dados iniciais                                         |
| **Editor do agente em 5 abas**: Visão Geral, Escopo, Regras, Parceiros, Integração, com todos os campos                                                           | Mesmas abas e campos, no `/admin`, dentro da gaveta (ADR 0015)                                                                   |
| **Editor de presets** com as mesmas 5 abas e campos `default_*`                                                                                                   | Editor de modelos no `/admin` (modelos do parceiro) e no `/platform` (modelos da casa)                                           |
| **Lista de agentes** com busca, filtros (status, dono), stats e leads do mês; pausar, ativar, excluir                                                             | Lista no `/admin` com filtro por cliente                                                                                         |
| **Divisão de quem edita o quê**: admin define persona, regras, tools e score; o cliente só escolhe agente, chave, modelo, áudio e RAG, e testa                    | Mantida: é exatamente o que torna seguro o parceiro editar e o cliente não liberar ações                                         |
| **Tools com allowlist** (`create_contact`, `edit_contact`, `add_tag`, `add_note`, `think`)                                                                        | Catálogo de ferramentas do motor, autorizadas no servidor (substitui o Policy Engine do n8n)                                     |
| **Regras de pontuação** `{rule_id, key_group, label, signal, points −100..100, capture_field, notify_immediately}`, com `rule_id` estável                         | Mesmo formato, validado por Zod; o `rule_id` nunca é regenerado                                                                  |
| **Log de pontuação** (`ai_lead_activities`, temperatura hot/warm/cold/suspect, `score_breakdown`)                                                                 | Mesma tabela, ligada ao contato do CRM do GUIDU                                                                                  |
| **Parceiros de encaminhamento** (`ai_agent_partners`, `referral_tag` único por workspace)                                                                         | Mesma ideia; o nome muda para "indicações" para não confundir com o parceiro da plataforma                                       |
| **BYOK** por provedor (OpenRouter, Anthropic, Gemini, OpenAI) e lista de modelos consultada no provedor com a chave do cliente                                    | O cofre do GUIDU já existe (`src/core/credentials/`); falta o OpenRouter e a consulta de modelos                                 |
| **"Testar integração"** antes de ativar                                                                                                                           | Vira **"Testar agente"**: um chat de teste na gaveta, sem canal real, com o prompt renderizado e as ferramentas em modo simulado |
| **Regras de segurança**: nunca confiar no id de agente vindo do cliente; rotas internas resolvem o workspace pelo canal, não pelo corpo; credencial nunca exposta | Mantidas, e reforçadas por RLS                                                                                                   |
| **SmartStatusBanner** no feedback das telas                                                                                                                       | Já é o padrão do GUIDU (ADR 0016)                                                                                                |

### Descarta (era só por causa do n8n)

- Colunas `n8n_*`, provisionamento, templates BYOK por provedor, credencial criada no n8n, troca de provider detectada no n8n.
- View `n8n_ai_agent_config`, Test Harness, Redis Chat Memory, rotas `/api/internal/n8n/crm/*` e seus segredos.
- Render de prompt duplicado (app e n8n): no GUIDU existe **um único** renderizador, no motor, usado pelo teste e pela produção. O risco de divergência some.

### Corrige ao portar (problemas apontados no próprio handoff)

1. **Códigos dos selects × mapas do prompt** (`handoff_mode`, `after_hours_behavior`, `out_of_scope_action`): um único enum por campo, compartilhado entre a tela e o renderizador.
2. **Clone que esquece colunas**: a configuração vira um documento por aba, validado por Zod. Clonar copia o documento inteiro, então campo novo nunca fica para trás.
3. **Credencial da plataforma sem runtime**: definir a precedência (veja pergunta 4) ou cortar.
4. **Sem RLS por workspace**: no GUIDU tudo nasce com RLS forçado.
5. **79 colunas soltas**: poucas colunas indexadas (dono, status, modelo de origem) e a configuração em JSON tipado por aba, com versão.

## 2. O parceiro editar o agente do cliente pelo `/admin`

**É possível, mas muda uma regra aprovada.** A ADR 0012 diz que papéis de parceiro **não acessam dados dos workspaces dos clientes**; o acesso de suporte só existe por concessão temporária, aprovada pelo cliente (`src/core/partners/support.ts`).

Proposta para conciliar as duas coisas (vira revisão da ADR 0012):

- **Configuração de agente é recurso gerenciado pelo parceiro.** Membros do parceiro com a permissão nova `partner.ai_agents.manage` leem e editam a **configuração** dos agentes dos clientes do parceiro, pelo `/admin`, sem concessão.
- **Conteúdo continua protegido.** Conversas, leads, contatos do CRM e a base de conhecimento do cliente seguem exigindo a concessão temporária. O parceiro configura o agente, mas não lê as conversas dos clientes finais.
- **Transparência:** toda edição do parceiro é auditada e aparece para o cliente ("Alterado por <parceiro> em…"), e a tela do cliente mostra que o agente é gerenciado pelo parceiro.
- **Técnica:** a RLS das tabelas de agente aceita o membro do parceiro dono do workspace (`workspaces.partner_id`), só nessas tabelas e só para configuração.

## 3. Modelo de dados proposto

| Tabela                                      | Dono                                       | Conteúdo                                                                                                                             |
| ------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ai_agent_templates`                        | Casa ou parceiro                           | Modelos (presets): segmento, prompt template, defaults por aba, ferramentas padrão, versão, aprovado por                             |
| `ai_agents`                                 | Parceiro (Assistente) ou workspace (GUIDS) | Tipo (`assistant` ou `guid`), modelo de origem e versão, configuração por aba (JSON tipado), conexão de modelo, status, quem alterou |
| `ai_agent_referrals`                        | Workspace                                  | Indicações (antigo `ai_agent_partners`)                                                                                              |
| `ai_lead_activities`                        | Workspace                                  | Pontuação por contato do CRM                                                                                                         |
| `ai_knowledge_bases`, `ai_knowledge_chunks` | Parceiro ou workspace                      | RAG (pgvector), etapa própria                                                                                                        |
| Camada de canais (ADR 0011)                 | Núcleo                                     | Conexões, rotas, conversas e entregas; o Chatwoot primeiro                                                                           |
| Conversas e mensagens                       | Workspace                                  | Evolução das tabelas do protótipo (`agent_sessions`, `agent_messages`)                                                               |

Limites do plano (entitlements que já existem): `ai_agents.max` (1 a 3, contando mesmo com BYOK) e `ai_agents.custom` (permite agente personalizado ou só modelo pronto).

## 4. Telas

| Onde               | Tela                                                                                                                                                                  | Origem no legado                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `/platform`        | Modelos da casa; chaves da plataforma (se mantidas)                                                                                                                   | `/app/admin/presets`, `/settings/keys`      |
| `/admin`           | **Assistente GUIDU** do parceiro: nome, marca, instruções, base de conhecimento, modelo                                                                               | Novo                                        |
| `/admin`           | **Modelos do parceiro** (5 abas)                                                                                                                                      | Editor de presets                           |
| `/admin`           | **Agentes dos clientes**: lista com filtro por cliente e editor de 5 abas na gaveta                                                                                   | `/app/admin/ai-agents`                      |
| `/app/[workspace]` | **GUIDS**: agentes do workspace dentro do limite do plano; escolher modelo pronto (ou personalizar, se o plano permitir), chave, modelo, áudio, RAG; testar na gaveta | Configurações do Widget + Testar Integração |
| `/app/[workspace]` | Credenciais (já existe) com OpenRouter e lista de modelos                                                                                                             | `settings/workspace/credentials`            |
| Cabeçalho          | Chat do Assistente GUIDU na gaveta (o botão já existe, "em breve")                                                                                                    | Novo                                        |

## 5. Etapas (uma PR cada, com "pode começar")

| Etapa                                      | Entrega                                                                                                                                                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A0. Especificação e decisões**           | Especificação v1.0 do módulo (motor + Assistente + GUIDS), substituindo a v0.3; dicionário de campos das 5 abas com os enums unificados; ADR do SDK (AI SDK); revisão da ADR 0012 (seção 2); descongelamento formal do módulo (C04) |
| **A1. Dados**                              | Migrations: modelos, agentes, indicações, lead activities, limites do plano, RLS (incluindo o acesso do parceiro à configuração); dados iniciais com os 2 presets do legado. Prisma e testes de isolamento                          |
| **A2. Motor**                              | `src/core/ai/`: runtime com o SDK, chave BYOK do cofre, renderizador único de prompt (as 25 tags do legado), ferramentas com allowlist (contato, tag, nota do CRM), pontuação de lead, consumo e auditoria. O protótipo atual sai   |
| **A3. Telas do `/admin` e do `/platform`** | Modelos, lista e editor de agentes dos clientes, auditoria visível                                                                                                                                                                  |
| **A4. Telas do `/app` (GUIDS)**            | Escolha do modelo, chave, modelo de IA, limite do plano, chat de teste na gaveta                                                                                                                                                    |
| **A5. Canais e Chatwoot**                  | Núcleo de canais (ADR 0011) e adaptador Chatwoot via Agent Bot: o GUIDS atende de verdade e substitui o n8n inbox por inbox                                                                                                         |
| **A6. Notificação e indicações**           | Aviso ao dono por score (WhatsApp, e-mail), encaminhamento para indicações, regras de horário e fora do escopo                                                                                                                      |
| **A7. Base de conhecimento**               | Upload, embeddings, busca com fonte; ligada a GUIDS e ao Assistente                                                                                                                                                                 |
| **A8. Assistente GUIDU**                   | Chat na gaveta do cabeçalho, com marca do parceiro, base de conhecimento e, depois, ações por proposta e confirmação                                                                                                                |

Áudio (transcrição e voz) entra com o canal que precisar dele, a partir da A5.

## 6. Decisões do Marcelo (12/10/2026)

1. O parceiro edita só a configuração dos agentes dos clientes; conversas, leads e base continuam exigindo concessão. **Sim.**
2. Divisão do legado mantida; no agente personalizado o cliente edita persona e regras, nunca as tools. **Sim.**
3. Primeiro canal: Chatwoot via Agent Bot. **Sim.**
4. **Três chaves:**
   - **Chave do cliente:** usada pelos GUIDS do workspace.
   - **Chave do admin (parceiro):** usada pelo Assistente GUIDU no `/admin` e nas dúvidas dos clientes no `/app`.
   - **Chave da plataforma (backup):** entra quando a chave do cliente falha ou bate limite, termina a conversa em andamento e vale por até 24 horas. O cliente recebe um aviso da falha na chave dele. Avaliar desativar o agente quando isso acontece.
   - **Detalhes do backup:** só termina as conversas que já estavam abertas; se o cliente não corrigir a chave em 24 horas, o agente pausa sozinho, com novo aviso; o uso do backup é **cortesia**, com um modelo barato, e não conta no consumo do cliente (fica medido como custo da plataforma).
   - **Assistente GUIDU:** a casa e os parceiros usam o mesmo modelo de admin. Cada parceiro recebe um Assistente pré-configurado e pode alterá-lo; no `/admin` existe um único Assistente por parceiro, sem limite de plano.
   - **Limite de plano** só para clientes: de 1 a 3 GUIDS conforme o plano. Padrão assumido: o plano também diz se o cliente pode ter GUIDS personalizado (mensagem de 12/10, 19:05).
5. A0 (documentos) em paralelo com S2, U3 e F6a; código depois da F6a. **Ok.**

## 7. Perguntas originais

1. **Acesso do parceiro:** o parceiro edita só a configuração dos agentes dos clientes, e conversas, leads e base continuam exigindo concessão do cliente? _Recomendo assim._
2. **O que o cliente edita:** mantemos a divisão do legado (cliente escolhe agente, chave, modelo, áudio e RAG; persona, regras, tools e score ficam com o parceiro)? No agente personalizado, o cliente edita também persona e regras, mas nunca as tools. _Recomendo assim._
3. **Primeiro canal:** o GUIDU não tem o widget MobioChat. Começamos pelo Chatwoot via Agent Bot numa inbox existente? _Recomendo sim._
4. **Chave da plataforma:** mantemos a chave da casa (com precedência: chave do cliente, depois a da plataforma) ou só BYOK no começo? _Recomendo só BYOK no GUIDS e chave do parceiro no Assistente._
5. **Ordem:** a A0 (só documentos) pode correr em paralelo com S2, U3 e F6a; o código (A1 em diante) entra depois da F6a? _Recomendo assim._

As 4 perguntas anteriores ([assistente-e-guids.md](assistente-e-guids.md), seção 5) continuam valendo para o Assistente.
