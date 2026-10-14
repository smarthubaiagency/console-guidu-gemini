# Migração do n8n para os GUIDS, inbox por inbox

Roteiro para trocar o atendimento feito por fluxos do n8n pelo GUIDS da GUIDU, uma inbox do Chatwoot de cada vez (A5d, 13/10/2026). Cada inbox muda sozinha: as outras continuam no n8n até a vez delas, e a volta atrás é desligar o GUIDS na inbox.

O roteiro é genérico: os fluxos do legado variam por cliente. Antes de cada inbox, confira o fluxo dela no n8n com a lista do passo 1.

## 1. Inventário do fluxo da inbox

Anote, no fluxo do n8n que atende a inbox:

| O que olhar no n8n                                   | Onde fica na GUIDU                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Prompt, persona, regras, produtos e serviços         | Editor do GUIDS (abas Visão geral, Escopo e Regras); o cliente sem personalização edita o negócio, o resto é do modelo |
| Chave e modelo do LLM                                | Aba Conexão de modelo › Texto (chave do cofre do workspace e modelo)                                                   |
| Transcrição (Whisper) e resposta em áudio (TTS)      | Aba Conexão de modelo › Voz (chave de voz, voz e "Responder em áudio") e Configurações › Canais › Resposta em áudio    |
| Espera para juntar mensagens (buffer, Wait, Redis)   | Configurações › Canais › Atendimento › Espera para juntar mensagens                                                    |
| Divisão da resposta em várias mensagens e intervalo  | Configurações › Canais › Atendimento (mensagens por resposta, caracteres e intervalo)                                  |
| Envio de fotos e PDFs                                | Portfólio: imagens do item e campo Documentos (links); ferramenta "Enviar do Portfólio" do GUIDS                       |
| Transferência para humano (status "open", etiquetas) | Ferramenta "Transferir para humano": nota privada com o resumo e conversa "open"; volta ao bot em "pending"            |
| Gravação de contato ou lead (CRM, planilha, webhook) | CRM da GUIDU (criar contato, nota, pontuação); planilha e agenda do Google ficam para a etapa G1 (prevista)            |
| Nós que chamam outros sistemas (HTTP Request, Code)  | Sem equivalente genérico: o GUIDS não tem ferramenta HTTP; anote e trate como pedido de nova ferramenta                |

## 2. Preparar o GUIDS

1. Em **Agentes de IA**, crie o GUIDS a partir do modelo do parceiro (ou "Personalizado") e preencha o que o inventário trouxe.
2. Em **Configurações › Credenciais BYOK**, cadastre as chaves. Na aba **Conexão de modelo** do GUIDS:
   - **Texto:** a chave e o modelo que conversam.
   - **Voz:** com chave de texto OpenAI ou Gemini, "Usar a chave de texto" basta; com Anthropic ou OpenRouter, escolha uma chave OpenAI ou Gemini, senão o agente pede ao contato que escreva.
   - **Embeddings:** reservada para as bases de conhecimento.
3. No **Portfólio**, confira os itens que o agente vai mostrar: imagens com endereço https público e, em **Documentos**, os links dos PDFs e planilhas. No Google Drive, compartilhe como "qualquer pessoa com o link"; um arquivo privado chega ao contato como link.
4. Em **Testar agente**, converse até o teste passar e ative o GUIDS.

## 3. Conectar o Chatwoot (uma vez por conta)

Em **Configurações › Canais**, conecte a conta do Chatwoot. A GUIDU cria o Agent Bot dela na conta. Ajuste o **Atendimento** da conexão ou só da inbox que vai migrar.

## 4. Trocar a inbox

1. **Tire o n8n da inbox.** A inbox tem um Agent Bot só, e ligar o GUIDS troca o bot dela pelo da GUIDU. Se o n8n recebia as mensagens por outro caminho (webhook da conta em Integrações, automação, API), desligue esse caminho para esta inbox, senão os dois respondem. Quando um fluxo do n8n atende várias inboxes, filtre pelo `inbox_id` desta ou duplique o fluxo.
2. **Ligue o GUIDS.** Na gaveta do GUIDS, aba **Canais**, ligue a inbox.
3. **Valide** com um número de teste: texto, áudio (deve voltar em áudio), imagem, um pedido de foto ou catálogo de um item e um pedido de atendente (nota privada com o resumo e conversa "open"). Devolva a conversa para "pending" e veja o agente voltar.
4. **Acompanhe** em Configurações › Canais o atendimento dos últimos 7 dias (enviadas e falhas) por alguns dias antes da próxima inbox.

As conversas "open" continuam com a equipe. As "pending" passam ao GUIDS na próxima mensagem do contato. O histórico anterior à conexão não entra no agente.

## 5. Voltar atrás

Desligue o GUIDS na aba Canais (a GUIDU tira o bot da inbox) e religue o caminho do n8n desta inbox.

## 6. Lista por inbox

| Passo                                                    | Feito |
| -------------------------------------------------------- | ----- |
| Inventário do fluxo do n8n                               |       |
| GUIDS com prompt, chaves de texto e voz, testado e ativo |       |
| Itens do Portfólio com imagens e documentos públicos     |       |
| Atendimento da inbox ajustado                            |       |
| n8n desligado nesta inbox                                |       |
| GUIDS ligado na inbox                                    |       |
| Texto, áudio, imagem, arquivo e transferência validados  |       |
| Saúde da conexão acompanhada                             |       |
