# Assistente GUIDU e GUIDS: motor único e o que fica separado

Proposta de 12/10/2026, a partir da ideia do Marcelo. Não é decisão: vira especificação depois das respostas da seção 5.

## 1. As duas verticais

|               | **Assistente GUIDU**                                                         | **GUIDS**                                                         |
| ------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Para quê      | Tira dúvidas de quem está logado e executa ações no painel (ações a definir) | Agente do cliente: SDR, agendador, suporte ou personalizado       |
| Dono          | O **parceiro** (marca, nome e base de conhecimento próprios)                 | O **workspace** do cliente                                        |
| Quem conversa | Membro autenticado da plataforma                                             | Contato externo do cliente (não é usuário da plataforma)          |
| Onde conversa | Dentro do painel, na gaveta do cabeçalho (ADR 0015)                          | Canais de mensagem: Chatwoot, WhatsApp, Matrix etc. (spec v0.3)   |
| Quantos       | Um por parceiro                                                              | De 1 a 3 por workspace, conforme o plano, mesmo com chave própria |
| Configura em  | `/admin` (console do parceiro); o padrão da casa em `/platform`              | `/app/[workspace]`                                                |

## 2. Motor único (núcleo, `src/core/ai/`)

Tudo o que é "como um agente pensa" é igual nos dois e fica num lugar só:

1. **Definição do agente:** nome, avatar, instruções, conexão de modelo, ferramentas permitidas e bases de conhecimento ligadas. Uma tabela com o dono explícito (parceiro ou workspace), sempre com RLS.
2. **Runtime do turno:** chamada ao modelo fora da transação, laço de ferramentas, saída estruturada validada por Zod, limites de passos e de tokens. É aqui que entra o SDK (D-AG-02; o AI SDK continua a recomendação por causa do BYOK com vários provedores).
3. **Resolução de modelo e chave:** BYOK do cofre que já existe (`src/core/credentials/`), ou chave da plataforma quando a regra permitir.
4. **Base de conhecimento (RAG):** upload, extração, divisão em trechos, embeddings (pgvector no Supabase) e busca com citação da fonte. Cada base tem um dono, e um agente só busca nas bases ligadas a ele. Na spec v0.3 o RAG estava fora; com o Assistente ele passa a ser obrigatório já na primeira entrega.
5. **Catálogo de ferramentas:** as ferramentas que o MCP já expõe (`src/core/mcp/tools.ts`) e as propostas com aprovação humana (`src/core/proposals/`) viram ferramentas do motor, cada uma com a permissão exigida.
6. **Conversa e mensagens:** histórico, resumo de contexto longo, estados.
7. **Consumo, quotas e auditoria:** tokens, embeddings e áudio medidos por dono, em `src/core/entitlements/` e `audit_events`.
8. **Segurança:** a mensagem do usuário e o conteúdo da base são dados não confiáveis; nenhuma ferramenta genérica de HTTP, SQL ou arquivo; segredo nunca vai para o modelo nem para o log.

## 3. O que fica separado

| Tema                           | Assistente GUIDU                                                                                 | GUIDS                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Identidade das ferramentas** | Age **em nome do usuário logado**: só faz o que as permissões dele permitem, no workspace aberto | Age como **identidade de serviço** do agente, com escopos fixos (ex.: `crm:write`, agenda); o contato externo não tem permissão nenhuma |
| **Execução**                   | Síncrona, com streaming na gaveta                                                                | Assíncrona no worker (pg-boss), com agrupamento de mensagens e entrega idempotente                                                      |
| **Canal**                      | Só o painel; não usa a camada de canais                                                          | Camada de canais do núcleo (ADR 0011)                                                                                                   |
| **Ações**                      | Toda ação que altera dado pede confirmação no painel (proposta ou `confirmStatus`)               | Ações automáticas dentro dos escopos do agente; transferência para humano                                                               |
| **Marca**                      | Nome, avatar e cores do parceiro (branding que já existe, C05)                                   | Nome e persona definidos pelo cliente ou pelo modelo pronto                                                                             |
| **Base de conhecimento**       | Do parceiro (como usar o painel, planos, suporte); ver pergunta 1                                | Do workspace (produtos, preços, FAQ do negócio); o Portfólio entra como ferramenta, não como base copiada                               |
| **Plano e cobrança**           | Custo do parceiro                                                                                | 1 a 3 agentes por plano, contando mesmo com BYOK; modelo pronto ou personalizado conforme o plano                                       |
| **Modelos prontos**            | Não tem                                                                                          | Catálogo mantido em `/platform`: SDR, agendador, suporte… (instruções, ferramentas e campos que o cliente preenche)                     |
| **Privacidade**                | Conversa de usuário da plataforma                                                                | Dado pessoal de cliente final (a plataforma é operadora), com retenção e exclusão próprias                                              |
| **Código**                     | Recurso do núcleo do shell (`src/core/assistant/`), porque aparece em toda área                  | Módulo `ai-agents` renomeado para GUIDS (`src/modules/guids/`)                                                                          |

## 4. Ordem que eu sugiro

1. **Motor único** sem canal: definição, runtime, BYOK, ferramentas, consumo e auditoria, mais a base de conhecimento.
2. **Assistente GUIDU** na gaveta do cabeçalho, só respondendo dúvidas pela base do parceiro. É o jeito mais curto de pôr o motor em uso real, sem webhook nem cliente final.
3. **Ações do Assistente** por proposta e confirmação, uma de cada vez.
4. **GUIDS**: limites do plano, modelos prontos, agente personalizado e teste dentro do painel (a mesma gaveta).
5. **Camada de canais** e o Chatwoot primeiro, para o GUIDS atender de verdade (substitui o n8n).

## 5. Perguntas para fechar

1. **Base do Assistente:** o parceiro começa com uma base GUIDU pronta (como usar a plataforma) e acrescenta a dele, ou a base é 100% dele? _Recomendo base GUIDU + base do parceiro, com a do parceiro tendo prioridade._
2. **Quem paga o modelo do Assistente:** a chave da plataforma, a chave do parceiro, ou a do parceiro com a da plataforma como reserva? _Recomendo a chave do parceiro, com a da plataforma como reserva e limite por plano do parceiro._
3. **Plano do GUIDS:** "1 pronto ou 1 personalizado" quer dizer que o plano define **quantos** agentes (1 a 3) e **se** pode personalizar? _Recomendo assim: quantidade e "permite personalizar" como dois limites do plano._
4. **Base de conhecimento nos GUIDS:** entra já na primeira versão, junto com o Assistente? _Recomendo que sim, já que o motor é o mesmo._
