# Tradução do chat em tempo real

- **Status:** TR1 (idioma do contato), TR2 (tradução das mensagens que chegam) e TR3 (resposta da equipe com prévia traduzida) implementadas; TR4 a TR6 são proposta. O que ficou da TR2 está na [seção 12](#12-como-ficou-a-tr2) e da TR3 na [seção 13](#13-como-ficou-a-tr3).
- **Data:** 19/10/2026
- **Origem:** conversa de Marcelo com o Claude em 19/10/2026, para o piloto de Búzios, focado em turismo.
- **Decisões do Marcelo (19/10/2026):**
  - a tradução usa a **chave do cliente**;
  - nas configurações do chat há a opção **"Ativar tradução do chat em tempo real"**;
  - ao ativar, o cliente escolhe o **modelo de IA** ou o **Google Translate**, informando as credenciais do Google se ainda não estiverem cadastradas;
  - o **Google Translate entra como fallback**, na versão **Basic** (v2, só com chave de API);
  - **um idioma por workspace** para a equipe;
  - idiomas do piloto: **português, inglês e espanhol**;
  - **sem limite nosso** de tradução: vale o limite da chave do cliente;
  - prioridade **P1** ([prioridades](../../architecture/prioridades-agentes-e-inbox.md)).
- **Relaciona-se com:** [ADR 0013](../../adr/0013-idiomas-do-painel.md) (idiomas do painel), [ADR 0017](../../adr/0017-sdk-dos-agentes-de-ia.md) (motor), [ADR 0023](../../adr/0023-chat-interno-como-cliente-matrix.md) (Inbox na Matrix), [plano de idiomas](../../operacao/plano-i18n.md) (I6), [agentes na Matrix](../../architecture/agentes-na-matrix-e-compra-agentica.md).

## 1. O que resolve

O turista escreve em espanhol, pelo texto ou por áudio. O comerciante lê em português e responde em português, e o turista recebe a resposta em espanhol.

## 2. O que já existe

- **I6:** tradução automática dos textos do painel e dos termos com Claude (`src/core/i18n/machine/`), com a chave da plataforma (`TRANSLATION_ANTHROPIC_API_KEY`) e o modelo grande. Ela serve de referência para o prompt e o schema, mas **não é reaproveitada como está**: usa a nossa chave e é lenta demais para conversa.
- **A5c:** transcrição de áudio com o modelo de fala do provedor da chave do cliente (OpenAI e Gemini).
- **Chaves de IA do cliente:** no cofre do workspace (`src/core/ai/keys.ts`), cifradas e mostradas mascaradas.
- **Painel em pt-BR, en e es** (ADR 0013, next-intl).
- **Configurações do Inbox:** Configurações › Módulos › Inbox, em `workspace_modules.config` (lê `inbox.view`, grava `inbox.manage`).

## 3. Configuração

Em **Configurações › Módulos › Inbox**, um bloco **Tradução**:

1. **Ativar tradução do chat em tempo real** (desligado por padrão).
2. **Motor principal:**
   - **Modelo de IA (sua chave):** o cliente escolhe uma das chaves de IA do cofre do workspace e o modelo. A tela sugere um modelo rápido e barato do provedor.
   - **Google Translate:** se não houver credencial cadastrada, a tela pede a **chave de API do Google Cloud Translation**, que vai para o cofre do workspace, cifrada e mostrada mascarada, com "Testar" como nas chaves de IA.
3. **Fallback:** o outro motor, opcional. Com os dois configurados, a combinação recomendada é **modelo de IA como principal e Google Translate como fallback**.
4. **Idioma da equipe:** um por workspace, o padrão do workspace (`workspaces.default_locale`). Decisão de 19/10/2026.
5. **Glossário:** termos que não são traduzidos (Geribá, Ferradura, Rua das Pedras, nome da loja e dos produtos) e termos com tradução fixa.

Sem nenhum motor válido, o interruptor não liga. Se a chave falhar depois de ligado, a tela e o Inbox avisam, como no backup da A2c.

## 4. Idioma do contato

| Origem          | Como detectar                                                             |
| --------------- | ------------------------------------------------------------------------- |
| guidu.chat      | Idioma do navegador (`navigator.language`), salvo no perfil do consumidor |
| WhatsApp, texto | Detecção pelo texto da primeira mensagem com conteúdo suficiente          |
| Áudio           | O modelo de transcrição devolve o idioma                                  |

- Fica gravado no contato e no espelho da sala: `contact_locale`, `locale_source` (navegador, detectado ou manual) e `locale_confidence`.
- **Detecção:** uma biblioteca leve (como `franc`) no caso comum, com confirmação pelo motor quando houver dúvida. O Google Translate também detecta o idioma na própria chamada.
- Mensagens curtas ("ok", "gracias", emoji) não mudam o idioma já detectado.
- O atendente pode corrigir no painel, e o consumidor pode pedir outro idioma.

## 5. Fluxo

### 5.1 Mensagem do lead (espanhol → português)

1. A mensagem chega na sala de atendimento como foi escrita. O áudio é transcrito antes (A5c).
2. Se o idioma for diferente do da equipe, um job traduz para o idioma da equipe.
3. A tradução vai para o **Supabase**, ligada ao `event_id`, **nunca para a sala**: o lead é membro e veria qualquer evento colocado lá.
4. O Inbox mostra o texto em português com "ver original" e uma indicação do idioma do contato.

### 5.2 Resposta da equipe (português → espanhol)

1. O atendente escreve em português.
2. Antes de enviar, vê a **prévia da tradução**, que pode editar. Também pode "enviar sem traduzir".
3. A sala recebe só a versão em espanhol. O original em português fica no Supabase, ligado ao `event_id`.
4. Se o texto já estiver no idioma do contato, nada é traduzido.

### 5.3 GUIDS

- O GUIDS responde direto no idioma do contato. O prompt recebe `{{idioma_do_contato}}`, sem passar pela tradução.
- Para a equipe, as respostas do GUIDS também aparecem traduzidas para o português, pelo mesmo job.
- Com a tradução desligada, o GUIDS continua respondendo no idioma do contato, e a equipe vê o original.

### 5.4 Fallback

| Situação                                                | O que acontece                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Motor principal responde                                | Tradução gravada com o motor usado                                                 |
| Erro, recusa, cota esgotada ou mais de 4 s sem resposta | Tenta o fallback, se configurado, e grava `fallback = true`                        |
| Os dois falham, mensagem do lead                        | Mostra o original com o aviso "tradução indisponível" e tenta de novo depois       |
| Os dois falham, resposta da equipe                      | Não envia sozinho: o atendente tenta de novo, edita a prévia ou envia sem traduzir |

O painel mostra, em cada mensagem traduzida, o motor usado.

## 6. Motores

|                       | **Modelo de IA (chave do cliente)**                                                  | **Google Translate (chave do cliente)**                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qualidade em conversa | Melhor: usa as últimas mensagens como contexto, mantém o tom, entende gíria          | Boa em frases diretas e mais literal                                                                                                                                                                             |
| Glossário             | Entra no prompt                                                                      | Basic (v2, chave de API): sem glossário; termos protegidos marcados como não traduzíveis no formato HTML, a confirmar na prova. Advanced (v3) tem glossário, mas pede projeto e conta de serviço do Google Cloud |
| Latência              | Boa com modelo rápido                                                                | Muito baixa                                                                                                                                                                                                      |
| Custo                 | Por tokens, no provedor do cliente                                                   | Por caractere, na conta Google do cliente                                                                                                                                                                        |
| Onde roda             | **Pelo motor** (`src/core/ai/`, ADR 0017), que é quem usa as chaves de IA do cliente | Adaptador novo do núcleo, com a guarda de chamadas externas dos canais                                                                                                                                           |

**Recomendação para o piloto:** modelo de IA como principal, por causa do contexto e do glossário, e Google Translate (Basic, só com chave de API) como fallback.

## 7. Conteúdo que sai pronto

- **Portfólio, respostas rápidas e horário da loja:** versões em espanhol e inglês, traduzidas em lote com o motor configurado e revisadas pelo comerciante antes de usar.
- **Templates da Meta:** fora da janela de 24 h só vale template aprovado, e a aprovação é **por idioma**. Cada template precisa da versão aprovada em espanhol e inglês.
- **Interface do guidu.chat:** no idioma do navegador, com next-intl.

## 8. Dados

| Onde                                  | O quê                                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `inbox_message_translations` (nova)   | `workspace_id`, `room_id`, `event_id`, direção (entrada ou saída), idioma de origem e de destino, texto, motor, modelo, `fallback`, data |
| Contato e espelho da sala             | `contact_locale`, `locale_source`, `locale_confidence`                                                                                   |
| `workspace_modules.config` do `inbox` | Ativado, motor principal, fallback, idioma da equipe, glossário (sem segredos)                                                           |
| Cofre do workspace                    | Chave do Google Translate, cifrada; as chaves de IA continuam onde estão                                                                 |

Políticas iguais às do Inbox: quem tem `inbox.view` lê, e só o worker grava. Apagar a conversa ou o workspace apaga as traduções.

## 9. Segurança e privacidade

1. **Nada na sala do lead** além da mensagem no idioma dele (ADR 0023, regra 6).
2. **Ninguém envia sem ver:** a prévia é obrigatória para a resposta traduzida da equipe.
3. **O texto traduzido é dado.** Uma instrução escrita pelo lead ("ignore as instruções…") não muda nada no tradutor nem no GUIDS.
4. **Privacidade:** as mensagens passam pelo provedor escolhido pelo cliente, com a chave dele. A política de privacidade e os termos do cliente precisam informar isso.
5. **Credenciais:** a chave do Google fica no cofre, nunca em log, prompt, auditoria ou tela sem máscara. Gravar exige `inbox.manage`.
6. **Custo:** sem limite nosso (decisão de 19/10/2026). Vale o limite da chave do cliente no provedor; quando a chave recusa por cota, entra o fallback e o Inbox avisa.

## 10. Etapas

| Etapa   | Entrega                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **TR1** | Idioma do contato: detecção, gravação e indicação no Inbox                                                                                     |
| **TR2** | Configuração (interruptor, motor principal, fallback, credencial do Google, glossário) e tradução das mensagens que chegam, com "ver original" |
| **TR3** | Resposta da equipe com prévia traduzida e fallback                                                                                             |
| **TR4** | Áudio: transcrição e tradução                                                                                                                  |
| **TR5** | Portfólio, respostas rápidas e horário em es e en                                                                                              |
| **TR6** | Templates da Meta em es e en                                                                                                                   |

Com TR1 a TR3, o piloto de Búzios já funciona com texto.

## 11. Perguntas

1. ~~O idioma da equipe é por workspace ou por pessoa?~~ **Respondida (19/10/2026):** por workspace.
2. ~~Quais idiomas no piloto?~~ **Respondida (19/10/2026):** português, inglês e espanhol.
3. ~~Limite diário de tradução?~~ **Respondida (19/10/2026):** sem limite nosso; vale o da chave do cliente.
4. ~~Google Translate Basic ou Advanced?~~ **Respondida (19/10/2026):** Basic (v2, chave de API).

## 12. Como ficou a TR2

Implementada em 21/10/2026 ([plano](plano-tr2-in5a.md), migration `20261221090000_tr2_inbox_translation`).

### Configuração

- Bloco **Tradução** em Configurações › Módulos › Inbox, abaixo do GUIDS (`translation-settings-form.tsx`). Grava `inbox.manage` em `workspace_modules.config.translation`: `enabled`, `primary` e `fallback` (`ai` ou `google`), `ai.credential_id` e `ai.model`, e `glossary` (até 200 linhas). Nenhum segredo vai para a configuração.
- **Motor de IA:** uma chave de IA ativa do cofre e o modelo do catálogo da plataforma (CF6a). A tela sugere o modelo rápido e barato do provedor (nano, flash-lite, haiku, mini).
- **Google Translate:** a chave fica no cofre do workspace como `credentials.provider = 'google_translate'`, cifrada e mostrada mascarada. Uma chave nova revoga a anterior. **Testar** traduz uma frase curta com o motor escolhido.
- O interruptor só liga com o motor principal pronto; o servidor confere de novo (chave ativa, modelo da lista, chave do Google cadastrada) e recusa um fallback que não está pronto.
- **Idioma da equipe:** o padrão do workspace (`workspaces.default_locale`, reduzido a pt-BR, en ou es), só leitura, com o link para Geral e região.
- **Glossário:** uma linha por termo. "Geribá" não é traduzido; "check-in = entrada" usa a tradução fixa.

### Fluxo

1. O processamento do evento (`src/core/matrix/events.ts`) chama `private.inbox_translation_enqueue(room_id, event_id, idioma detectado)` para cada texto do contato ou do GUIDS. A função decide no banco: Inbox ligado, tradução ligada, sala e workspace ativos, idioma da mensagem (o detectado pela TR1, senão o do contato) diferente do da equipe. Então grava a linha `pending` e o job `inbox.translate-message` com **só** `roomId` e `eventId`, como a pessoa que salvou as configurações do Inbox (como o turno do GUIDS, IN6).
2. O job (`src/modules/inbox/server/translate-job.ts`, destacado, três tentativas, um por sala de cada vez) lê o evento no Synapse como o núcleo. Mensagem curta ("ok", emoji: menos de duas palavras ou seis letras), no idioma da equipe ou que não é do contato nem do GUIDS não é traduzida, e a linha `pending` sai.
3. O motor de IA recebe as seis mensagens anteriores como contexto e o glossário nas instruções, com o texto delimitado como dado (seção 9.3). É uma chamada simples ao modelo pelo motor (`generateStructured`), sem agente e sem ferramentas. O Google Basic recebe o texto no formato HTML com os termos do glossário em `<span translate="no">`, pela guarda das chamadas externas (`providerJson`/`pinnedFetch`), com a chave no cabeçalho `x-goog-api-key`.
4. Erro, recusa, cota (429), chave recusada (400/401/403) ou mais de 4 s levam ao fallback e gravam `fallback = true` e `primary_error`. Com os dois falhando, grava `failed` e o job tenta de novo (três tentativas).
5. O resultado só entra por `private.inbox_translation_record`, que exige a execução `running` daquele evento, pedida pela pessoa do contexto: o web não grava tradução.

### Dados

- `inbox_message_translations`: `workspace_id`, `room_id`, `event_id`, `direction` (`inbound`; `outbound` fica para a TR3), `source_locale`, `target_locale`, `status` (`pending`, `done`, `failed`), `translated_text`, `engine`, `model`, `fallback`, `primary_error`, `attempts`, datas. Única por (`event_id`, `target_locale`).
- RLS: lê quem tem nível no Inbox do workspace (`inbox_my_level()`); escreve só o worker. Apagar a sala ou o workspace apaga as traduções (cascata e a lista de purga da WS1).

### No Inbox

- A conversa pede as traduções das mensagens visíveis (`loadMessageTranslationsAction`) ao abrir, quando chega mensagem nova (e de novo depois de alguns segundos, enquanto o núcleo processa) e a cada 3 s enquanto alguma está `pending`.
- Mensagem traduzida: o texto no idioma da equipe e, embaixo, "Traduzido de espanhol · Modelo de IA" (ou "Google Translate", com "fallback" quando foi o caso) e **Ver original**, que alterna no lugar. Enquanto traduz: o original com "Traduzindo…". Com falha (ou `pending` há mais de 3 minutos): o original com "Tradução indisponível".
- **Avisos:** com a tradução ligada, se a tradução mais recente das últimas 24 horas falhou, ou o motor principal recusou a chave ou a cota, a tela de Configurações e a conversa no Inbox mostram o aviso com o motivo.

### Desvios do plano

- A tabela tem a situação `pending` além de `done` e `failed`, e a coluna `primary_error`: a tela distingue "Traduzindo…" de mensagem sem tradução, e os avisos saem dos próprios dados, sem estado novo.
- O job roda como a pessoa que salvou as configurações do Inbox (`workspace_modules.updated_by`), pelo mesmo caminho do GUIDS; a gravação passa por uma função que exige a execução do job, o que mantém "só o worker grava".
- Sem nenhum motor pronto (chaves revogadas depois de ligar), a mensagem fica `failed` com `primary_error = 'key'`.
- e2e com o dublê do Google Translate do rig (`e2e/support/fake-translate.ts`, porta 54395 mais o deslocamento, `GOOGLE_TRANSLATE_API_BASE`).

## 13. Como ficou a TR3

Implementada em 21/10/2026 ([plano](../../architecture/plano-tr3-gf2.md), migration `20261223090000_tr3_inbox_outbound_translation`).

### Fluxo

1. **Quando traduz** (`src/core/translation/outbound.ts`, `decideOutbound`, a mesma regra na janela e no servidor): tradução ligada, idioma do contato conhecido e diferente do da equipe, modo **Responder**. Nota privada nunca. Texto sem letras (emoji, número) não é traduzido. Rascunho que o detector da TR1 reconhece **com confiança** no idioma do contato segue direto, sem prévia; o ✦ pede a prévia mesmo assim.
2. **Prévia:** ao clicar em Enviar (ou Enter), a caixa dá lugar à prévia no idioma do contato (`outbound-preview.tsx`), editável, com **Enviar em espanhol**, **Enviar sem traduzir** e **Voltar** (mantém o rascunho). O ✦ (agora ligado, com a dica "Ver a prévia em espanhol") gera a prévia sem enviar. Nada vai para a sala nesse momento.
3. **Tradução no servidor** (`previewOutboundTranslationAction` → `previewOutboundTranslation`, `src/modules/inbox/server/outbound-translation.ts`): exige nível `reply` e Inbox operacional, lê a sala, as configurações e o glossário, e traduz fora da transação com os motores da TR2 (`translateOutbound` em `run.ts`: motor principal, 4 s, fallback, `fallback = true`). O texto da equipe entra delimitado como dado, com a mesma neutralização de `<` e `>` da TR2. Não grava nada, não envia nada e não lê o Synapse.
4. **Os dois motores falham:** a prévia mostra "Tradução indisponível" com **Tentar de novo**, **Enviar sem traduzir** e **Voltar**; nada é enviado sozinho.
5. **Registro da saída:** o envio continua pelo `matrix-js-sdk` no navegador. Com o `event_id` aceito pelo Synapse, o navegador chama `recordOutboundTranslationAction`. O servidor lê o evento no Synapse como o núcleo, confere que o remetente é a conta Matrix de quem chamou e que o corpo é exatamente o texto enviado (recusa com `conflict` se não for, ou se o evento não existir ou não for `m.text`), e só então chama `private.inbox_translation_record_outbound`, que exige nível `reply`, a sala ativa no contexto e o `event_id` ainda sem registro. A linha `outbound` guarda `source_text` (original), `translated_text` (o enviado), idiomas, motor, modelo, `fallback` e `edited`. Uma auditoria `inbox.translation.outbound` registra idiomas, motor e se foi editada, sem o texto. Se o registro falhar duas vezes, o aviso diz que a mensagem foi enviada mas o original não foi guardado.
6. **Para a equipe** (`message-translation.tsx`): a mensagem mostra o original em português e, embaixo, "Enviado em espanhol · Modelo de IA" (ou "Google Translate", com "fallback" e "editada" quando for o caso) e **Ver enviado**, que alterna para o texto que o contato recebeu (e de volta com **Ver original**). `loadMessageTranslationsAction` passou a devolver também as linhas `outbound`. O consumidor só vê a mensagem no idioma dele.
7. **Job da TR2:** não mudou; mensagens da equipe continuam fora da tradução de entrada, e o aviso de falha de motor só olha linhas `inbound`.

### Dados

- `inbox_message_translations`: colunas `source_text` (só `outbound`) e `edited`, com constraints (só `outbound` tem original; só `outbound` pode ser `edited`). Numa linha `outbound`, `source_locale` é o idioma da equipe e `target_locale` o do contato. As policies não mudaram: lê quem tem nível no Inbox; o web não tem insert, update nem delete direto, só a função acima.
- Interface: a página do Inbox lê `translation.enabled` e passa `translationEnabled` à janela; o servidor repete a decisão a cada prévia, então uma configuração que mudou depois não vale.

### Desvios do plano

- **Glossário ao contrário:** as linhas do glossário são escritas para o idioma da equipe ("check-in = entrada"). Na saída o termo fixo é lido de trás para frente (`outboundGlossary`): o que a equipe escreve ("entrada") vira o termo do contato ("check-in"); os termos mantidos como estão ficam como estão. O plano não dizia; é a leitura que faz o glossário valer nos dois sentidos.
- **Sem contexto na prévia:** o motor de IA recebe só o texto da equipe, sem as mensagens anteriores (a TR2 manda seis). Evita uma leitura do Synapse a cada prévia; pode entrar depois.
- **Uso de IA:** a prévia conta como as traduções da TR2, isto é, usa a chave do cliente e o uso fica no provedor dele. Não há contador próprio no GUIDU para a tradução (a TR2 também não tem); nada novo foi criado.
- **Metadados do registro (motor, modelo, `fallback`, `edited`) vêm do navegador:** o servidor confere remetente e corpo no Synapse, mas não consegue provar qual motor produziu o texto nem se foi editado. Quem grava é só quem tem nível `reply` e só na própria mensagem, e o motor é limitado a `ai` ou `google` por constraint.
- **Idioma "já no do contato":** só o detector com confiança (`detectContactLocale`, confiança mínima 0,6) dispensa a prévia; texto curto ou ambíguo é traduzido.
- **Mensagem só de emoji ou número** segue direto, sem prévia.

### Testes

- Unitário (`src/core/translation/outbound.test.ts`): a regra de quando traduzir, a tradução direta com fallback, o tempo do motor principal, os dois motores falhando e o glossário ao contrário.
- Integração (`tests/core/inbox-outbound-translation.test.ts`): a prévia não grava linha, job nem pedido ao Synapse; fallback e falha dupla; envio direto; quem só lê e outro workspace são recusados; o registro grava o original e recusa remetente, corpo, tipo e evento diferentes; segundo registro do mesmo evento não grava; RLS; apagar a sala apaga as linhas. SQL (`tests/core/inbox-outbound-translation-rls.sql`): a função (permitido e negado), as constraints e os privilégios.
- e2e (`e2e/inbox.spec.ts`, dublê do Google Translate): contato em espanhol, atendente escreve em português, vê a prévia, volta, edita e envia; o consumidor recebe em espanhol; a equipe vê o português com "Ver enviado" e "editada"; "Enviar sem traduzir" manda o original.
- Integração, SQL e e2e rodam no CI (esta máquina não tem Postgres, Redis nem Synapse).
