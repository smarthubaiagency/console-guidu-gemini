# Plano da dupla TR3 e GF2

- **Estado:** aprovado em 21/10/2026: o Marcelo respondeu "todas como sugerido" às perguntas (seção "Perguntas"). Implementação em andamento.
- **Data:** 21/10/2026
- **Origem:** [prioridades](prioridades-agentes-e-inbox.md), P1: o par 4 da ordem sugerida, escolhido pelo Marcelo em 21/10/2026.
- **Base:** `main` em `faa17d1` (PR #128: TR2).
- **Trabalho em paralelo:** duas etapas, cada uma com branch, worktree, PR, banco local e portas próprios (`AGENTS.md`), feitas pelo `guidu-dev` e passando por `guidu-revisao` e `guidu-qa` ([time de subagentes](../operacao/time-de-subagentes.md)). A TR3 mexe no Inbox e no núcleo de tradução; a GF2 mexe no turno do GUIDS e nas ferramentas. A única peça em comum é o turno do GUIDS na sala (IN6), que a TR3 só lê.
- **Migrations propostas:**
  - TR3: `20261223090000_tr3_inbox_outbound_translation`;
  - GF2: `20261224090000_gf2_guids_delegation`.

  A `20261218090000` continua reservada para a IN7b.

## TR3 — Resposta da equipe com prévia traduzida

### Contexto

- O desenho está em [tradução do chat](../modules/inbox/traducao.md), seções 5.2, 5.4 e 9, e o que ficou da TR2 na seção 12.
- A TR2 traduz o que **chega** (contato e GUIDS) num job, e grava em `inbox_message_translations` com `direction = 'inbound'`. A coluna `direction` já prevê `outbound` para esta etapa.
- Os motores (IA com a chave do cliente e Google Translate Basic, com fallback de 4 s) estão em `src/core/translation/` e hoje só rodam no worker.
- A resposta da equipe sai do navegador, pelo `matrix-js-sdk` (`client.sendTextMessage` em `conversation-view.tsx`), com a conta Matrix do atendente.
- A caixa de mensagem da IN5a tem o ícone ✦ reservado, desligado com "em breve", para receber a prévia da tradução nesta etapa.
- O idioma do contato está no espelho da sala (TR1, `matrix_rooms.contact_locale`), e o detector de idioma está em `src/core/matrix/locale.ts` (`detectContactLocale`).

### Objetivo

Com a tradução ligada e o contato num idioma diferente do da equipe, o atendente escreve em português, vê a prévia no idioma do contato, pode editá-la e envia. A sala recebe só a versão no idioma do contato; o original fica no Supabase e a equipe continua lendo em português.

### Requisitos

1. **Quando traduzir:** só com a tradução ligada (TR2), o idioma do contato conhecido e diferente do da equipe, no modo **Responder**. Nota privada nunca é traduzida. Com o rascunho já no idioma do contato (detectado com confiança), envia direto, sem prévia (traducao.md §5.2.4).
2. **Prévia antes de enviar** (traducao.md §9.2: ninguém envia sem ver). Ao enviar, a caixa mostra a prévia no idioma do contato, editável, com:
   - **Enviar em espanhol** (o idioma do contato no rótulo);
   - **Enviar sem traduzir** (envia o original);
   - **Voltar** (fecha a prévia e mantém o rascunho).
     O ✦ passa a ligado e gera a prévia sem enviar (pergunta 1).
3. **Tradução da prévia no servidor**, por uma ação com a mesma checagem do envio (nível `reply` no Inbox), usando os motores da TR2 com o mesmo fallback de 4 s, o glossário e o texto da equipe delimitado como dado. Nada vai para a sala nesse momento.
4. **Os dois motores falham:** não envia sozinho (traducao.md §5.4). A prévia mostra "Tradução indisponível" com **Tentar de novo**, **Enviar sem traduzir** e **Voltar**.
5. **Registro da saída:** depois que o Synapse aceita a mensagem, o servidor grava em `inbox_message_translations` uma linha `outbound` ligada ao `event_id` enviado: idioma de origem e de destino, o **texto original** da equipe, o texto enviado, motor, modelo, `fallback` e se a prévia foi editada.
   - O servidor confere, lendo o evento no Synapse como o núcleo, que o remetente é a conta Matrix do atendente que chamou a ação e que o corpo é o texto enviado. Sem isso, não grava.
   - Quem lê continua sendo quem tem nível no Inbox; o web só grava a própria saída, por uma função do banco com essa checagem.
6. **No Inbox, para a equipe:** a mensagem enviada aparece com o original em português e, embaixo, "Enviado em espanhol · Modelo de IA" com **Ver enviado**, que alterna para o texto que o contato recebeu. Para o consumidor nada muda: ele só vê a mensagem no idioma dele.
7. **Job da TR2:** mensagens da própria equipe continuam fora da tradução de entrada (já é assim).
8. **Uso e custo:** cada prévia conta no uso de IA do workspace como as traduções da TR2 (chave do cliente, sem limite nosso).

### Lógica

- **Migration:** coluna `source_text` (só `outbound`) e `edited` em `inbox_message_translations`; função `private.inbox_translation_record_outbound` para o web, que exige nível `reply`, a sala no contexto e o `event_id` ainda sem registro. As policies de leitura não mudam.
- **Núcleo:** `src/core/translation/run.ts` ganha a tradução direta (sem job), com o mesmo contrato e o mesmo fallback; a leitura do evento para a conferência usa o núcleo Matrix (`src/core/matrix/`).
- **Módulo:** `src/modules/inbox/translation-actions.ts` ganha `previewOutboundTranslationAction` e `recordOutboundTranslationAction`; `loadMessageTranslationsAction` passa a devolver também as linhas `outbound`.
- **Interface:** `composer.tsx` e `composer-frame.tsx` (estado da prévia, ✦ ligado), `conversation-view.tsx` (envio do texto escolhido e o registro depois do envio), `message-translation.tsx` ("Enviado em … · Ver enviado").
- **Textos** em `inbox.json` nos três idiomas.

### Testes

- **Unitário:** a regra de quando traduzir (ligado, idioma conhecido, diferente, modo Responder, rascunho já no idioma do contato); a prévia com fallback e com os dois motores falhando.
- **Integração** (`tests/core/inbox-outbound-translation.test.ts`): a ação de prévia não grava nada; o registro grava `outbound` com o original; recusa evento de outro remetente ou com corpo diferente; quem só lê não gera prévia nem grava; RLS entre workspaces; apagar a sala apaga as linhas.
- **SQL:** a função nova e as colunas (permitido e negado).
- **e2e** (`e2e/inbox.spec.ts`, com o dublê do Google Translate): contato em espanhol, atendente escreve em português, vê a prévia, edita, envia; o consumidor recebe em espanhol; a equipe vê o português com "Ver enviado"; "Enviar sem traduzir" manda o original.

## GF2 — Orquestrador encaminhando ao atendente e ao vendedor

*Como ficou: [gf2-encaminhamento.md](gf2-encaminhamento.md).*

### Contexto

- A GF1 criou os quatro GUIDS de fábrica (`ai_agents.factory_role`: `ops`, `orchestrator`, `attendant`, `seller`), desligados até haver chave e teste. O orquestrador (nome padrão "Recepção") tem `think`, `handoff`, `create_contact` e `search_knowledge`; o encaminhamento ficou para esta etapa.
- O desenho está em [agentes na Matrix](agentes-na-matrix-e-compra-agentica.md), seções 2.2 (uma persona por lado), 4.2 (GUIDS de fábrica, regras 2 e 3) e 7.1 (segurança dos agentes: um nível de delegação, saídas com schema, orçamento por pedido).
- As prioridades (seção 5.2) pedem que o encaminhamento ao vendedor já nasça com **contrato estruturado (Zod e versão)**, a tomada da compra agêntica.
- O turno do GUIDS está em `src/core/ai/turn/guid.ts` (job `ai-agents.guid-turn`, resposta validada pelo `ResponsePlan`), e as ferramentas em `src/core/ai/tools/catalog.ts`. O mesmo turno atende o Inbox (IN6, a sala escolhe o GUIDS em Configurações › Módulos › Inbox ou por número da Meta, IN7a) e o Chatwoot (`channel-consumer.ts`).

### Objetivo

Quando o GUIDS da conversa é o orquestrador de fábrica, ele responde sozinho o simples e encaminha ao atendente ou ao vendedor o que é deles. O contato vê sempre um só nome, o do orquestrador.

### Requisitos

1. **Ferramenta `delegate`** do orquestrador, com contrato Zod versionado: `{ version: 1, to: "attendant" | "seller", reason, summary }`. Só o orquestrador de fábrica a tem; atendente e vendedor não delegam (um nível, agentes §7.1.2).
2. **Quem responde:** o especialista roda o turno com a própria configuração (prompt, ferramentas, modelo) sobre a mesma conversa, recebendo o `summary` do orquestrador como contexto, e a resposta sai **com o nome e a conta do orquestrador** (uma persona, agentes §2.2.6). Pergunta 2.
3. **Especialista desligado** (sem chave, sem teste ou pausado): a ferramenta só oferece os especialistas ligados; sem nenhum ligado, o orquestrador segue como hoje (responde ou transfere para a equipe). Pergunta 4.
4. **Mensagens seguintes** (pergunta 3, respondida): depois de encaminhar, a conversa fica com o especialista até ele devolver à recepção (ferramenta `return_to_reception`, só do atendente e do vendedor), a conversa ser resolvida ou ficar 24 h sem mensagem do contato; aí a próxima mensagem volta ao orquestrador.
5. **Orçamento por pedido:** no máximo um encaminhamento por mensagem do contato e um tempo total por turno; acima disso, ou com saída inválida depois de uma nova tentativa, transfere para a equipe (`handoff`) com o motivo.
6. **Registro:** cada mensagem do GUIDS guarda qual agente a escreveu e se veio por encaminhamento; o encaminhamento entra na auditoria (`ai_agents.guid.delegate`, sem o texto da conversa) e no uso de IA de cada agente.
7. **Para a equipe, no Inbox:** um selo discreto no balão, "Respondido pelo Vendedor", só na interface da equipe (nunca na sala). Pergunta 5.
8. **Orquestradores existentes:** os que a GF1 já criou recebem a ferramenta `delegate`, porque as ferramentas dos GUIDS de fábrica são travadas. "Restaurar prompt de fábrica" traz o prompt novo do orquestrador, que explica quando encaminhar.

### Lógica

- **Migration:** a ferramenta `delegate` no modelo de fábrica do orquestrador e nos orquestradores existentes; a coluna do agente que escreveu e da origem (encaminhamento) nas mensagens do GUIDS; o estado do encaminhamento na conversa, se a pergunta 3 pedir.
- **Turno:** `src/core/ai/turn/guid.ts` trata o resultado de `delegate` encerrando o turno do orquestrador e rodando o do especialista na mesma execução; a resposta segue pelo mesmo `ResponsePlan` e pelo envio como orquestrador (`sendAsAgent` no Inbox, a saída do canal no Chatwoot).
- **Ferramenta:** `src/core/ai/tools/catalog.ts` (schema e validação no servidor a cada chamada); `src/modules/ai-agents/factory-roles.ts` e o prompt de fábrica do orquestrador.
- **Interface:** selo no balão do Inbox (`conversation-view.tsx`) e na conversa do GUIDS em Agentes de IA.

### Testes

- **Unitário:** o contrato `delegate` (versão, destino só atendente ou vendedor, recusa de outro destino); a escolha dos especialistas oferecidos (só os ligados).
- **Integração** (`tests/core/ai-guids-delegation.test.ts`, com o modelo falso): o orquestrador responde sozinho o simples; encaminha ao vendedor e a resposta sai como orquestrador, registrada como do vendedor; especialista desligado não é oferecido; atendente e vendedor não têm `delegate`; segundo encaminhamento no mesmo turno é recusado; estouro de tempo ou saída inválida vira `handoff`; RLS entre workspaces.
- **SQL:** a coluna e o estado novos (permitido e negado).
- **e2e** (`e2e/inbox-guids.spec.ts`): o contato pede um produto, o orquestrador encaminha ao vendedor, o contato vê o nome do orquestrador e a equipe vê o selo "Respondido pelo Vendedor".

## Aceite das duas

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, suítes SQL e o e2e do Inbox verdes no CI.
- Revisão (`guidu-revisao`) e validação (`guidu-qa`) aprovadas; migration aplicada no dev `console-guidu` só depois do merge do Marcelo.
- Conferência da interface pelo Marcelo (capturas dispensadas, como na TR2 e na IN5a, salvo se ele pedir).
- Documentação: `traducao.md` ("Como ficou a TR3"), `agentes-na-matrix-e-compra-agentica.md` ou documento próprio da GF2, situação nas prioridades.

## Perguntas

**Respondidas pelo Marcelo em 21/10/2026: todas como sugerido.** Valem as sugestões abaixo; as alternativas ficam só como registro.

### TR3

1. **Quando aparece a prévia?** Sugestão: ao clicar em Enviar (ou Enter), a caixa mostra a prévia em vez de enviar; o ✦ gera a prévia sem enviar. Alternativa: a prévia se atualiza sozinha enquanto o atendente digita, o que custa uma tradução a cada pausa.
2. **Prévia editada:** sugestão: o atendente edita livremente; enviamos a versão editada, guardamos o original em português e marcamos "editada" para a equipe. Alternativa: prévia só leitura (para mudar, edita o português e gera de novo).
3. **Rascunho já no idioma do contato:** sugestão: envia direto, sem prévia, quando o detector da TR1 tem confiança. Alternativa: mostra a prévia sempre que a tradução estiver ligada.
4. **Como a equipe vê a própria mensagem:** sugestão: o original em português, com "Enviado em espanhol · Ver enviado". Alternativa: o texto enviado, com "Ver original".

### GF2

1. **Só o orquestrador de fábrica encaminha?** Sugestão: sim; quem escolheu outro GUIDS para a sala ou o número continua como hoje.
2. **Quem escreve a resposta?** Sugestão: o especialista responde e a mensagem sai com o nome do orquestrador, sem o orquestrador reescrever (mais rápido e mais barato). Alternativa: o orquestrador recebe a resposta e reescreve no próprio tom (uma chamada a mais por mensagem).
3. **As mensagens seguintes:** sugestão: depois de encaminhar, a conversa fica com o especialista até ele devolver à recepção (ferramenta própria), a conversa ser resolvida ou ficar 24 h sem mensagem. Isso evita pagar o orquestrador em toda mensagem. Alternativa: toda mensagem passa de novo pelo orquestrador, como diz a regra 3 da seção 4.2 dos agentes, que decide de novo.
4. **Especialista desligado:** sugestão: a ferramenta nem oferece quem está desligado; sem nenhum ligado, o orquestrador responde o que puder ou transfere para a equipe, como hoje. Alternativa: o orquestrador avisa a equipe de que o especialista está desligado.
5. **Selo para a equipe:** sugestão: "Respondido pelo Vendedor" (ou Atendente) no balão, só no Inbox da equipe e na conversa em Agentes de IA. Alternativa: sem selo.
6. **Chatwoot também?** Sugestão: sim, porque o encaminhamento fica dentro do turno do GUIDS, que já atende os dois caminhos; o selo existe só no Inbox. Alternativa: só no Inbox nesta etapa.
