# Plano da dupla GF1 e TR1

- **Estado:** perguntas respondidas em 19/10/2026. Começa depois do "pode começar" do Marcelo.
- **Data:** 19/10/2026
- **Origem:** [prioridades](prioridades-agentes-e-inbox.md), P1: a dupla da vez.
- **Trabalho em paralelo:** duas etapas, cada uma com branch, PR, banco local e portas próprios (`AGENTS.md`). As duas não mexem nos mesmos arquivos.
- **Migrations reservadas:**
  - GF1: `20261219090000_gf1_factory_guids`;
  - TR1: `20261220090000_tr1_contact_locale`.

  A `20261218090000` continua reservada para a IN7b.

## GF1 — Os quatro GUIDS de fábrica

### Contexto

- Os GUIDS nascem de modelos (`ai_agent_templates`, A1 e A3a), que a plataforma e o parceiro publicam.
- `createGuid` copia a configuração inteira do modelo e cria o agente como rascunho, dentro da cota `ai-agents.max`. A cota é por workspace, o padrão do manifesto é 1, e o plano pode mudar esse número.
- Ligar um GUIDS exige um teste com sucesso daquela configuração, feito com a chave do cliente (A4b).
- A divisão de campos (`src/core/ai/config/editing.ts`) já resolve o que o cliente edita:
  - sem personalizar, ele muda a conexão de modelo, o resumo do negócio e os produtos;
  - personalizado (`customized = true`), ele muda também a visão geral, o escopo e as regras, nunca as ferramentas.
- Hoje um módulo é ligado por `setWorkspaceModuleStatus` (Configurações › Módulos) ou na criação do cliente pelo parceiro (`createPartnerCustomer`).

### Objetivo

Todo workspace com o módulo Agentes de IA ligado tem os quatro GUIDS de fábrica (@ops, orquestrador, atendente e vendedor), com prompts de fábrica e a chave do cliente, desligados até haver chave e teste.

### Requisitos

1. **Quatro modelos de fábrica da plataforma**, semeados pela migration: `kind = 'guid'`, `partner_id` nulo e publicados, com prompt e padrões em pt-BR.

   | Papel            | Nome padrão | Ferramentas                                                                                         | Nasce                                                                                                          |
   | ---------------- | ----------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
   | **ops**          | Ops         | `think`, `search_knowledge`, `set_conversation_variable`                                            | Travado. Só age com @ (a regra vale quando existir a sala de operação, P2)                                     |
   | **orquestrador** | Recepção    | `think`, `handoff`, `create_contact`, `search_knowledge`                                            | Travado. Porta de entrada: responde o simples e transfere. O encaminhamento ao atendente e ao vendedor é a GF2 |
   | **atendente**    | Atendente   | `think`, `create_contact`, `add_note`, `score_lead`, `handoff`, `search_knowledge`, `refer_contact` | **Personalizado** (`customized = true`): o prompt é editável                                                   |
   | **vendedor**     | Vendedor    | `think`, `search_knowledge`, `send_portfolio_media`, `handoff`                                      | Travado. O prompt diz que cotação, carrinho e pagamento ainda não existem e manda passar para a equipe         |

2. **Papel de fábrica no agente:** a coluna nova `ai_agents.factory_role` (`ops`, `orchestrator`, `attendant`, `seller` ou nula), única por workspace.
3. **Semeadura idempotente:** a função `ensureFactoryGuids(tx, ctx)` cria só os papéis que faltam, como rascunho, pelo mesmo caminho do `createGuid` (cópia do modelo, cota com o lock do workspace, auditoria `ai_agents.guid.create` com `factory: true`).
   - É chamada quando o módulo Agentes de IA passa a ligado (`setWorkspaceModuleStatus` e `createPartnerCustomer`).
   - Também ao abrir a página Agentes de IA, para os workspaces que já tinham o módulo ligado.
4. **Os quatro sempre existem** (resposta 1): um GUIDS de fábrica não sai de vez. Se o cliente o exclui, ele volta **desligado** (rascunho, com a configuração do modelo) na próxima semeadura. Na tela, a ação dele é **Desativar**, e não Excluir.
5. **Cota:** o padrão de `ai-agents.max` passa de 1 para **4**. Se a cota do plano não comportar os quatro, cria os que couberem, na ordem orquestrador, atendente, vendedor e ops, e a página avisa quantos faltaram.
6. **Tela Agentes de IA:**
   - abas segmentadas **GUIDS ativos | GUIDS inativos**: ativos são os ligados; inativos, os desligados (rascunho ou pausados);
   - um selo "De fábrica" nos quatro, com o papel fixo (Ops, Recepção, Atendente, Vendedor);
   - **nome e avatar editáveis** em qualquer GUIDS de fábrica, mesmo sem personalizar; o papel não muda. O avatar vem de uma galeria fixa (ícone e cor) até existir o upload de imagens (a escolha do Storage, F5e);
   - o aviso "Cadastre a chave e teste para ligar" enquanto não houver chave;
   - o botão **Restaurar prompt de fábrica** na gaveta do GUIDS: recopia o prompt do modelo e pede um teste de novo, porque a configuração mudou (A4b).
7. **Modelos editáveis na plataforma** (`/platform`, A3a), como os outros modelos da casa. Uma versão nova do modelo não muda os GUIDS que já existem: "Restaurar" traz a versão atual.

### Lógica

- **Migration:**
  - `ai_agents.factory_role` com `check` e índice único por (`workspace_id`, `factory_role`);
  - o marcador de semeadura por workspace;
  - os quatro modelos.
- **Serviço** em `src/modules/ai-agents/server/services/factory.ts`, chamado pelos dois caminhos que ligam o módulo e pela página. Ele roda como quem ligou o módulo, e falhas de cota não impedem ligar o módulo.
- **Textos** em `aiConsole.json` e nos textos do módulo, nos três idiomas.

### Testes

- **Unitário:** a ordem de prioridade quando a cota não comporta os quatro.
- **Integração** (`tests/core/ai-factory-guids.test.ts`):
  - ligar o módulo cria os quatro como rascunho;
  - ligar de novo não duplica;
  - apagar um não o recria;
  - com cota 2, cria orquestrador e atendente;
  - "Restaurar" volta o prompt e exige teste;
  - RLS: ninguém de outro workspace lê.
- **e2e** (`e2e/ai-agents.spec.ts`): ligar o módulo, ver os quatro com o selo e o aviso da chave.

## TR1 — Idioma do contato

### Contexto

- O piloto de Búzios atende em português, inglês e espanhol ([tradução](../modules/inbox/traducao.md)), e a equipe tem um idioma por workspace.
- O texto das mensagens não fica no banco (ADR 0023): o processamento do evento do consumidor (`src/core/matrix/events.ts`) vê o texto em memória e grava só marcas, como `last_consumer_message_at`.
- Uma sala por pessoa e loja (IN7a), e o espelho fica em `matrix_rooms`.

### Objetivo

Cada conversa sabe o idioma do contato (pt-BR, en ou es), detectado sozinho e corrigível pela equipe. O GUIDS responde nesse idioma, e a TR2 traduz a partir dele.

### Requisitos

1. **Colunas no espelho `matrix_rooms`:**
   - `contact_locale`: `pt-BR`, `en` ou `es`, nula enquanto não se sabe;
   - `contact_locale_source`: `detected` ou `manual`;
   - `contact_locale_confidence`: de 0 a 1.
2. **Detecção na mensagem do consumidor,** em memória, no mesmo processamento do evento:
   - um detector próprio e pequeno, por palavras e sinais comuns das três línguas (¿, ¡, ñ, ç, ã, "the", "que", "você"…), sem dependência nova;
   - mensagens curtas ou ambíguas ("ok", "gracias", emoji, número) não mudam o idioma já gravado;
   - o idioma só muda com confiança acima de um limite;
   - nada do texto é gravado.
3. **O manual vence:** quando a equipe corrige, a detecção não muda mais o idioma daquela conversa.
4. **Na conversa:**
   - chip com o idioma no cabeçalho da conversa ("🇪🇸 Espanhol ▾"), com menu para corrigir entre português, inglês e espanhol;
   - corrigir exige poder responder (`inbox.reply`) e passa pela ação do servidor, com auditoria `inbox.contact_locale.set`.
5. **Na lista:** o mesmo idioma como selo pequeno quando for diferente do idioma do workspace.
6. **GUIDS:** o turno do GUIDS no Inbox (`guids-turn.ts`) recebe "Idioma do contato: espanhol. Responda nesse idioma." quando o idioma é conhecido e diferente do idioma do agente. Isso já ajuda o piloto antes da tradução.
7. **Fora da TR1:**
   - áudio (TR4);
   - idioma do navegador no guidu.chat, que ainda não existe. A coluna `source` já aceita `browser` para quando ele chegar.

### Lógica

- **Migration:** as três colunas, com `check`. A função do núcleo que grava o idioma detectado fica em `private`, e a correção manual passa pela ação do servidor com as mesmas políticas da mudança de conversa.
- **Detector** em `src/core/matrix/locale.ts`, puro e testável.
- **Interface:** chip no cabeçalho da conversa, selo na lista, e textos nos três idiomas.

### Testes

- **Unitário** (`src/core/matrix/locale.test.ts`):
  - frases típicas de turista nas três línguas;
  - mensagens curtas que não decidem;
  - mistura de línguas;
  - limite de confiança.
- **Integração** (`tests/core/inbox-locale.test.ts`, Synapse local):
  - a mensagem em espanhol grava `es`;
  - "ok" não muda;
  - a correção manual vence a detecção seguinte;
  - o texto não aparece em nenhuma tabela;
  - o GUIDS recebe a linha do idioma.
- **e2e** (`e2e/inbox.spec.ts`): o consumidor escreve em espanhol, o chip mostra Espanhol, e o atendente corrige para português.

## Aceite das duas

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` verdes.
- `e2e` e `e2e-inbox` verdes no CI.
- Migrations aplicadas no dev depois do PR aprovado, com `scripts/migrate.ts`.
- Capturas no PR: a tela de Agentes de IA com os quatro GUIDS, e o chip de idioma na conversa.

## Respostas do Marcelo (19/10/2026)

1. **GUIDS de fábrica excluído:** volta desligado. A tela ganha as abas GUIDS ativos e GUIDS inativos.
2. **Nomes padrão:** Ops, Recepção, Atendente e Vendedor, com opção de trocar o nome e o avatar. O papel fica fixo.
3. **Workspaces que já existem com o módulo ligado:** recebem os quatro.
4. **Idioma fora das três línguas:** fica desconhecido e o GUIDS segue no idioma dele.
