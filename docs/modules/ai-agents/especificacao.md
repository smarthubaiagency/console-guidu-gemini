# Especificação do módulo Agentes de IA — canais, conversas e saídas

- **Versão:** 0.3 (rascunho)
- **Data:** 09/10/2026
- **Estado:** **Proposta, aguarda aprovação do Marcelo.** A camada de canais (D-AG-01) já foi aprovada e está registrada na [ADR 0011](../../adr/0011-camada-de-canais-no-nucleo.md). Não descongela o módulo ([ESTADO.md](ESTADO.md)) nem altera a ordem das fases ([ADR 0003](../../adr/0003-ordem-das-fases.md)).
- **Escopo desta versão:** agente conversacional atendendo por canais de mensagem (texto e áudio), com resposta dividida em mensagens curtas e saídas em texto, áudio ou JSON conforme o canal. RAG, agendamentos e ferramentas MCP do módulo ficam fora desta versão.
- **Referências:** Especificação v1.0 §6, §14–§20; Adendo v1.1 §3–§7, §12–§13; ADRs 0001, 0002, 0006 e 0009; avaliação do eve em [`docs/spikes/eve.md`](../../spikes/eve.md).

Legenda: **[Decidido]** foi definido por Marcelo; **[Proposta]** é recomendação técnica ainda a aprovar; **[Em aberto]** é regra de produto ainda não definida, que não deve ser preenchida por suposição.

## 1. Problema e público

Hoje o atendimento com IA da operação roda em fluxos do n8n ligados ao Chatwoot. O agente conversa por texto e áudio e divide a resposta em várias mensagens para não mandar um bloco de texto. O módulo traz esse atendimento para dentro da plataforma, com isolamento por workspace, BYOK, consumo medido e auditoria, e passa a atender vários canais com a mesma base.

| Público                                     | Uso                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Membros do workspace com `ai_agents.manage` | Criam agentes, conectam canais, definem vínculos e políticas de saída                      |
| Membros com `ai_agents.use`                 | Testam agentes e acompanham conversas, conforme permissão de leitura de conteúdo (seção 9) |
| Clientes finais do workspace                | Conversam com o agente pelo canal; não são usuários da plataforma                          |
| Atendentes humanos                          | Recebem a conversa na transferência, dentro do hub (Chatwoot ou chat interno)              |

## 2. Conceitos

| Conceito              | Definição                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agente**            | Persona configurada no workspace: instruções, conexão de modelo (BYOK), ferramentas permitidas e política de transferência. Não conhece detalhes de canal.                                    |
| **Conexão de canal**  | Integração do workspace com um provedor de mensagens (uma conta Chatwoot, um número da Meta, uma instância Evolution, um bot Matrix). Guarda configuração não secreta e referências ao cofre. |
| **Vínculo**           | Liga um agente a uma conexão de canal, num escopo (uma inbox, um número, uma sala) e com uma política de saída. É o vínculo que decide quem responde.                                         |
| **Conversa**          | Fio de mensagens com um contato externo, dentro de um vínculo, com estado próprio (seção 6).                                                                                                  |
| **Turno**             | Processamento de uma ou mais mensagens agrupadas do contato até a resposta.                                                                                                                   |
| **Plano de resposta** | Saída estruturada do agente num turno: partes (texto, áudio, JSON) e ações (por exemplo, transferir). O canal decide como entregar cada parte.                                                |

### 2.1 Tipos de canal

**[Proposta]** Os canais se dividem em dois tipos, porque a transferência para humano funciona de forma diferente em cada um:

- **Hub de atendimento:** o canal já tem atendentes humanos, e o agente é um bot dentro dele. A transferência é nativa: Chatwoot via Agent Bot, chat interno e, opcionalmente, Matrix com pontes.
- **Canal direto:** o agente fala direto com o contato e o canal não tem atendentes: Meta Cloud API, Evolution API e Matrix sem pontes. A transferência exige um hub ligado ao mesmo contato, ou se limita a pausar o bot e notificar a equipe.

## 3. Agente e canais: um para vários

**[Proposta]** A relação é **N:N por meio de vínculos**, com uma restrição:

- Um agente pode ter vínculos com vários canais. Instruções, ferramentas e conhecimento pertencem ao agente; formatação e limites de saída pertencem ao vínculo. Assim o mesmo atendimento vale no WhatsApp, no Chatwoot e no Matrix sem duplicar prompt.
- **Cada escopo de conexão tem no máximo um vínculo ativo.** Uma inbox do Chatwoot, um número da Meta ou uma sala Matrix é atendida por um único agente de cada vez, o que impede dois bots respondendo à mesma conversa. Isso é uma restrição única no banco, não só na interface.
- Quando o comportamento precisa ser realmente diferente num canal (outro tom, outras ferramentas), cria-se outro agente. "Um agente por canal" é uma escolha de configuração, não uma regra do sistema.
- O vínculo pode sobrescrever só o que é de canal: política de saída, divisão de mensagens, voz e janela de agrupamento. Ele não sobrescreve instruções nem ferramentas.

## 4. Camada de canais

### 4.1 Onde fica

**[Decidido — [ADR 0011](../../adr/0011-camada-de-canais-no-nucleo.md)]** Conexões de canal, adaptadores, entrada, roteamento, identidade da conversa e saída ficam no **núcleo** (`src/core/channels/`). O módulo Agentes de IA é um **consumidor**: recebe eventos normalizados e responde pelo serviço de saída do núcleo. Motivo: o chat interno, um módulo futuro, vai usar as mesmas conexões, por exemplo a Meta Cloud API, e pelo Adendo §7 um módulo não acessa repositório interno de outro.

O que fica no módulo: agentes, vínculos e política de saída, estado da conversa na visão do agente, turno (agrupamento, transcrição, modelo, plano de resposta), consumo e auditoria do agente.

### 4.2 Contrato do adaptador

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

### 4.3 Canais previstos

| Canal                                      | Tipo                      | Entrada                                    | Saída                                                                | Pontos específicos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------- | ------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chatwoot via Agent Bot** [Decidido]      | Hub                       | Texto, áudio, anexos                       | Texto, áudio (anexo)                                                 | O Agent Bot é cadastrado no Chatwoot com `outgoing_url` apontando para a plataforma e responde pela API com o token do bot (no cofre). O vínculo tem como escopo uma ou mais inboxes. O bot só atende conversas com status pendente; a transferência muda o status para aberto e pode atribuir equipe ou etiqueta. Mensagens de atendentes e do próprio bot são ignoradas como gatilho. Verificar na versão em uso se o webhook é assinado; se não for, a URL leva um token secreto por conexão, guardado por hash. |
| **Meta WhatsApp Cloud API** [Decidido]     | Direto                    | Texto, áudio (ogg/opus), imagem, documento | Texto, nota de voz, mensagens interativas (futuro)                   | Assinatura `X-Hub-Signature-256` com o app secret e desafio de verificação no cadastro do webhook. A mídia é baixada pelo id na Graph API. Fora da janela de 24 horas só é permitido template aprovado: o agente não pode enviar texto livre e a entrega falha de forma explícita. A transferência depende de um hub (seção 4.4).                                                                                                                                                                                   |
| **Evolution API** [Decidido]               | Direto                    | Texto, áudio, mídia                        | Texto, áudio                                                         | Integração não oficial com o WhatsApp: risco de bloqueio do número e de conflito com os termos do WhatsApp. Exige aceite de risco registrado por workspace (D-AG-05). Webhook autenticado por chave da instância.                                                                                                                                                                                                                                                                                                   |
| **Matrix** [Decidido, prioridade alta]     | Direto, ou hub com pontes | Texto, áudio (`m.audio`), arquivos         | Texto (corpo simples e formatado), áudio, JSON em evento customizado | Dois modos de conexão: Application Service (o homeserver empurra transações autenticadas por `hs_token`; exige registro no homeserver) ou usuário bot pela Client-Server API (`/sync`; funciona em homeserver de terceiros). Salas com criptografia ponta a ponta exigem guardar o estado criptográfico do bot de forma persistente e protegida (D-AG-06). Com pontes (mautrix e similares), uma sala representa um contato de outro serviço e o Matrix vira hub.                                                   |
| **Chat interno** [Decidido, módulo futuro] | Hub                       | Texto, áudio, arquivos                     | Texto, áudio, **JSON** (cartões e ações ricas)                       | Não é adaptador de provedor: é um **módulo hub** consumidor do núcleo, que aciona o agente pelo serviço público do módulo (seção 4.5). O agente entra como participante bot; a transferência é nativa.                                                                                                                                                                                                                                                                                                              |

### 4.4 Roteamento

**[Decidido — ADR 0011]** O núcleo mantém uma tabela de rotas: para cada **(conexão, escopo)** existe no máximo **uma rota ativa**, com o consumidor dono das conversas daquele escopo.

| Campo                    | Conteúdo                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conexão                  | A conexão de canal do workspace                                                                                                                   |
| Escopo                   | Inbox do Chatwoot, `phone_number_id` da Meta, instância Evolution ou sala/espaço Matrix. Uma conexão pode ter vários escopos com donos diferentes |
| Consumidor               | `module_key` do módulo dono (`ai-agents`, futuramente o chat interno)                                                                             |
| Referência do consumidor | O que o módulo usa para achar sua configuração. No Agentes de IA, é o **vínculo** (seção 3)                                                       |
| Estado                   | Ativa, pausada ou encerrada                                                                                                                       |

- O vínculo do agente e a rota do núcleo nascem juntos: criar um vínculo direto num escopo cria a rota com `ai-agents` como consumidor, na mesma transação. Se o escopo já tem rota ativa de outro consumidor, a criação é recusada.
- Trocar o dono de um escopo é uma operação explícita, auditada e com permissão `channels.manage`. Por exemplo, de "agente direto" para "chat interno com agente". Conversas abertas seguem a regra do consumidor que sai: encerrar ou transferir (em aberto, D-AG-13).
- Evento de escopo sem rota ativa é gravado e não é despachado; aparece na saúde da conexão.

### 4.5 Contrato entre consumidor e núcleo

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

O hub informa o vínculo (agente e política de saída), as mensagens novas e o histórico relevante. O agente devolve o plano de resposta (seção 7) **sem enviar nada**: o hub exibe no seu painel e envia pelo `ChannelOutbound` do núcleo, como dono da rota. A ação `handoff` do plano é executada pelo hub. A validação de permissão, módulo e quota acontece nos dois módulos.

### 4.6 Cenários

| Cenário                                   | Dono da rota | Fluxo                                                                                                                                                           |
| ----------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chatwoot com agente** (substitui o n8n) | `ai-agents`  | Chatwoot → núcleo → agente → núcleo envia como bot no Chatwoot. A transferência muda o status no Chatwoot e os humanos assumem lá                               |
| **Meta com chat interno e agente**        | Chat interno | Meta → núcleo → chat interno → `runTurn` do agente → chat interno → núcleo envia no WhatsApp. A transferência atribui um atendente no chat interno              |
| **Meta direto com agente**                | `ai-agents`  | Meta → núcleo → agente → núcleo envia. Sem hub, a transferência só pausa a conversa e notifica (seção 6). Para ter humanos, troca-se a rota para o chat interno |

## 5. Fluxo de processamento

Segue a [ADR 0002](../../adr/0002-jobs-e-hospedagem.md): o webhook só registra o evento, e o processamento roda em jobs no worker `app_worker`.

1. **Recepção (núcleo):** o webhook da conexão valida a autenticação do canal, normaliza, grava o evento com restrição única no id externo (um reenvio do provedor não duplica nada), resolve a rota e enfileira o despacho para o consumidor.
2. **Filtro:** o evento é descartado como gatilho quando o remetente é o bot ou um atendente, quando a conversa não está em `bot_ativo`, ou quando módulo, plano ou vínculo não permitem o atendimento. Mensagens de atendentes continuam no histórico como contexto.
3. **Agrupamento:** agenda o job de turno da conversa com atraso igual à janela de agrupamento do vínculo, para juntar mensagens seguidas do contato. Cada conversa processa um turno por vez (concorrência 1 por conversa). Mensagem que chega durante um turno entra no turno seguinte.
4. **Preparação do turno:** dentro de `withContext`, revalida módulo, vínculo, estado da conversa e quota, e carrega o histórico. Áudios recebidos são baixados com limites de tamanho e tipo e transcritos; a transcrição fica salva junto da mensagem.
5. **Execução do agente:** chamada ao modelo **fora** de transação de banco. As ferramentas abrem a própria transação contextualizada, com o contexto vindo do job e nunca de argumento do modelo. O resultado é um plano de resposta validado por Zod.
6. **Renderização por canal:** aplica a política de saída do vínculo e as capacidades do canal (seção 7).
7. **Entrega (núcleo):** o módulo chama o `ChannelOutbound`; o núcleo cria um job de entrega por parte, em ordem, com intervalo entre as mensagens e indicador de digitação quando houver. Cada parte tem chave de idempotência (conversa + turno + índice), então um retry não duplica mensagem para o contato.
8. **Registro:** consumo medido (seção 10) e auditoria das ações relevantes.

**[Em aberto]** Se o contato mandar nova mensagem enquanto as partes ainda estão sendo entregues: continuar a entrega ou cancelar as partes restantes e reprocessar (D-AG-08).

## 6. Estado da conversa e transferência

| Estado        | Significado                                                                                         | Quem muda                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `bot_ativo`   | O agente responde                                                                                   | Criação da conversa; retorno ao bot, se permitido                                                              |
| `transferida` | Um humano assumiu; o agente não responde                                                            | Ferramenta de transferência, ação de atendente no hub ou sinal do hub (por exemplo, status aberto no Chatwoot) |
| `pausada`     | Atendimento suspenso sem humano (canal direto sem hub, falha de quota, janela de 24 horas expirada) | Sistema ou membro com `ai_agents.manage`                                                                       |
| `encerrada`   | Conversa finalizada                                                                                 | Hub, sistema ou membro                                                                                         |

- A transferência é uma **ferramenta do agente** com motivo obrigatório. O agente decide quando transferir a partir das instruções; a regra do que motiva uma transferência é de cada agente.
- O estado do hub prevalece: se um atendente assumir no Chatwoot ou no chat interno, a conversa vai para `transferida` no próximo evento recebido.
- **[Em aberto]** Se e quando a conversa volta para o bot depois da transferência (D-AG-09).

## 7. Saídas: texto, áudio e JSON

### 7.1 Plano de resposta

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

### 7.2 Política de saída do vínculo

| Campo            | Valores                                                                           | Observação                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `textMode`       | `dividido` ou `único`                                                             | Número máximo de mensagens e tamanho por mensagem: [Em aberto], sem valor padrão inventado                                                                 |
| `audioMode`      | `nunca`, `espelhar` (responde em áudio quando o contato mandou áudio) ou `sempre` | Só vale se o canal tem saída de áudio. Voz e formato vêm da conexão de voz do workspace (BYOK). Para nota de voz no WhatsApp, a saída precisa ser ogg/opus |
| `audioWithText`  | sim ou não                                                                        | Envia também o texto junto do áudio                                                                                                                        |
| `jsonSchema`     | Schema do dado estruturado                                                        | Só em canais com `output.json` (chat interno, Matrix com evento customizado, um futuro canal de API/webhook). Formato e versionamento do schema: D-AG-07   |
| `pacing`         | Intervalo entre mensagens e indicador de digitação                                | Valores: [Em aberto]                                                                                                                                       |
| `groupingWindow` | Janela de agrupamento de mensagens do contato                                     | Valor: [Em aberto]; obrigatório no vínculo                                                                                                                 |

Regra de compatibilidade: se a política pede uma saída que o canal não tem, o vínculo é recusado na configuração e não falha em silêncio durante a conversa. O `configurationSchema` do manifesto valida isso ([ADR 0006](../../adr/0006-manifesto-de-modulos.md)).

## 8. Escolha técnica do SDK

**[Proposta]** Usar o **AI SDK** (`ai` 7.x, Apache-2.0) como biblioteca dentro do worker:

- `ToolLoopAgent` para o loop de ferramentas, com aprovação de ferramenta quando necessário;
- `transcribe()` para áudio de entrada e `generateSpeech()` para áudio de saída;
- saída estruturada com Zod para o plano de resposta;
- provedor instanciado por chamada com a chave BYOK decifrada do workspace, sem gateway intermediário.

O estado e a durabilidade ficam nas nossas tabelas e no pg-boss: a retomada é por turno, com entregas idempotentes. Alternativas avaliadas:

- **eve:** runtime e estado próprios, beta; ver o [spike](../../spikes/eve.md).
- **Deep Agents JS:** reserva para tarefas longas com planejamento e subagentes; não traz áudio.
- **AI SDK Harnesses:** experimental e voltado a agentes de código em sandbox.

A escolha do SDK deve virar ADR quando aprovada (D-AG-02).

## 9. Permissões

Ficam as permissões já existentes no catálogo (`src/core/permissions/catalog.ts`), mais duas propostas:

| Permissão                                       | Uso                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ai_agents.use`                                 | Testar agentes e ver a lista de conversas e seus estados                                          |
| `ai_agents.manage`                              | Criar e alterar agentes, vínculos e políticas de saída; pausar e encerrar conversas               |
| `ai_agents.conversations.read` [Proposta]       | Ler o conteúdo das conversas (texto, transcrições, áudios), que é dado pessoal de clientes finais |
| `channels.manage` [Decidido, núcleo — ADR 0011] | Criar, testar e revogar conexões de canal                                                         |

## 10. Consumo, planos e limites

O servidor mede, por workspace e por vínculo: tokens de entrada e saída por modelo, segundos de áudio transcritos, caracteres sintetizados em voz e mensagens entregues. Vai para `usage_events`.

**[Em aberto]** Quotas, limites por plano e o que acontece quando a quota acaba (pausar conversa, avisar, transferir) são do Comercial e do produto (D-AG-10). Sem limite definido, o módulo não entra em produção. BYOK não elimina o limite da plataforma (Especificação §18). Também é preciso um limite técnico de turnos por conversa e por contato contra abuso e laço; o valor fica em aberto.

## 11. Dados

Proposta de tabelas. Toda tabela operacional tem `workspace_id NOT NULL`, RLS forçado e FKs compostas por workspace ([ADR 0001](../../adr/0001-prisma-como-caminho-unico.md)). O SQL nasce em migration versionada só depois da aprovação.

| Tabela                    | Dono   | Conteúdo                                                                                                                                                  |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channel_connections`     | Núcleo | Tipo, nome, configuração não secreta, referências ao cofre (tokens, app secret, chave de instância), hash do token do webhook, estado, última verificação |
| `channel_inbound_events`  | Núcleo | Evento bruto normalizado, id externo único por conexão, estado de processamento; retenção curta                                                           |
| `channel_routes`          | Núcleo | Conexão, escopo, `module_key` do consumidor, referência do consumidor, estado; única ativa por (conexão, escopo)                                          |
| `channel_conversations`   | Núcleo | Conexão, escopo, conversa e contato externos, rota atual; referenciada pelas tabelas dos módulos                                                          |
| `channel_deliveries`      | Núcleo | Parte a entregar, ordem, chave de idempotência única, tentativas, id externo, estado                                                                      |
| `agent_configs` (existe)  | Módulo | Evolui para o agente: instruções, referência à conexão de modelo, ferramentas permitidas                                                                  |
| `agent_channel_bindings`  | Módulo | Agente, rota do núcleo, política de saída, estado; criado na mesma transação da rota                                                                      |
| `agent_conversations`     | Módulo | Conversa do núcleo (FK composta), vínculo, estado na visão do agente (seção 6), horários                                                                  |
| `agent_messages` (existe) | Módulo | Passa a ter direção, remetente, partes, referência de mídia, transcrição e ids externos                                                                   |

As tabelas `agent_sessions`/`agent_messages` atuais vieram do protótipo congelado. A migração delas faz parte da implementação (D-AG-11).

Áudios e arquivos ficam em bucket privado, com caminho por workspace e acesso por URL assinada curta (Especificação §19).

## 12. Segurança

- Cada canal autentica o webhook do seu jeito (assinatura HMAC em comparação de tempo constante, token por conexão ou `hs_token`). Identidade do contato só vale depois da verificação.
- Download de mídia só dos hosts do provedor da conexão, com limite de tamanho e verificação do tipo real (proteção contra SSRF e arquivo malicioso).
- Mensagens do contato e transcrições são **dados não confiáveis**. Ferramentas são autorizadas no servidor e não há ferramenta genérica de HTTP, SQL ou arquivo (Especificação §17.3).
- O texto gerado é escapado para o formato do canal, como o HTML formatado do Matrix.
- Segredos dos canais e do modelo nunca aparecem em DTO, log, erro ou plano de resposta.
- Um módulo indisponível, vínculo inativo ou workspace suspenso bloqueia o processamento no worker, não só na interface (AC08).

## 13. Privacidade, retenção e exclusão

O conteúdo das conversas é dado pessoal dos clientes finais do workspace, e a plataforma tende a ser operadora (Especificação §20). Áudio pode conter dado sensível.

- **[Em aberto]** Prazos de retenção por categoria: mensagens, áudios, transcrições e eventos brutos (pendência "Retenção e privacidade").
- A exclusão de conversa, de contato ou de workspace propaga para mensagens, transcrições, mídias no bucket e entregas. Dados que ficaram no provedor do canal (Chatwoot, Meta, Matrix) e no provedor de modelo seguem o contrato de cada um; isso precisa estar documentado, não prometido como apagado.
- Exportação das conversas do workspace e pedido de titular são processos distintos, conforme a §20.

## 14. Decisões necessárias

| ID      | Decisão                                                                                                                             | Recomendação                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| D-AG-01 | Camada de canais no núcleo, compartilhada com o chat interno                                                                        | **Decidido:** [ADR 0011](../../adr/0011-camada-de-canais-no-nucleo.md)          |
| D-AG-02 | SDK do agente                                                                                                                       | AI SDK; registrar em ADR                                                        |
| D-AG-03 | Relação agente × canal                                                                                                              | N:N por vínculo, um vínculo ativo por escopo                                    |
| D-AG-04 | Ordem dos canais na implementação                                                                                                   | Chatwoot (substitui o n8n), depois Matrix, Meta Cloud, chat interno e Evolution |
| D-AG-05 | Suporte à Evolution API apesar de ser não oficial                                                                                   | Só com aceite de risco por workspace                                            |
| D-AG-06 | Matrix: Application Service ou usuário bot, e suporte a salas com criptografia                                                      | Começar por usuário bot sem criptografia; criptografia em etapa própria         |
| D-AG-07 | Como o workspace define o schema JSON de saída                                                                                      | Schema versionado escolhido de um catálogo aprovado, não JSON livre             |
| D-AG-08 | Nova mensagem durante a entrega                                                                                                     | Em aberto                                                                       |
| D-AG-09 | Volta ao bot depois da transferência                                                                                                | Em aberto                                                                       |
| D-AG-10 | Quotas e comportamento ao esgotar                                                                                                   | Comercial e produto                                                             |
| D-AG-11 | Destino das tabelas do protótipo                                                                                                    | Evoluir por migrations compatíveis                                              |
| D-AG-12 | Resposta ao provedor quando o módulo está indisponível (aceitar e descartar com auditoria, ou recusar e deixar o provedor reenviar) | Aceitar e descartar com auditoria, para não acumular reenvios                   |
| D-AG-13 | Conversas abertas quando o dono de um escopo muda (encerrar, transferir ou migrar para o novo consumidor)                           | Em aberto                                                                       |

## 15. Critérios de aceite

1. Dois workspaces com o mesmo tipo de canal não veem conversas, vínculos nem conexões um do outro (Prisma e worker).
2. Um webhook duplicado não gera segundo turno, e um retry de entrega não duplica mensagem para o contato.
3. Uma queda do worker no meio da entrega retoma sem duplicar e sem perder as partes restantes.
4. Mensagens seguidas dentro da janela viram um único turno.
5. Áudio recebido é transcrito e respondido conforme `audioMode`; áudio fora do limite é recusado com mensagem segura.
6. A transferência no hub para o bot no próximo evento, e uma ação de atendente no hub também transfere.
7. Um segundo vínculo ativo no mesmo escopo é recusado pelo banco.
8. Política de saída incompatível com o canal é recusada na configuração.
9. Módulo indisponível, vínculo inativo ou quota esgotada bloqueia o processamento no worker.
10. Nenhum segredo de canal ou modelo aparece em log, erro, DTO ou saída.
11. Consumo e auditoria registrados para turnos, transferências e mudanças de configuração.

## 16. Migração da operação atual (n8n)

O Chatwoot entra primeiro por ser o caminho atual. A troca é feita por inbox: o Agent Bot de uma inbox passa a apontar para a plataforma, as demais continuam no n8n, e a qualidade das respostas é comparada antes de mover o restante. Instruções e regras de transferência dos fluxos atuais do n8n são copiadas para a configuração dos agentes pela equipe de operação; o módulo não as presume.
