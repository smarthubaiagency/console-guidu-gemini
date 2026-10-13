# Agentes de IA — canais, conversas e saídas dos GUIDS

- **Versão:** 1.0 (parte da [especificação v1.0](especificacao.md) do módulo)
- **Data:** 12/10/2026
- **Estado:** Proposta para aprovação no PR da etapa A0. Vem da especificação v0.3 de 09/10/2026, com a numeração refeita; o conteúdo técnico não mudou.
- **Vale para:** os GUIDS (agentes dos clientes), que atendem contatos externos por canais de mensagem. O Assistente GUIDU fala só dentro do painel e não usa esta camada.
- **Decidido:** camada de canais no núcleo ([ADR 0011](../../adr/0011-camada-de-canais-no-nucleo.md)); o Chatwoot via Agent Bot é o primeiro canal (Marcelo, 12/10/2026).

Legenda: **[Decidido]** foi definido por Marcelo; **[Proposta]** é recomendação técnica ainda a aprovar; **[Em aberto]** é regra de produto ainda não definida, que não deve ser preenchida por suposição.

## 1. Tipos de canal

**[Proposta]** Os canais se dividem em dois tipos, porque a transferência para humano funciona de forma diferente em cada um:

- **Hub de atendimento:** o canal já tem atendentes humanos, e o agente é um bot dentro dele. A transferência é nativa: Chatwoot via Agent Bot, chat interno e, opcionalmente, Matrix com pontes.
- **Canal direto:** o agente fala direto com o contato e o canal não tem atendentes: Meta Cloud API, Evolution API e Matrix sem pontes. A transferência exige um hub ligado ao mesmo contato, ou se limita a pausar o bot e notificar a equipe.

## 2. Agente e canais: um para vários

**[Proposta]** A relação é **N:N por meio de vínculos**, com uma restrição:

- Um agente pode ter vínculos com vários canais. Instruções, ferramentas e conhecimento pertencem ao agente; formatação e limites de saída pertencem ao vínculo. Assim o mesmo atendimento vale no WhatsApp, no Chatwoot e no Matrix sem duplicar prompt.
- **Cada escopo de conexão tem no máximo um vínculo ativo.** Uma inbox do Chatwoot, um número da Meta ou uma sala Matrix é atendida por um único agente de cada vez, o que impede dois bots respondendo à mesma conversa. Isso é uma restrição única no banco, não só na interface.
- Quando o comportamento precisa ser realmente diferente num canal (outro tom, outras ferramentas), cria-se outro agente. "Um agente por canal" é uma escolha de configuração, não uma regra do sistema.
- O vínculo pode sobrescrever só o que é de canal: política de saída, divisão de mensagens, voz e janela de agrupamento. Ele não sobrescreve instruções nem ferramentas.

## 3. Camada de canais

### 3.1 Onde fica

**[Decidido — [ADR 0011](../../adr/0011-camada-de-canais-no-nucleo.md)]** Conexões de canal, adaptadores, entrada, roteamento, identidade da conversa e saída ficam no **núcleo** (`src/core/channels/`). O módulo Agentes de IA é um **consumidor**: recebe eventos normalizados e responde pelo serviço de saída do núcleo. Motivo: o chat interno, um módulo futuro, vai usar as mesmas conexões, por exemplo a Meta Cloud API, e pelo Adendo §7 um módulo não acessa repositório interno de outro.

O que fica no módulo: agentes, vínculos e política de saída, estado da conversa na visão do agente, turno (agrupamento, transcrição, modelo, plano de resposta), consumo e auditoria do agente.

**Implementado na A5a (13/10/2026):** `src/core/channels/` tem o contrato versionado dos eventos (`contract.ts`, versão 1), a guarda das chamadas aos provedores (`http.ts`: só https, sem redes internas, sem redirecionamento, resposta limitada), o adaptador Chatwoot (`chatwoot.ts`: normalização do webhook do Agent Bot, criação e remoção do bot, inboxes e verificação), o webhook por conexão (`webhook.ts` e `POST /api/channels/{conexão}/{token}`) e os serviços das conexões (`connections.ts`). As tabelas são `channel_connections`, `channel_routes`, `channel_conversations` e `channel_inbound_events`. O envio, a transferência e as entregas chegam com o primeiro consumidor, na A5b.

**Implementado na A5b (13/10/2026):** o primeiro consumidor é o módulo ai-agents (`consumer_ref` = o GUIDS). O contrato entre consumidor e núcleo está em `consumer.ts` (`ChannelConsumer.answer` recebe a rota, a conversa, os eventos agrupados e os limites e devolve as mensagens e se transfere); o despacho é o job `channels.dispatch` (`dispatch.ts`), agendado pela ingestão com a janela de agrupamento e agrupado por conversa no worker, que reivindica os eventos, chama o consumidor fora de transação, envia as partes (`channel_deliveries`, uma linha por execução e parte) e faz a transferência (`toggle_status` para "open"). As regras de atendimento ficam em `channel_connections.config.service` (`settings.ts`: `defaults` e `inboxes`, com agrupamento, máximo de mensagens, caracteres e intervalo). Só uma conversa sem status ou "pending" no Chatwoot é despachada.

### 3.2 Contrato do adaptador

O adaptador é interno do núcleo: nenhum módulo o chama diretamente. Todo canal implementa o mesmo contrato. A assinatura abaixo é ilustrativa; o tipo final nasce com o código.

```ts
interface ChannelAdapter {
  kind: "chatwoot" | "meta_cloud" | "evolution" | "matrix";
  hub: boolean;
  capabilities: ChannelCapabilities;
  verifyInbound(
    request: Request,
    connection: ChannelConnection,
  ): Promise<VerifiedInbound>;
  normalize(inbound: VerifiedInbound): InboundEvent[];
  fetchMedia(ref: MediaRef, limits: MediaLimits): Promise<MediaFile>;
  send(
    part: DeliveryPart,
    target: ConversationTarget,
    idempotencyKey: string,
  ): Promise<ExternalMessageRef>;
  handoff?(target: ConversationTarget, reason: HandoffReason): Promise<void>;
  setTyping?(target: ConversationTarget): Promise<void>;
  checkHealth(connection: ChannelConnection): Promise<ChannelHealth>;
}

interface ChannelCapabilities {
  input: { text: boolean; audio: boolean; image: boolean; file: boolean };
  output: {
    text: { maxLength: number; format: "plain" | "markdown" | "html" } | null;
    audio: { mimeTypes: string[]; voiceNote: boolean } | null;
    json: boolean;
  };
  typingIndicator: boolean;
  messagingWindow?: "meta_24h";
}
```

`InboundEvent` normalizado contém: id externo da mensagem (chave de idempotência), conversa externa, contato externo, remetente (contato, atendente humano ou o próprio bot), conteúdo (texto ou referência de mídia) e horário do provedor.

**Requisitos comuns de todo adaptador** (detalhes e referência de implementação em [`docs/spikes/copilotkit.md`](../../spikes/copilotkit.md) §3 e §4):

- verificação de autenticidade do webhook em tempo constante, sobre o corpo bruto e com limite de tamanho;
- evento gravado com id externo único **antes** de responder ao provedor;
- segredos só pelo cofre, por conexão;
- download de mídia restrito aos hosts do provedor, com limite aplicado durante a transferência e verificação do tipo real;
- limites do canal declarados em `ChannelCapabilities` e aplicados na renderização;
- **suíte de conformidade** comum (assinatura, desafio de cadastro, idempotência, mídia acima do limite, normalização de texto, áudio e interação, renderização dentro dos limites). Um adaptador só entra com a suíte verde.

O adaptador Meta Cloud API toma como referência o adaptador de WhatsApp do Channels SDK do CopilotKit (MIT), com atribuição em cada arquivo derivado e em `THIRD_PARTY_NOTICES.md`.

### 3.3 Canais previstos

| Canal                                      | Tipo                      | Entrada                                    | Saída                                                                | Pontos específicos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------- | ------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chatwoot via Agent Bot** [Decidido]      | Hub                       | Texto, áudio, anexos                       | Texto, áudio (anexo)                                                 | O Agent Bot é cadastrado no Chatwoot com `outgoing_url` apontando para a plataforma e responde pela API com o token do bot (no cofre). O vínculo tem como escopo uma ou mais inboxes. O bot só atende conversas com status pendente; a transferência muda o status para aberto e pode atribuir equipe ou etiqueta. Mensagens de atendentes e do próprio bot são ignoradas como gatilho. Verificar na versão em uso se o webhook é assinado; se não for, a URL leva um token secreto por conexão, guardado por hash. |
| **Meta WhatsApp Cloud API** [Decidido]     | Direto                    | Texto, áudio (ogg/opus), imagem, documento | Texto, nota de voz, mensagens interativas (futuro)                   | Assinatura `X-Hub-Signature-256` com o app secret e desafio de verificação no cadastro do webhook. A mídia é baixada pelo id na Graph API. Fora da janela de 24 horas só é permitido template aprovado: o agente não pode enviar texto livre e a entrega falha de forma explícita. A transferência depende de um hub (seção 3.4).                                                                                                                                                                                   |
| **Evolution API** [Decidido]               | Direto                    | Texto, áudio, mídia                        | Texto, áudio                                                         | Integração não oficial com o WhatsApp: risco de bloqueio do número e de conflito com os termos do WhatsApp. Exige aceite de risco registrado por workspace (D-AG-05). Webhook autenticado por chave da instância.                                                                                                                                                                                                                                                                                                   |
| **Matrix** [Decidido, prioridade alta]     | Direto, ou hub com pontes | Texto, áudio (`m.audio`), arquivos         | Texto (corpo simples e formatado), áudio, JSON em evento customizado | Dois modos de conexão: Application Service (o homeserver empurra transações autenticadas por `hs_token`; exige registro no homeserver) ou usuário bot pela Client-Server API (`/sync`; funciona em homeserver de terceiros). Salas com criptografia ponta a ponta exigem guardar o estado criptográfico do bot de forma persistente e protegida (D-AG-06). Com pontes (mautrix e similares), uma sala representa um contato de outro serviço e o Matrix vira hub.                                                   |
| **Chat interno** [Decidido, módulo futuro] | Hub                       | Texto, áudio, arquivos                     | Texto, áudio, **JSON** (cartões e ações ricas)                       | Não é adaptador de provedor: é um **módulo hub** consumidor do núcleo, que aciona o agente pelo serviço público do módulo (seção 3.5). O agente entra como participante bot; a transferência é nativa.                                                                                                                                                                                                                                                                                                              |

### 3.4 Roteamento

**[Decidido — ADR 0011]** O núcleo mantém uma tabela de rotas: para cada **(conexão, escopo)** existe no máximo **uma rota ativa**, com o consumidor dono das conversas daquele escopo.

| Campo                    | Conteúdo                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conexão                  | A conexão de canal do workspace                                                                                                                   |
| Escopo                   | Inbox do Chatwoot, `phone_number_id` da Meta, instância Evolution ou sala/espaço Matrix. Uma conexão pode ter vários escopos com donos diferentes |
| Consumidor               | `module_key` do módulo dono (`ai-agents`, futuramente o chat interno)                                                                             |
| Referência do consumidor | O que o módulo usa para achar sua configuração. No Agentes de IA, é o **vínculo** (seção 2)                                                       |
| Estado                   | Ativa, pausada ou encerrada                                                                                                                       |

- O vínculo do agente e a rota do núcleo nascem juntos: criar um vínculo direto num escopo cria a rota com `ai-agents` como consumidor, na mesma transação. Se o escopo já tem rota ativa de outro consumidor, a criação é recusada.
- Trocar o dono de um escopo é uma operação explícita, auditada e com permissão `channels.manage`. Por exemplo, de "agente direto" para "chat interno com agente". Conversas abertas seguem a regra do consumidor que sai: encerrar ou transferir (em aberto, D-AG-13).
- Evento de escopo sem rota ativa é gravado e não é despachado; aparece na saúde da conexão.

### 3.5 Contrato entre consumidor e núcleo

O módulo consumidor declara no manifesto a capacidade `channels.consumer` e registra um handler de servidor. As assinaturas abaixo são ilustrativas.

```ts
// Implementado pelo módulo consumidor (server-only)
interface ChannelConsumer {
  moduleKey: string;
  handleEvent(ctx: ChannelEventContext, event: InboundEvent): Promise<void>;
  onRouteChanged?(ctx: ChannelEventContext, change: RouteChange): Promise<void>;
}

// Montado pelo núcleo antes de chamar o consumidor
interface ChannelEventContext {
  workspace: AuthorizedWorkspaceContext;
  conversation: ChannelConversationRef;
  route: { id: string; consumerRef: string };
  capabilities: ChannelCapabilities;
}

// Serviço público do núcleo usado pelos consumidores
interface ChannelOutbound {
  send(
    ctx: ChannelEventContext,
    parts: DeliveryPart[],
    idempotencyKey: string,
  ): Promise<DeliveryReceipt>;
  handoff(ctx: ChannelEventContext, reason: HandoffReason): Promise<void>;
  setTyping(ctx: ChannelEventContext): Promise<void>;
  fetchMedia(ctx: ChannelEventContext, ref: MediaRef): Promise<MediaFile>;
}
```

- **Despacho:** o núcleo chama `handleEvent` dentro de um job do worker, nunca no webhook. A concorrência é 1 por conversa. O contexto é montado pelo núcleo depois de revalidar workspace, conexão, rota e disponibilidade do módulo.
- **Envio:** o núcleo só aceita envio do consumidor dono da rota da conversa. Cada parte tem chave de idempotência; o núcleo cuida de fila, retry, ordem, intervalo e regras do provedor. O receipt informa as partes aceitas e as recusadas, por exemplo por janela de 24 horas expirada.
- **Mídia:** o consumidor baixa mídia só pelo núcleo, que aplica limites e restringe os hosts.
- **Isolamento:** o consumidor nunca vê payload bruto, segredo da conexão nem conversas de escopo que não são suas.

#### Agente acionado por um hub

Quando o dono da rota é um módulo hub, como o chat interno, o módulo Agentes de IA expõe um serviço público para o hub chamar:

```ts
interface AgentTurnService {
  runTurn(ctx: HubTurnContext, input: HubTurnInput): Promise<ResponsePlan>;
}
```

O hub informa o vínculo (agente e política de saída), as mensagens novas e o histórico relevante. O agente devolve o plano de resposta (seção 5) **sem enviar nada**: o hub exibe no seu painel e envia pelo `ChannelOutbound` do núcleo, como dono da rota. A ação `handoff` do plano é executada pelo hub. A validação de permissão, módulo e quota acontece nos dois módulos.

### 3.6 Cenários

| Cenário                                   | Dono da rota | Fluxo                                                                                                                                                           |
| ----------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chatwoot com agente** (substitui o n8n) | `ai-agents`  | Chatwoot → núcleo → agente → núcleo envia como bot no Chatwoot. A transferência muda o status no Chatwoot e os humanos assumem lá                               |
| **Meta com chat interno e agente**        | Chat interno | Meta → núcleo → chat interno → `runTurn` do agente → chat interno → núcleo envia no WhatsApp. A transferência atribui um atendente no chat interno              |
| **Meta direto com agente**                | `ai-agents`  | Meta → núcleo → agente → núcleo envia. Sem hub, a transferência só pausa a conversa e notifica (seção 5). Para ter humanos, troca-se a rota para o chat interno |

## 4. Fluxo de processamento

Segue a [ADR 0002](../../adr/0002-jobs-e-hospedagem.md): o webhook só registra o evento, e o processamento roda em jobs no worker `app_worker`.

1. **Recepção (núcleo):** o webhook da conexão valida a autenticação do canal, normaliza, grava o evento com restrição única no id externo (um reenvio do provedor não duplica nada), resolve a rota e enfileira o despacho para o consumidor.
2. **Filtro:** o evento é descartado como gatilho quando o remetente é o bot ou um atendente, quando a conversa não está em `bot_ativo`, ou quando módulo, plano ou vínculo não permitem o atendimento. Mensagens de atendentes continuam no histórico como contexto.
3. **Agrupamento:** agenda o job de turno da conversa com atraso igual à janela de agrupamento do vínculo, para juntar mensagens seguidas do contato. Cada conversa processa um turno por vez (concorrência 1 por conversa). Mensagem que chega durante um turno entra no turno seguinte.
4. **Preparação do turno:** dentro de `withContext`, revalida módulo, vínculo, estado da conversa e quota, e carrega o histórico. Áudios recebidos são baixados com limites de tamanho e tipo e transcritos; a transcrição fica salva junto da mensagem.
5. **Execução do agente:** chamada ao modelo **fora** de transação de banco. As ferramentas abrem a própria transação contextualizada, com o contexto vindo do job e nunca de argumento do modelo. O resultado é um plano de resposta validado por Zod.
6. **Renderização por canal:** aplica a política de saída do vínculo e as capacidades do canal (seção 5).
7. **Entrega (núcleo):** o módulo chama o `ChannelOutbound`; o núcleo cria um job de entrega por parte, em ordem, com intervalo entre as mensagens e indicador de digitação quando houver. Cada parte tem chave de idempotência (conversa + turno + índice), então um retry não duplica mensagem para o contato.
8. **Registro:** consumo medido ([especificação, seção 9](especificacao.md#9-chaves-consumo-e-limites)) e auditoria das ações relevantes.

**[Em aberto]** Se o contato mandar nova mensagem enquanto as partes ainda estão sendo entregues: continuar a entrega ou cancelar as partes restantes e reprocessar (D-AG-08).

## 5. Estado da conversa e transferência

| Estado        | Significado                                                                                         | Quem muda                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `bot_ativo`   | O agente responde                                                                                   | Criação da conversa; retorno ao bot, se permitido                                                              |
| `transferida` | Um humano assumiu; o agente não responde                                                            | Ferramenta de transferência, ação de atendente no hub ou sinal do hub (por exemplo, status aberto no Chatwoot) |
| `pausada`     | Atendimento suspenso sem humano (canal direto sem hub, falha de quota, janela de 24 horas expirada) | Sistema ou membro com `ai_agents.manage`                                                                       |
| `encerrada`   | Conversa finalizada                                                                                 | Hub, sistema ou membro                                                                                         |

- A transferência é uma **ferramenta do agente** com motivo obrigatório. O agente decide quando transferir a partir das instruções; a regra do que motiva uma transferência é de cada agente.
- O estado do hub prevalece: se um atendente assumir no Chatwoot ou no chat interno, a conversa vai para `transferida` no próximo evento recebido.
- **[Em aberto]** Se e quando a conversa volta para o bot depois da transferência (D-AG-09).

## 6. Saídas: texto, áudio e JSON

### 6.1 Plano de resposta

O agente devolve sempre uma saída estruturada. O formato abaixo é ilustrativo:

```ts
const ResponsePlan = z.object({
  messages: z.array(z.string().min(1)).min(1),
  data: z.unknown().optional(),
  actions: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("handoff"), reason: z.string().min(1) }),
      ]),
    )
    .default([]),
});
```

- `messages` já vem dividido pelo modelo em mensagens curtas. A divisão por saída estruturada é mais confiável que separadores no texto. O renderizador ainda corta pelo `maxLength` do canal, se precisar.
- `data` só existe em vínculos com saída JSON e é validado contra o schema do vínculo.
- **[Em aberto]** Vocabulário de partes além de texto (botões de resposta, lista de opções, imagem, áudio, cartão de dados). Referência: `@copilotkit/channels-ui`, em [`docs/spikes/copilotkit.md`](../../spikes/copilotkit.md) §5.2.

### 6.2 Política de saída do vínculo

| Campo            | Valores                                                                           | Observação                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `textMode`       | `dividido` ou `único`                                                             | Número máximo de mensagens e tamanho por mensagem: [Em aberto], sem valor padrão inventado                                                                 |
| `audioMode`      | `nunca`, `espelhar` (responde em áudio quando o contato mandou áudio) ou `sempre` | Só vale se o canal tem saída de áudio. Voz e formato vêm da conexão de voz do workspace (BYOK). Para nota de voz no WhatsApp, a saída precisa ser ogg/opus |
| `audioWithText`  | sim ou não                                                                        | Envia também o texto junto do áudio                                                                                                                        |
| `jsonSchema`     | Schema do dado estruturado                                                        | Só em canais com `output.json` (chat interno, Matrix com evento customizado, um futuro canal de API/webhook). Formato e versionamento do schema: D-AG-07   |
| `pacing`         | Intervalo entre mensagens e indicador de digitação                                | Valores: [Em aberto]                                                                                                                                       |
| `groupingWindow` | Janela de agrupamento de mensagens do contato                                     | Valor: [Em aberto]; obrigatório no vínculo                                                                                                                 |

Regra de compatibilidade: se a política pede uma saída que o canal não tem, o vínculo é recusado na configuração e não falha em silêncio durante a conversa. O `configurationSchema` do manifesto valida isso ([ADR 0006](../../adr/0006-manifesto-de-modulos.md)).
