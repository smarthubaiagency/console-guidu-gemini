# Plano CF6a — IA: provedores e modelos

Branch `claude/cf6a-ia-provedores` (worktree `/home/claude/wt-cf6a`). Migration `20261119090000_cf6a_ai_providers.sql`.

## Contexto

Provedores no código (`src/core/ai/providers.ts`: OpenAI, Anthropic, Google/Gemini, OpenRouter). Chaves cifradas por dono (cliente = GUIDS, parceiro = Assistente no /admin e perguntas no /app, plataforma = reserva por 24 h). Hoje o modelo é digitado. Uso registrado por turno em `ai_usage_events` (só os que deram certo; erros só em `ai_messages.error_code` e na auditoria).

## Objetivo

Menu IA na plataforma com abas Painel, Provedores e modelos, Modelos de agente, Chave reserva; catálogo de modelos em cascata (ADR 0018); escolha do modelo numa lista; base URL só da plataforma; painel de uso e erros (plataforma e parceiro) com avisos.

## Lógica (decisões)

1. **Cascata em `settings` (sem tabela nova, ADR 0018).** Chaves novas no catálogo:
   - `ai.providers` (lista; plataforma e parceiro): provedores que parceiros e clientes podem escolher. Novo tipo "só restringe" (`narrow`): o valor do nível de baixo é cruzado com o de cima (o parceiro nunca libera o que a plataforma desligou).
   - `ai.models` (provedor → lista de modelos; plataforma e parceiro, "só restringe"): o primeiro modelo da lista é o padrão. Provedor sem lista do parceiro herda a da plataforma. Lista vazia na plataforma = campo livre para aquele provedor (nada some de quem já usa).
   - `ai.base_urls` (provedor → URL https; só plataforma): gateway compatível. Vale só para as chamadas de texto (conversa e teste da chave), sempre pelo `pinnedFetch` dos canais (https, DNS fixado no socket, sem redirecionamento). Transcrição e voz seguem direto no provedor (o `pinnedFetch` não envia multipart).
   - O cliente não tem nível próprio: vê o que sobrou.
2. **Sincronizar modelos:** não há chave global. Decisão final: catálogo editado à mão, começando por um catálogo semeado no código. O "Buscar modelos" do OpenRouter ficou de fora: a lista pública passa do limite de 2 MB da guarda de rede e só sugeriria nomes; fica como pendência se o Marcelo quiser.
3. **Escolha do modelo:** editor de agente (GUIDS no /app e no /admin, Assistente, modelos de agente) troca o campo de texto por uma lista dos modelos do provedor da chave. Modelo salvo fora do catálogo continua na lista marcado "fora do catálogo", com aviso; o agente continua respondendo (o turno não confere o catálogo). O servidor só recusa quando provedor ou modelo **mudam** para algo fora do permitido. Chave de provedor desligado: não aparece para escolha nova; a já escolhida continua e mostra aviso.
4. **Cofres:** cadastrar chave nova de provedor desligado é recusado (cofre do cliente para IA e cofre do parceiro). A chave reserva da plataforma não segue o catálogo (é da plataforma).
5. **Erros no uso:** coluna `error_code` em `ai_usage_events`; o turno que falha (GUIDS e Assistente) e a falha da chave do cliente gravam uma linha com tokens 0 e o código. Nenhuma tela de consumo soma linhas, então nada muda para o cliente.
6. **Painel:** últimos 7 ou 30 dias. Plataforma: cartões (provedores ligados, requisições, tokens, erros, avisos), por provedor e por parceiro. Parceiro (/admin › Agentes de IA › Painel de IA): o mesmo para os clientes dele (política nova: parceiro lê o uso dos workspaces das suas empresas), por cliente.
7. **Avisos no painel:** chave reserva sem configurar; GUIDS em backup ou pausados por falha de chave; provedor com taxa de erro alta (≥ 20% e ≥ 5 erros no período); agentes com modelo fora do catálogo ou provedor desligado; Assistente sem chave. Na plataforma, a contagem de agentes vem de `private.ai_agents_overview()` (security definer, só agregados, só owner/operations).
8. **Menu:** plataforma "IA" (antes "Agentes de IA") com abas como Operações; "Backup de IA" vira "Chave reserva". Parceiro: em Agentes de IA, "Painel de IA" e "Provedores e modelos" (restringir para os clientes).

## Plano

Migration → catálogo/resolve (narrow) → `src/core/ai/catalog.ts` (política efetiva, validação de escolha) → providers/base URL → gravação de erros no uso → painel (serviço) → telas plataforma e parceiro → editor com lista → cofres → i18n 3 idiomas → testes (SQL, unidade, integração, e2e) → docs (ESTADO, ADR 0018, handoff).

## Testes

SQL `tests/core/ai-providers-rls.sql`; unidade do resolve narrow e do catálogo; integração `tests/core/ai-providers.test.ts`; e2e `e2e/platform-ai.spec.ts` e `e2e/partner-ai.spec.ts` ajustados.

## Decisões para o Marcelo confirmar

- Catálogo inicial semeado no código (editável).
- Base URL só para texto.
- Provedor desligado não para agentes já configurados (só aviso), como o modelo fora do catálogo.
- Parceiro lê o uso (tokens, provedor, modelo, erros) dos workspaces dos seus clientes.
- Sem "Sincronizar modelos" (nem o do OpenRouter).
- A restrição do parceiro vale também para o Assistente dele.
- O endereço do gateway fica legível por quem lê a cascata (membros); por isso não aceita usuário, senha nem parâmetros.
- Uma chamada que falha conta uma vez no uso (com a falha da chave do cliente e a reserva respondendo, aparecem a linha de erro do cliente e a de cortesia).

## Estado (15/10/2026)

Implementado no worktree `wt-cf6a` (branch `claude/cf6a-ia-provedores`), migration `20261119090000_cf6a_ai_providers.sql`.
