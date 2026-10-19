# Tradução do chat em tempo real

- **Status:** Proposta para discussão. Nada aqui foi implementado.
- **Data:** 19/10/2026
- **Origem:** conversa de Marcelo com o Claude em 19/10/2026, para o piloto de Búzios, focado em turismo.
- **Decisões do Marcelo (19/10/2026):**
  - a tradução usa a **chave do cliente**;
  - nas configurações do chat há a opção **"Ativar tradução do chat em tempo real"**;
  - ao ativar, o cliente escolhe o **modelo de IA** ou o **Google Translate**, informando as credenciais do Google se ainda não estiverem cadastradas;
  - o **Google Translate entra como fallback**.
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
4. **Idioma da equipe:** o padrão do workspace (`workspaces.default_locale`). Depois, por pessoa (`profiles.locale`).
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
6. **Custo:** limite diário de caracteres e tokens por workspace, com aviso ao se aproximar.

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

1. O idioma da equipe é por workspace ou por pessoa desde o início?
2. Quais idiomas no piloto: espanhol e inglês, ou também outros?
3. O limite diário de tradução é configurado pelo cliente ou definido pelo plano?
4. Google Translate Basic (só chave de API) basta, ou já vale o Advanced com glossário?
