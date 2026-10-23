# Mini-apps do guidu.chat e a ponte com o console

- **Status:** proposta para fechar com o Marcelo. Vira ADR (número sugerido: 0028) depois das respostas da seção 9.
- **Data:** 23/10/2026
- **Relaciona-se com:** [commerce do guidu.chat](commerce-guidu-chat.md), [ADR 0023](../adr/0023-chat-interno-como-cliente-matrix.md) (Matrix e JWT), [ADR 0026](../adr/0026-gateways-apisix-e-agentgateway.md) (gateways), [guiduchat-ui](https://github.com/smarthubaiagency/guiduchat-ui) (kit de UI).

## 1. O que estava registrado

Em 23/10/2026, a busca nos dois repositórios (código, documentos e histórico de commits) encontrou só isto:

- O README do `guiduchat-ui` diz: "Mini-apps servidos pelo console (`console.guidu.co`) e abertos dentro do guidu.chat", e que o kit é baseado no `@maxhub/max-ui` 0.7.0 (MIT), sem relação com o MAX Messenger.
- O `guiduchat-ui` é **só o kit de componentes visuais** (botões, painéis, temas iOS e Android). Ele não traz a ponte: o max-ui original também não tinha. No MAX, a ponte entre o app e o mini-app é uma biblioteca separada do kit de UI.
- No console, a palavra "bridge" aparece só no contexto do WhatsApp (o WA-Bridge do legado e o bridge do Matrix, já descartado). A proposta de 22/10 cita "mini-apps (QR checkout)" sem definir a conexão.

**Não há registro da ponte entre o guidu.chat e os mini-apps.** Este documento propõe esse registro, seguindo o padrão do MAX Bridge e do Telegram WebApp: o app hospedeiro abre o mini-app, entrega um contexto assinado e expõe um objeto JavaScript com métodos e eventos.

## 2. Peças

| Peça                        | O que é                                                                                                                                                                                     | Onde vive                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Hospedeiro**              | O guidu.chat (PWA e app nativo), que abre o mini-app dentro de uma conversa ou de um QR                                                                                                     | Repositório do guidu.chat                                               |
| **Mini-app**                | Página web servida pelo console, com a interface do `@guidu/ui`                                                                                                                             | Rotas públicas do console, num caminho próprio (seção 9, pergunta 1)    |
| **Ponte (`@guidu/bridge`)** | Biblioteca pequena com o objeto `window.Guidu`: contexto, métodos e eventos. O mesmo contrato no PWA (iframe com `postMessage`) e no app nativo (WebView com interface JavaScript injetada) | Pacote próprio ou dentro do `guiduchat-ui` (pergunta 2)                 |
| **Token de abertura**       | JWT curto e de uso único que diz quem abriu, onde e para quê                                                                                                                                | Emitido pelo servidor do guidu.chat, conferido pelo servidor do console |

## 3. Abertura e sessão

1. O turista toca num botão (por exemplo, "Pagar" depois do `checkout.ready`) ou lê um QR na loja.
2. O guidu.chat pede ao próprio servidor um **token de abertura**: assinatura assimétrica (ES256 ou RS256), `sub` do turista, `aud` = id do mini-app, contexto (`workspace` da loja, `room_id`, id do pedido ou do QR), `exp` de no máximo 5 minutos e `jti` de uso único.
3. O guidu.chat abre a URL do mini-app e entrega o token pela ponte, nunca na URL.
4. O mini-app manda o token ao servidor do console, que confere assinatura, `aud`, `exp` e `jti` e troca por uma **sessão própria do mini-app** (cookie `HttpOnly`, só naquele caminho, curta).
5. A partir daí, o mini-app chama o servidor do console. O servidor fala com o GUIDU e com o Vendure; o navegador nunca recebe a sessão do Supabase do turista nem um token da Admin API.

É o mesmo princípio do login Matrix da ADR 0023, regra 9: chave privada só no servidor, `exp` curto, nada de credencial longa no navegador.

## 4. Contrato da ponte (v1)

**Contexto, lido na abertura:** `version`, `platform` (`ios`, `android`, `web`), `colorScheme` (`light`, `dark`), `locale`, `safeArea` e o token de abertura. `platform` e `colorScheme` alimentam o `GuiduUI` do kit, para o mini-app ter a mesma cara do app.

**Métodos do mini-app para o hospedeiro:**

| Método                                       | Para quê                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ready()`                                    | Avisa que carregou (o hospedeiro tira o carregando)                                      |
| `close(result?)`                             | Fecha o mini-app, com um resultado opcional (por exemplo, `{ status: "paid", orderId }`) |
| `expand()`                                   | Pede tela cheia                                                                          |
| `backButton.show()`, `backButton.hide()`     | Controla o botão voltar do hospedeiro                                                    |
| `mainButton.set({ text, enabled, loading })` | Botão principal no rodapé do hospedeiro                                                  |
| `openLink(url)`                              | Abre um link fora do mini-app (só https)                                                 |
| `haptic(type)`                               | Vibração de confirmação, quando houver                                                   |
| `requestPhone()`, `requestLocation()`        | Pedem um dado ao turista, que sempre confirma no hospedeiro                              |

**Eventos do hospedeiro para o mini-app:** `themeChanged`, `backPressed`, `mainButtonPressed`, `visibilityChanged`.

**Regras do contrato:**

- Toda mensagem tem `version` e `type`. O lado que não conhece um `type` ignora (mesmo princípio do `channelContractVersion` da ADR 0011).
- Nenhuma decisão de dinheiro ou de permissão passa pela ponte. "Pago" só vale quando o servidor confirma o pagamento pelo retorno do provedor (Vendure). O `close({ status: "paid" })` serve só para a interface.
- Os eventos da conversa (pedido criado, pagamento confirmado) são postados na sala Matrix **pelo servidor**, nunca pelo mini-app.

## 5. Segurança

1. **Quem pode ser aberto.** O guidu.chat só abre mini-apps de um catálogo da plataforma (id, URL, permissões), e o console só serve mini-apps desse catálogo. Origem conferida nos dois lados do `postMessage`, sem `*`.
2. **Moldura (iframe).** Hoje o console responde `frame-ancestors 'none'` e `X-Frame-Options: DENY` em tudo (`src/core/security/headers.ts`). As rotas de mini-app precisam de exceção só para as origens do guidu.chat. O resto do console continua sem moldura.
3. **Token de abertura de uso único**, com `jti` gravado até expirar, para que um token copiado não abra outra sessão.
4. **Sessão do mini-app separada** da sessão do console: caminho, cookie e duração próprios. Um mini-app nunca acessa o `/app` do comerciante.
5. **Permissões do navegador** (câmera para QR, localização) liberadas só nas rotas de mini-app e só quando o mini-app declarou no catálogo. Hoje o `Permissions-Policy` do console desliga todas.
6. **Pelo APISIX** (ADR 0026): limite por IP e tamanho de corpo também nas rotas de mini-app.

## 6. Interface dos mini-apps

O `AGENTS.md` manda usar shadcn/ui em toda tela do console. Os mini-apps são a exceção: usam o `@guidu/ui`, para ter a cara do guidu.chat, como diz o README do kit. A exceção precisa entrar no `AGENTS.md` junto com a ADR, valendo só para as rotas de mini-app. As cores de marca dos dois kits ficam alinhadas.

## 7. Primeiro mini-app: checkout

Liga este documento ao [commerce do guidu.chat](commerce-guidu-chat.md):

1. O carrinho fica pronto: o agente publica `checkout.ready` na sala, ou o turista lê o QR da loja.
2. O guidu.chat abre o mini-app de checkout com o token de abertura (contexto: loja e pedido do Vendure).
3. O mini-app mostra o pedido (Shop API do Vendure, pelo servidor do console) e o pagamento. O pagamento é a aprovação humana.
4. O retorno do provedor confirma no Vendure. O servidor posta o evento na sala da loja, e o mini-app chama `close({ status: "paid", orderId })`.

## 8. Etapas sugeridas

| Etapa   | Entrega                                                                                                                                                                                                           | Depende de               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **MA0** | ADR 0028 com as respostas da seção 9 e a exceção de interface no `AGENTS.md`                                                                                                                                      | Marcelo                  |
| **MA1** | `@guidu/bridge` v1 (PWA com `postMessage`), catálogo de mini-apps, token de abertura e troca por sessão no console, exceção de moldura e permissões só nas rotas de mini-app; mini-app de teste com o `@guidu/ui` | MA0                      |
| **MA2** | Mini-app de checkout sobre o Vendure                                                                                                                                                                              | MA1, VC3 do commerce     |
| **MA3** | Ponte no app nativo (WebView) com o mesmo contrato                                                                                                                                                                | App nativo do guidu.chat |

## 9. Perguntas para o Marcelo

1. **Endereço dos mini-apps:** um caminho no console (`console.guidu.co/m/...`) ou um host próprio (`apps.guidu.chat`) apontando para o mesmo serviço? O host próprio separa cookies e regras de moldura do painel do comerciante (recomendado).
2. **Onde fica a ponte:** pacote separado (`@guidu/bridge`) ou dentro do `guiduchat-ui`?
3. **Servidor do guidu.chat:** quem emite o token de abertura? Um backend próprio do guidu.chat ou rotas do próprio GUIDU? Isso depende de onde ficam as contas dos turistas (commerce, seção 9, pergunta 4).
4. **App nativo:** com qual tecnologia (React Native, Capacitor, outra), para definir a injeção da ponte na WebView?
5. **Mini-apps de terceiros:** só nossos no início, ou parceiros também poderão publicar?
6. **Existe alguma referência do MAX Bridge guardada fora dos repositórios** (conversa, Figma, documento) que deva entrar aqui?
