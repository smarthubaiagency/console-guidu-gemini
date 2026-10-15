# Plano da A5: canais e Chatwoot

Marcelo deu o "podemos prosseguir" em 13/10/2026, depois do merge da A4b (PR #69). A base é a ADR 0011 (`docs/adr/0011-camada-de-canais-no-nucleo.md`) (camada de canais no núcleo), `docs/modules/ai-agents/canais.md` e o que a A1 a A4 deixaram na `main`.

**Objetivo:** o GUIDS atende de verdade numa inbox do Chatwoot, pelo Agent Bot, e substitui o n8n inbox por inbox.

## O que já existe

- O motor do turno do GUIDS (A2b), com ferramentas reais, backup da chave (A2c) e plano de resposta (`messages` já divididas pelo modelo).
- A conversa de teste com ferramentas simuladas (A4b). As ferramentas reais (contato, nota, pontuação, transferência) estão prontas e testadas, mas ainda sem canal que as use.
- Nada da camada de canais: não há `src/core/channels`, tabelas de canal, permissão `channels.manage` nem webhook de entrada.

## Como dividir

Três PRs, cada uma com o seu "pode começar" depois da primeira:

| Parte   | Entrega                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A5a** | **Núcleo de canais e conexão Chatwoot.** Tabelas do núcleo (conexões, rotas, conversas externas, eventos de entrada, entregas) com RLS; permissão `channels.manage`; segredos da conexão no cofre; contrato do adaptador versionado; adaptador Chatwoot (verificação, normalização, envio, transferência, saúde) com a suíte de conformidade; webhook público por conexão que só verifica, grava o evento com id externo único e enfileira; tela **Configurações › Canais** no `/app` para cadastrar e testar a conexão Chatwoot e ver as inboxes. Ainda sem consumidor: eventos sem rota ficam gravados e aparecem na saúde da conexão. |
| **A5b** | **GUIDS atendendo no Chatwoot.** Vínculo agente × inbox (cria a rota do núcleo na mesma transação; uma inbox, um agente ativo); despacho do evento para o módulo no worker, com concorrência 1 por conversa e janela de agrupamento; turno com ferramentas reais e conversa ligada ao contato do CRM; entrega pelo núcleo em ordem, com idempotência por parte; transferência muda o status no Chatwoot para aberto; o status do Chatwoot manda no estado da conversa. Na gaveta do GUIDS, a aba **Canais** para ligar o agente a uma inbox (só GUIDS testado e ativo).                                                                  |
| **A5c** | **Acabamento do canal.** Intervalo e indicador de digitação, áudio recebido (transcrição) se Marcelo quiser já nesta etapa, painel de saúde da conexão (eventos sem rota, falhas de entrega) e o roteiro de migração do n8n inbox por inbox.                                                                                                                                                                                                                                                                                                                                                                                             |

## Decisões técnicas (minhas, ajustáveis)

- **Autenticação do webhook do Agent Bot:** o Chatwoot não assina o webhook do Agent Bot em todas as versões. A URL leva um token secreto por conexão (32 bytes), guardado só como hash, comparado em tempo constante; corpo limitado a 1 MB; eventos repetidos descartados pelo id da mensagem.
- **Segredos:** o token de acesso do bot vai para o cofre do workspace, cifrado como as chaves de IA; a tela mostra só o final mascarado.
- **Mensagens que não disparam o agente:** de atendentes, do próprio bot, privadas (notas internas) e de conversas que não estão pendentes no Chatwoot. Ficam no histórico como contexto.
- **Escopo da rota:** a inbox do Chatwoot.

## Perguntas ao Marcelo (respostas entram na A5b)

1. **Janela de agrupamento:** quanto esperar mensagens seguidas do contato antes de responder? Recomendo 5 segundos como padrão, ajustável no vínculo.
2. **Nova mensagem durante a entrega (D-AG-08):** recomendo terminar de entregar o que já saiu e responder a nova mensagem no turno seguinte.
3. **Volta para o bot depois da transferência (D-AG-09):** recomendo voltar só quando a equipe devolve a conversa para "pendente" no Chatwoot.
4. **Tamanho das respostas:** recomendo no máximo 5 mensagens por turno e 1.000 caracteres por mensagem, com 1,5 segundo entre elas.
5. **Áudio:** recomendo deixar transcrição e resposta em áudio para a A5c, depois do texto funcionando.

## Regras que valem para as três

- Webhook nunca chama o consumidor: grava e enfileira (ADR 0002 e 0011).
- O módulo nunca vê o payload bruto nem o segredo da conexão.
- Auditoria de conexão, rota e transferência, sem segredos.
- Continua atrás da flag `GUIDU_MODULE_AI_AGENTS_ENABLED` no que é do módulo; o núcleo de canais não depende da flag.

## Testes

- Suíte de conformidade do adaptador (assinatura/token, idempotência, normalização, renderização dentro dos limites).
- SQL de RLS das tabelas novas, integração dos serviços e e2e das telas.
- Aceite local completo em cada parte.

## Como ficou a A5a (13/10/2026)

- **Migration:** `20261105090000_a5a_channels_core.sql`, com `channel_connections`, `channel_routes` (uma rota ativa por conexão e inbox, índice único), `channel_conversations` e `channel_inbound_events` (id externo único por conexão). O webhook entra no banco só por duas funções `security definer`.
- **Permissões:** `channels.read` (owner, admin, editor) e `channels.manage` (owner, admin).
- **Tela:** Configurações › Canais no `/app`. Conectar o Chatwoot pede endereço, número da conta e token de acesso de um administrador. O GUIDU cria o Agent Bot da conta com a URL do webhook, verifica conta e bot e lista as inboxes. Cada conexão mostra a saúde, as inboxes, o último evento e quantos eventos chegaram sem agente; owner e admin verificam e removem (a remoção tira o bot do Chatwoot).
- **Webhook:** token de 32 bytes na URL, guardado só como SHA-256 (a comparação é do hash, então não há vazamento por tempo); corpo até 1 MB; 404 igual para conexão desconhecida, desativada ou token errado; evento repetido não grava de novo.
- **Mudou em relação ao plano:** a tabela de entregas, o envio e a transferência no adaptador ficaram para a A5b, junto do primeiro consumidor que os usa. O webhook não enfileira nada ainda: sem consumidor, os eventos ficam `no_route`.
- **Fica anotado:** a guarda contra endereços internos confere o DNS antes da chamada, mas não fixa o IP resolvido (resta a janela de DNS rebinding). Para fechar, a A5c pode usar um agente HTTP que conecta só no IP conferido.

## Respostas do Marcelo para a A5b (13/10/2026)

1. Janela de agrupamento de 5 segundos: ok.
2. Mensagem nova durante a entrega: termina a entrega e responde no turno seguinte: ok.
3. Volta para o bot quando a equipe devolve a conversa para "pendente" no Chatwoot: ok. Pedido: essas regras ficam nas configurações da integração (a conexão Chatwoot em Configurações › Canais), com padrão e ajuste por inbox.
4. No máximo 3 mensagens por turno, com textos curtos (proposta: até 300 caracteres cada), 1,5 segundo entre elas.
5. Áudio fica para a A5c.

O Chatwoot é uma integração do núcleo (ADR 0011), não um módulo: a conexão fica em Configurações › Canais e qualquer módulo consumidor (GUIDS hoje, chat interno depois) usa a mesma conexão.

## Como ficou a A5b (13/10/2026)

- **Migration:** `20261106090000_a5b_channel_dispatch.sql`, com `channel_deliveries` (uma linha por execução e parte), a coluna `ai_conversations.channel_conversation_id` (uma conversa aberta do agente por conversa do canal), o canal `chatwoot` nas conversas do agente e a ingestão agendando o job `channels.dispatch`.
- **Tela da integração:** em Configurações › Canais, cada conexão Chatwoot tem "Atendimento": agrupamento (5 s), máximo de mensagens (3), caracteres por mensagem (300) e intervalo (1,5 s), no padrão da conexão ou ajustados por inbox.
- **Tela do GUIDS:** aba Canais na gaveta, com cada inbox livre, deste agente ou de outro; ligar exige o GUIDS ativo e testado na configuração atual e põe o Agent Bot na inbox.
- **Fluxo:** a janela de agrupamento se prorroga a cada mensagem, até 30 s desde a primeira; uma conversa responde de cada vez; mensagem nova durante a entrega vai para o turno seguinte; transferência põe a conversa em "open" e o bot volta quando a equipe a devolve para "pending".
- **Mudou em relação ao plano:** o limite de caracteres é orientação ao modelo (o núcleo só corta no limite do canal); as mensagens além do máximo vão juntas na última.
- **Fica anotado:** GUIDS pausado deixa a inbox sem resposta (eventos `failed`); mensagens da equipe ainda fora do histórico do agente; job que falha não pergunta de novo ao agente; janela de DNS rebinding da A5a continua.

## Respostas do Marcelo para a A5c (13/10/2026)

1. Áudio, imagem e documento recebidos usam a chave do cliente. Se a chave/modelo não tem a capacidade, o contato é avisado para escrever em texto e o cliente é informado de que o agente terá capacidade menor com essa chave.
2. O GUIDS deve suportar áudio, imagens e documentos (entrada e saída, incluindo resposta em áudio).
3. Mensagens da equipe entram no histórico do agente.
4. A transferência para humano deve deixar um resumo como nota privada no Chatwoot.

Proposta enviada: A5c = entrada (transcrição, imagem, documento, avisos de capacidade, digitação, histórico da equipe, resumo em nota privada, painel de saúde, DNS); A5d = saída (voz, envio de imagens e documentos a partir de arquivos cadastrados no GUIDS, roteiro de migração do n8n). Aguardando confirmação. 5. (21:51) As imagens e os documentos que o agente envia vêm sempre do Portfólio do workspace; por enquanto é o único caso (A5d).

## Como ficou a A5c (13/10/2026)

- **Sem migration.**
- **Arquivos do contato:** com a chave do cliente, áudio é transcrito (OpenAI `gpt-4o-mini-transcribe`, Gemini `gemini-3.5-transcribe`), imagem e PDF vão ao modelo com a mensagem, texto e CSV são lidos por qualquer chave. Anthropic não ouve; OpenRouter não ouve nem lê PDF; vídeo nenhuma. O que a chave não lê vira nota e o agente pede para escrever em texto. Backup da plataforma só texto. Arquivos não são guardados; notas e transcrições ficam no histórico.
- **Avisos ao cliente:** tela de chaves mostra o que cada provedor não lê; aba Canais do GUIDS avisa quando a chave atual tem menos recursos.
- **Histórico:** mensagens públicas da equipe e do contato durante o atendimento humano entram antes da nova mensagem; notas internas e as do bot ficam fora.
- **Transferência:** a ferramenta pede resumo; vai como nota privada no Chatwoot antes de "aberta".
- **Digitação**, **saúde da conexão** (dono de cada inbox com aviso de pausado, atendimento de 7 dias) e **DNS fixado no socket**.
- **Fica para a A5d:** resposta em voz, envio de imagens e documentos do Portfólio, roteiro de migração do n8n.

## A5d: perguntas enviadas ao Marcelo (13/10/2026, após merge da A5c #72)

1. Quando responder em voz (regra na integração, padrão e por inbox): A espelhar áudio do contato (recomendado), B sempre, C desligado.
2. Voz com a chave do cliente (OpenAI e Gemini; Anthropic e OpenRouter só texto, com aviso); voz escolhida no GUIDS, com padrão.
3. Documentos do Portfólio: A link do item do tipo "documento" apontando para PDF (recomendado, sem upload), B upload de PDF no Portfólio (etapa à parte).
   Portfólio hoje: `media` (imagem, vídeo por URL https) e `links` (tipo, url, título); sem arquivos próprios.

## Respostas do Marcelo para a A5d (13/10/2026, 23:00)

1. Opção A: responde em voz quando o contato mandou áudio (regra na integração).
2. Chaves: ou campo de voz que só aparece quando a chave de texto não tem voz, ou 3 campos fixos (texto, voz, embeddings) com nota do uso de cada. Proposta enviada: 3 campos fixos; voz vem com "Usar a chave de texto" quando ela é OpenAI/Gemini, senão aviso e escolha de outra chave; a chave de voz também transcreve os áudios recebidos.
3. Pediu integração Google (Drive para documentos, Sheets para salvar contatos, Calendar), prevista como integração do núcleo. Proposta: etapa própria G1 Integração Google depois da A5d; na A5d documentos por link do item do Portfólio (pode ser PDF no Drive).
   "Pode começar" às 23:03.

## Como ficou a A5d (13/10/2026)

Sem migration. Detalhes em `docs/modules/ai-agents/ESTADO.md` (linha A5d).

- **Três chaves** na aba Conexão de modelo, com nota do uso: Texto, Voz (ouve e fala; "Usar a chave de texto" quando ela é OpenAI/Gemini, senão aviso e outra chave; lista de vozes do provedor com padrão) e Embeddings (guardada para o RAG). Serviço recusa voz sem fala, voz fora da lista e embeddings com chave só de chat. Só o cliente escolhe chaves.
- **Resposta em voz:** contato mandou áudio + `voice_reply` "espelhar" (padrão; "sempre em texto" desliga), em Configurações › Canais › Atendimento, padrão e por inbox. Uma mensagem de voz com a resposta inteira (Ogg Opus; Gemini WAV convertido por ffmpeg quando existe). Falhou, vai o texto. O GUIDS pode desligar em "Responder em áudio".
- **Enviar do Portfólio** (ferramenta nova): imagens do item e documentos (links tipo `document`, campo Documentos no item), até 3 por resposta, depois do texto. Links do Google Drive/Docs/Planilhas viram download; arquivo privado ou página vai como link.
- **Roteiro n8n:** `docs/modules/ai-agents/migracao-n8n.md`. **G1 prevista:** `docs/operacao/plano-g1.md` (decisões em aberto: dono do app OAuth no Google Cloud, ordem, colunas da planilha, regras da agenda).
- Limites: áudio e arquivo testados só com Chatwoot falso; voz e transcrição só com modelos simulados; produção precisa de ffmpeg no worker para a voz do Gemini.
