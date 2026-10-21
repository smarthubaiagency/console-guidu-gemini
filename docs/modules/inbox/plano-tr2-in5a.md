# Plano da dupla TR2 e IN5a

- **Estado:** proposta de 21/10/2026. Perguntas respondidas e "pode começar" do Marcelo em 21/10/2026.
- **Data:** 21/10/2026
- **Origem:** [prioridades](../../architecture/prioridades-agentes-e-inbox.md), P1: a dupla depois de GF1 e TR1. Pedido do Marcelo de 21/10/2026: alternar entre **Responder** e **Nota privada** na mesma caixa de mensagem, como na referência enviada.
- **Base:** `main` em `29e4760` (PR #126: GF1 e TR1).
- **Trabalho em paralelo:** duas etapas, cada uma com branch, PR, banco local e portas próprios (`AGENTS.md`). A única peça em comum é a caixa de mensagem: a IN5a faz a alternância e a TR2 não mexe nela.
- **Migrations propostas:**
  - TR2: `20261221090000_tr2_inbox_translation`;
  - IN5a: `20261222090000_in5a_inbox_notes`.

  A `20261218090000` continua reservada para a IN7b.

## TR2 — Tradução das mensagens que chegam

**Situação (21/10/2026):** implementada no branch `claude/tr2-traducao`, aguardando o PR e a migration no dev. O que ficou e os desvios estão em [tradução, "Como ficou a TR2"](traducao.md#12-como-ficou-a-tr2).

### Contexto

- O desenho está em [tradução do chat](traducao.md), seções 3, 5.1, 5.4, 6 e 8, com as decisões de 19/10/2026: chave do cliente, motor principal mais fallback, Google Translate Basic (v2, chave de API), um idioma por workspace, sem limite nosso.
- A TR1 já grava o idioma do contato no espelho da sala (`matrix_rooms.contact_locale`, origem e confiança) e mostra no Inbox.
- O texto das mensagens não fica no banco (ADR 0023): o processamento do evento (`src/core/matrix/events.ts`) só vê o texto em memória. O núcleo é membro da sala e já lê mensagens pelo Synapse (`recentMessages` em `src/core/matrix/agent.ts`).
- O Inbox lê as mensagens no navegador, pelo `matrix-js-sdk` (`conversation-view.tsx`).
- As chaves de IA do cliente ficam no cofre do workspace (`src/core/credentials/vault.ts`), e o motor de IA (`src/core/ai/`, ADR 0017) é quem as usa.

### Objetivo

Com a tradução ligada, cada mensagem do contato (e do GUIDS) que chega num idioma diferente do da equipe aparece no Inbox traduzida, com "Ver original", o idioma e o motor usado.

### Requisitos

1. **Bloco Tradução** em Configurações › Módulos › Inbox (grava `inbox.manage`, guarda em `workspace_modules.config`, sem segredos):
   - interruptor **Ativar tradução do chat em tempo real**, desligado por padrão;
   - **motor principal:** Modelo de IA (uma chave de IA do cofre e o modelo, com sugestão de um modelo rápido) ou Google Translate;
   - **fallback:** o outro motor, opcional;
   - **idioma da equipe:** mostra o padrão do workspace (`workspaces.default_locale`), só leitura aqui;
   - **glossário:** termos que não se traduzem e termos com tradução fixa (até 200 linhas).
2. **Credencial do Google:** a chave de API do Cloud Translation vai para o cofre do workspace como um tipo novo (`google_translate`), cifrada, mostrada mascarada e com **Testar**. Sem nenhum motor válido, o interruptor não liga.
3. **Job `inbox.translate-message`:** quando chega uma mensagem de texto do contato ou do GUIDS, e o idioma é diferente do da equipe, o processamento do evento enfileira o job só com `room_id` e `event_id`, nunca o texto. O worker lê o evento no Synapse como o núcleo, traduz e grava.
   - O motor de IA recebe as últimas mensagens como contexto e o glossário no prompt. O texto do contato é dado, não instrução (seção 9 de [tradução](traducao.md)).
   - O Google Basic protege os termos do glossário marcando-os como não traduzíveis no formato HTML.
   - Fallback: erro, recusa, cota esgotada ou mais de 4 s sem resposta vão para o fallback e gravam `fallback = true`. Com os dois falhando, grava a falha e tenta de novo mais tarde (três tentativas).
   - Mensagens curtas que não mudam o idioma ("ok", emoji) não são traduzidas.
4. **Tabela `inbox_message_translations`:** `workspace_id`, `room_id`, `event_id`, direção (`inbound` nesta etapa, `outbound` na TR3), idioma de origem e de destino, texto traduzido, motor, modelo, `fallback`, situação (`done` ou `failed`), data. Única por (`event_id`, idioma de destino).
   - Quem tem `inbox.view` lê; só o worker grava (RLS).
   - Apagar a conversa ou o workspace apaga as traduções (cascata e hooks da WS1).
5. **No Inbox:**
   - a mensagem traduzida mostra o texto no idioma da equipe e, embaixo, "Traduzido de espanhol · Modelo de IA" com o link **Ver original**, que alterna no lugar;
   - enquanto traduz, o original com "Traduzindo…"; com falha, o original com "Tradução indisponível";
   - a tela busca as traduções dos eventos visíveis por uma ação do servidor e atualiza quando chega mensagem nova.
6. **Avisos:** chave que falha depois de ligada gera aviso na tela de Configurações e no Inbox, como no backup da A2c.

### Lógica

- **Migration:** a tabela com RLS, o tipo `google_translate` no cofre.
- **Núcleo:** `src/core/translation/` com o contrato do tradutor e dois adaptadores (motor de IA e Google Basic). O Google passa pela guarda de chamadas externas dos canais (`pinnedFetch`).
- **Módulo:** configurações e leitura em `src/modules/inbox/server/translation.ts`; o job registrado no catálogo de jobs.
- **Textos** em `inbox.json` nos três idiomas.

### Testes

- **Unitário:** escolha do motor e fallback (erro, cota, tempo), glossário no prompt e no HTML do Google, mensagens curtas ignoradas.
- **Integração** (`tests/core/inbox-translation.test.ts`): o job grava a tradução; mesmo idioma não enfileira; fallback grava `fallback = true`; falha dupla grava `failed`; RLS entre workspaces; apagar a sala apaga as traduções.
- **SQL:** suíte da tabela e das políticas.
- **e2e** (`e2e/inbox.spec.ts`): ligar a tradução com o motor falso, receber mensagem em espanhol, ver o texto em português e alternar "Ver original".

## IN5a — Notas privadas

### Contexto

- As notas internas estão no plano do Inbox desde a IN5 ([plano](plano.md)): no Supabase, por `room_id`, nunca na sala, porque o contato é membro e veria qualquer evento colocado lá.
- A caixa de mensagem da IN4c (`composer.tsx`) segue o padrão do chat dos agentes de IA: campo em cima, barra embaixo com as ferramentas à esquerda e "Enviar" à direita.
- O cabeçalho primário já tem "+ Novo › Nova nota", desligado com "em breve".
- Só quem tem a função Atendente responde; Dono e Admin que não são atendentes só leem e atribuem (IN4a).

### Objetivo

O atendente usa a mesma caixa para responder ao contato ou para escrever uma nota que só a equipe vê, alternando entre as duas no topo da caixa. As notas aparecem na conversa, no meio das mensagens, com um visual que não deixa dúvida de que o contato não as vê.

### Requisitos

1. **Alternância na caixa de mensagem**, como na referência do Marcelo, montada com os componentes modelo (ADR 0021):
   - uma moldura `surface-inset` com cantos `rounded-card` em volta da caixa (card-in-card);
   - no topo da moldura, as abas **Responder | Nota privada** (`Tabs` do shadcn na variante `line`, a ativa em destaque) e, à direita, o ícone de IA (✦), desligado com "em breve" (ele recebe a prévia da tradução na TR3);
   - dentro, a caixa da IN4c como está: campo, barra com anexo, emoji e mais (em breve) e o botão à direita.
2. **No modo Nota privada:**
   - o campo e a moldura ficam em tom âmbar (token novo `surface-note`, claro e escuro), o texto de ajuda muda para "Escreva uma nota para a equipe. O contato não vê." e o botão vira **Adicionar nota**;
   - Enter envia e Shift+Enter quebra a linha, como na resposta;
   - o rascunho de cada modo é separado: trocar de aba não perde o texto do outro;
   - o modo volta para Responder ao trocar de conversa.
3. **"+ Novo › Nova nota"** passa a ligado: abre a conversa aberta já no modo Nota privada.
4. **Tabela `inbox_notes`:** `id`, `workspace_id`, `room_id`, autor (`user_id`), texto (até 4.000 caracteres), `created_at`, `edited_at`, `deleted_at`.
   - Leem: todos com `inbox.view` no workspace (inclusive Dono e Admin só leitura).
   - Escrevem: quem tem o nível `reply` (atendente).
   - O autor edita e apaga a própria nota (apagar é suave, a linha fica com "Nota apagada").
   - Apagar a conversa ou o workspace apaga as notas.
   - Auditoria: `inbox.note.create`, `inbox.note.update`, `inbox.note.delete`, sem o texto.
5. **Na conversa:** a nota entra na linha do tempo pela data, como um balão âmbar com ícone de cadeado, o nome do autor e "Nota privada". O menu da nota tem Editar e Apagar para o autor.
6. **Painel de contexto:** uma seção **Notas** no acordeon da aba Contato, fechada de início, com a contagem e a lista das notas da conversa (a mais nova em cima); clicar leva até a nota na conversa.
7. **Quem só lê** (Dono ou Admin sem a função Atendente) vê as notas, mas a caixa continua bloqueada como hoje.
8. **Serviço do servidor** para criar, editar e apagar, com a mesma checagem de permissão, pronto para virar rota de API (tomada da seção 5.1 das prioridades).

### Lógica

- **Migration:** `inbox_notes` com RLS (`private.inbox_my_level()` para escrever), índice por (`room_id`, `created_at`), cascata pela sala.
- **Servidor:** `src/modules/inbox/server/notes.ts` e as ações; a lista vem junto com a conversa e é atualizada depois de cada ação.
- **Interface:** `composer.tsx` ganha o modo (`reply` | `note`); `conversation-view.tsx` mistura mensagens e notas pela data; `notes-section.tsx` novo no painel.
- **Textos** em `inbox.json` nos três idiomas.

### Testes

- **Unitário:** a mistura de mensagens e notas pela data.
- **Integração** (`tests/core/inbox-notes.test.ts`): atendente cria, edita e apaga a própria nota; não edita a de outro; quem só lê não cria; RLS entre workspaces; a nota nunca vai para a sala (o Synapse falso não recebe evento).
- **SQL:** suíte da tabela e das políticas.
- **e2e** (`e2e/inbox.spec.ts`): alternar para Nota privada, adicionar, ver o balão âmbar na conversa e na seção Notas, voltar para Responder com o rascunho guardado; Admin só leitura vê a nota e não escreve.

## Aceite das duas

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, suítes SQL e o e2e do Inbox verdes.
- Capturas em claro, escuro e celular da caixa nos dois modos e de uma mensagem traduzida.
- Documentação: `traducao.md` (o que ficou da TR2), `contexto-inbox.md` (notas), situação nas prioridades.

## Perguntas

Cada uma tem uma sugestão. Responder "todas como sugerido" vale.

1. ~~**Quem escreve nota?**~~ **Respondida (21/10/2026):** só o atendente. Sugestão era: só quem tem a função Atendente, como na resposta; Dono e Admin só leitura veem as notas. Alternativa: todos com acesso ao Inbox escrevem nota, mesmo sem responder ao contato. A alternativa ajuda o gerente a deixar orientação ao atendente, mas abre uma exceção na regra da IN4a.
2. ~~**Editar e apagar nota?**~~ **Respondida (21/10/2026):** o autor edita e apaga; cada ação fica na auditoria (quem, quando, qual nota, sem o texto). Sugestão era: o autor edita e apaga a própria nota, e a linha do tempo mostra "editada" e "Nota apagada". Alternativa: nota não muda depois de escrita, como um registro.
3. ~~**Menção a um colega na nota**~~ **Respondida (21/10/2026):** sim, na SB1 (anotado nas prioridades). Sugestão era: deixar para a SB1, que traz a regra do @ num roteador único. Na IN5a a nota é só texto.
4. ~~**Tradução das respostas do GUIDS para a equipe**~~ **Respondida (21/10/2026):** sim, traduz também. Sugestão era: sim, pelo mesmo job, como diz a seção 5.3 de [tradução](traducao.md).
5. ~~**Idioma da equipe**~~ **Respondida (21/10/2026):** o idioma do workspace. Sugestão era: usar o idioma padrão do workspace, sem campo novo, e mostrar só leitura no bloco Tradução com o link para Geral e região.
