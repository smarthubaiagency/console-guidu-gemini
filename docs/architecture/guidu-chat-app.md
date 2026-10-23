# App guidu.chat (React Native + Expo): conversa, mini-apps e agentes

- **Status:** proposta do gerente de projeto, 23/10/2026. A stack React Native + Expo foi decidida pelo Marcelo em 23/10/2026; o resto vira ADR depois da prova técnica (seção 6).
- **Relaciona-se com:** [ADR 0011](../adr/0011-camada-de-canais-no-nucleo.md) (canais), [ADR 0023](../adr/0023-chat-interno-como-cliente-matrix.md) (Matrix), [ponte dos mini-apps](mini-apps-bridge.md), [commerce](commerce-guidu-chat.md), [compra agêntica](agentes-na-matrix-e-compra-agentica.md), [visão v1.0](../spec/guidu-chat-visao-produto-v1.0.md).

## 1. O app e as três conversas que ele tem

```
                ┌──────────── App guidu.chat (Expo) ────────────┐
                │ telas nativas: login, conversas, QR, push,     │
                │ pagamento   +   WebView para os mini-apps      │
                └──────┬───────────────┬───────────────┬────────┘
          API do chat  │   Bridge      │   Login       │
                       ▼               ▼               ▼
              GUIDU (container web: API do chat, Bridge API, motor de IA)
                       │ Application Service
                       ▼
                    Synapse (salas)
```

## 2. Como o app conversa com o Matrix

| Caminho                                                              | Como funciona                                                                                                                                                                                                                                                        | A favor                                                                                                                                                                                                                                             | Contra                                                                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Cliente Matrix dentro do app**                                  | O app usa um SDK Matrix: o `matrix-js-sdk` (feito para navegador e Node; no React Native só com adaptações) ou o `matrix-rust-sdk` por bindings da comunidade (`@unomed/react-native-matrix-sdk`, versão 0.9, de dezembro de 2025), que exigem build próprio do Expo | É o desenho "puro" da ADR 0023 (dois clientes das mesmas salas); histórico e tempo real direto do Synapse                                                                                                                                           | SDK de comunidade, ainda jovem; cada turista abre uma conexão de sync no Synapse, que é o ponto mais pesado no pico; credencial Matrix no aparelho |
| **B. O guidu.chat como canal do núcleo** (recomendado para o piloto) | O app fala só com o GUIDU (API do chat + tempo real). O turista é um usuário virtual do Application Service (`@_guidu_t_…`), como o contato do WhatsApp já é na IN7a (`@_guidu_c_…`). O GUIDU grava na sala em nome dele e repassa ao app o que chega na sala        | Reaproveita o caminho que já funciona no WhatsApp (rota, GUIDS, tradução, Inbox); nenhuma credencial Matrix no aparelho; permissão e limite num lugar só (APISIX + GUIDU); a carga do pico fica no GUIDU, que escala por réplicas, e não no Synapse | O GUIDU passa a entregar mensagens em tempo real ao app (ver 2.1)                                                                                  |

**Recomendação:** B no piloto, com uma interface `ChatProvider` no app (o documento de visão já sugere isso). Se um dia o cliente Matrix direto valer a pena, ele troca a implementação sem mexer nas telas.

### 2.1 Tempo real no caminho B

1. **App aberto:** o app recebe as mensagens novas por uma conexão contínua com o GUIDU. A escolha entre Server-Sent Events e o Supabase Realtime (canal privado por turista, autorizado por RLS) sai da prova técnica.
2. **App fechado:** push pelo `expo-notifications` (APNs e FCM), enviado pelo worker quando chega mensagem na sala do turista.
3. **Ao abrir:** o app busca o que perdeu pela API do chat (paginação por `event_id`).

### 2.2 O que muda na ADR 0023

Regra 5 ("o console e o guidu.chat são dois clientes das mesmas salas"): continua verdade para as salas, mas o turista passa a falar pelo GUIDU, como o contato do WhatsApp. A sala continua a fonte da verdade. A tradução não muda: a sala recebe a mensagem no idioma do turista (traducao.md, 5.2).

## 3. Como o app conversa com os mini-apps

Tudo pela [ponte dos mini-apps](mini-apps-bridge.md), seção 11. No Expo:

| Peça                              | Biblioteca                                                                                                  | Papel                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| WebView                           | `react-native-webview`                                                                                      | Abre `apps.guidu.chat`; `originWhitelist` e `onShouldStartLoadWithRequest` bloqueiam qualquer outro endereço |
| Ponte                             | `onMessage` (mini-app → app) e `postMessage` (app → mini-app)                                               | Leva o envelope `guidu.*`; o app confere a URL de cada mensagem                                              |
| Telas nativas chamadas pela ponte | Conversa, pagamento, leitor de QR (`expo-camera`), vibração (`expo-haptics`)                                | O mini-app pede; o app executa com o token do turista                                                        |
| Links universais                  | `expo-router` + `apple-app-site-association` e `assetlinks.json` servidos em `apps.guidu.chat/.well-known/` | O QR abre o app quando instalado e a página no navegador quando não                                          |
| Sessão do turista                 | `expo-secure-store`                                                                                         | Guarda o token do turista no aparelho; nunca vai para o mini-app                                             |

## 4. BotCompara e BotShop no GUIDU

**Sim, ficam no GUIDU**, no motor de IA que já existe (`src/core/ai/`, ADR 0017), no mesmo container. São os agentes que os documentos chamam de **botmercado** (BotCompara, o agente do comprador) e do subagente de compras (BotShop).

|                    | BotCompara                                                                                         | BotShop                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Papel              | Conversa com o turista, entende o pedido, compara lojas e preços, recomenda                        | Subagente: monta o carrinho no Vendure em nome do turista                            |
| Ferramentas        | Só leitura: busca no canal marketplace do Vendure (preço e estoque) e no Portfólio (texto e fotos) | Só carrinho: ver produto, adicionar ao carrinho, pedir o checkout (`checkout.ready`) |
| Quem aciona        | O turista, na conversa com o guidu                                                                 | Só o BotCompara, por delegação interna (como o orquestrador e o vendedor da GF2)     |
| Chave de IA        | A nossa (agente da plataforma)                                                                     | A nossa                                                                              |
| Onde é configurado | Na área da plataforma (`/platform`), não no workspace do comerciante                               | Idem                                                                                 |
| Onde aparece       | Uma persona só para o turista ("guidu"), numa sala de conversa do turista com a plataforma         | Não aparece: trabalha por trás                                                       |

Regras que já valem e continuam valendo: preço e estoque só do banco (agora o Vendure), pagamento sempre pelo turista, ação externa só por proposta ou confirmação, um nível de delegação, orçamento de tokens por pedido.

O que é novo no núcleo: um tipo de agente da plataforma voltado ao consumidor (hoje há `assistant`, `guid` e `specialist`) e um tipo de sala, a do turista com o guidu (ao lado das salas de atendimento com cada loja).

## 5. Onde cada coisa mora

| Peça                                         | Onde                                   | Container                                                          |
| -------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| App guidu.chat                               | Lojas Apple e Google (Expo, EAS Build) | Nenhum                                                             |
| API do chat, Bridge API, BotCompara, BotShop | GUIDU                                  | Web do GUIDU (e o serviço `apps` separado antes da alta temporada) |
| Push, avisos e turnos dos agentes            | GUIDU                                  | Worker do GUIDU                                                    |
| Mini-apps                                    | `apps.guidu.chat`                      | Web do GUIDU                                                       |
| Salas                                        | Synapse                                | Synapse                                                            |
| Carrinho, pedidos                            | Vendure                                | Vendure                                                            |

## 6. Prova técnica antes de começar o app

1. Caminho B ponta a ponta: login do turista, sala com uma loja, mensagem nos dois sentidos com tradução, tempo real com o app aberto e push com o app fechado.
2. WebView com a ponte: abrir um mini-app, aperto de mão, `openChat` levando à tela de conversa.
3. Link universal: QR abre o app instalado e a página sem o app.
4. Teste rápido do caminho A (`@unomed/react-native-matrix-sdk` num build de desenvolvimento) só para registrar se ele é viável no futuro.
5. Medição: quantas conexões em tempo real um container web aguenta, para dimensionar o pico.

## 7. A janela de conversa do app e o Inbox

As duas não conversam entre si: são **as duas pontas da mesma sala**. A sala Matrix é a conversa; o Inbox é a janela da loja e o guidu.chat é a janela do turista.

|                      | Inbox (console)                                                            | Conversa no guidu.chat                                                            |
| -------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Quem usa             | Equipe da loja                                                             | Turista                                                                           |
| O que lista          | Todas as conversas da loja, com visões Minhas, Não atribuídas e Resolvidas | As conversas do turista: uma por loja e a do guidu (BotCompara)                   |
| Idioma               | Português, com "ver original"                                              | O idioma do turista; a sala já recebe a resposta traduzida (traducao.md, 5.2)     |
| O que só um lado vê  | Notas internas, etiquetas, responsável, sala de bastidor, resumo do GUIDS  | Cartões de produto, botões que abrem mini-apps, status da solicitação e do pedido |
| Como fala com a sala | Cliente Matrix no navegador do atendente (ADR 0023)                        | Pelo GUIDU, como usuário virtual (caminho B, seção 2)                             |

Uma mensagem de ida e volta:

1. O turista escreve em espanhol no app. O GUIDU grava na sala da loja em nome dele.
2. O GUIDS da loja responde, ou o Inbox mostra a mensagem em português a quem atende.
3. O atendente responde em português; a sala recebe a versão em espanhol.
4. O GUIDU entrega essa mensagem ao app (tempo real ou push).

**Modo loja (GC1, depois):** o mesmo app pode ter uma janela que funciona **como o Inbox**, para o comerciante atender pelo celular. É outra tela do app, com permissões de equipe, sobre as mesmas salas.
