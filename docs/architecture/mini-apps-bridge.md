# Mini-apps do guidu.chat e a ponte com o console

- **Status:** proposta para fechar com o Marcelo. Vira ADR (número sugerido: 0028) depois das respostas da seção 9.
- **Data:** 23/10/2026
- **Relaciona-se com:** [commerce do guidu.chat](commerce-guidu-chat.md), [ADR 0023](../adr/0023-chat-interno-como-cliente-matrix.md) (Matrix e JWT), [ADR 0026](../adr/0026-gateways-apisix-e-agentgateway.md) (gateways), [guiduchat-ui](https://github.com/smarthubaiagency/guiduchat-ui) (kit de UI).

## 1. Referência: o MAX Bridge

O `guiduchat-ui` é o fork do `@maxhub/max-ui` 0.7.0 (MIT). O kit é **só de componentes visuais** e não depende da ponte: ele detecta plataforma e tema pelo navegador, sem ler o app hospedeiro. No MAX, a ponte é outra peça, o **MAX Bridge**. Antes de 23/10/2026, isso não estava registrado em nenhum dos dois repositórios.

A referência está na organização [max-messenger](https://github.com/max-messenger), no repositório [`max-agents-skill`](https://github.com/max-messenger/max-agents-skill) (Apache-2.0), arquivo `references/mini-apps-bridge.md`, conferido com [dev.max.ru/docs/webapps/bridge](https://dev.max.ru/docs/webapps/bridge) em 21/09/2026. Em resumo:

- O mini-app é uma página web estática que roda **dentro de um bot do MAX**. Ele carrega `https://st.max.ru/js/max-web-app.js`, e o objeto `window.WebApp` aparece pronto, sem chamada de `init()` ou `ready()`.
- **`initData`**: texto assinado com `query_id`, `auth_date`, `user`, `chat` (onde foi aberto) e `start_param` (o `?startapp=` do link). O servidor do mini-app confere o `hash` por HMAC-SHA256 em duas etapas (chave derivada de `"WebAppData"` e do token do bot), com validade recomendada de 1 hora. O `initDataUnsafe` é a mesma coisa sem verificação e nunca serve para autenticar.
- **Métodos:** `BackButton`, `openLink` (só depois de um toque do usuário), `openMaxLink`, `requestContact` (telefone com `hash` próprio), `openCodeReader` (leitor de QR), `HapticFeedback`, `enableClosingConfirmation`, `getViewportSize`, `getLaunchContext`, `shareContent`, `shareMaxContent`, `downloadFile`, `DeviceStorage`, `SecureStorage` (até 10 chaves), `BiometricManager`, `NfcManager`, `ScreenCapture` e brilho máximo da tela.
- **Não existe** API de tema nem barramento de eventos: só o `BackButton.onClick`. O tema vem do kit de UI.
- O mini-app é cadastrado no bot (uma URL https) e aberto por um botão `open_app` no teclado do bot ou por link `https://max.ru/<bot>?startapp=<payload>` (até 512 caracteres, `A-Za-z0-9_-`).

**Decisão proposta:** a ponte do guidu.chat **copia o formato do MAX Bridge**, com os mesmos nomes e formas, para que a documentação do MAX, o `guiduchat-ui` e os mini-apps feitos no modelo do MAX sirvam de referência direta. As diferenças ficam marcadas como extensões Guidu.

## 2. Peças

| Peça                         | No MAX                                            | No guidu.chat                                                                                                                             |
| ---------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Hospedeiro**               | App do MAX                                        | guidu.chat (PWA e app nativo)                                                                                                             |
| **Quem abre o mini-app**     | Um bot, por botão `open_app` ou link `?startapp=` | Uma sala Matrix (botão num evento do agente ou da loja) ou um QR com link `?startapp=`                                                    |
| **Mini-app**                 | Página estática em qualquer host https            | Página servida pelo console, com o `@guidu/ui` (pergunta 1)                                                                               |
| **Ponte**                    | `max-web-app.js` → `window.WebApp`                | `@guidu/bridge` → `window.WebApp` com a mesma forma (pergunta 2). No PWA por iframe com `postMessage`; no app nativo, injetada na WebView |
| **Assinatura do `initData`** | HMAC com o token do bot                           | Assinada pelo servidor do guidu.chat (seção 3)                                                                                            |
| **Cadastro**                 | URL no bot, em business.max.ru                    | Catálogo de mini-apps da plataforma                                                                                                       |

## 3. Abertura e sessão

1. O turista toca no botão de um evento na sala (por exemplo, "Pagar" depois do `checkout.ready`) ou lê o QR da loja (`https://guidu.chat/<loja>?startapp=<payload>`).
2. O guidu.chat pede ao próprio servidor o **`initData`**, no formato do MAX: `query_id` (uso único), `auth_date`, `user` (o `sub` do turista, nome, idioma, foto), `chat` (o `room_id` e o tipo da sala) e `start_param` (loja, pedido ou QR).
3. **Diferença do MAX na assinatura:** em vez do HMAC com um segredo compartilhado, o servidor do guidu.chat assina com chave assimétrica (Ed25519 ou ES256), num campo `signature`. O console guarda só a chave pública. Um vazamento no console não permite forjar aberturas.
4. O mini-app manda o `initData` cru ao servidor do console, que confere a assinatura, um `auth_date` de no máximo 5 minutos (o MAX recomenda 1 hora; o nosso é mais curto porque serve só para abrir a sessão) e o `query_id` ainda não usado. Em seguida, troca por uma **sessão própria do mini-app** (cookie `HttpOnly`, só naquele host ou caminho, curta).
5. A partir daí, o mini-app chama o servidor do console, que fala com o GUIDU e com o Vendure. O navegador nunca recebe a sessão do Supabase do turista nem um token da Admin API. O `initDataUnsafe` serve só para mostrar nome e foto, nunca para autenticar.

É o mesmo princípio do login Matrix da ADR 0023, regra 9: chave privada só no servidor, validade curta, nada de credencial longa no navegador.

## 4. Contrato da ponte (v1)

| Membro do MAX Bridge                                                                | Guidu v1                                             | Uso no guidu.chat                                                                  |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `initData`, `initDataUnsafe`                                                        | **Adota** (assinatura própria, seção 3)              | Identidade e contexto da abertura                                                  |
| `platform`, `version`, `deviceName`                                                 | **Adota**                                            | `platform` alimenta o `GuiduUI`                                                    |
| `BackButton` (`show`, `hide`, `onClick`, `offClick`)                                | **Adota**                                            | Navegação dentro do mini-app                                                       |
| `openLink(url)`                                                                     | **Adota**, com a mesma exigência de toque do usuário | Links externos, só https                                                           |
| `openMaxLink(url)`                                                                  | **Adapta** como `openGuiduLink(url)`                 | Abrir outra sala, loja ou mini-app do guidu.chat                                   |
| `requestContact()`                                                                  | **Adota**, com `hash` assinado pelo servidor         | Telefone verificado do turista (commerce, seção 7)                                 |
| `openCodeReader(fileSelect?)`                                                       | **Adota**                                            | QR da loja, da mesa ou do produto                                                  |
| `HapticFeedback`                                                                    | **Adota** (só no app nativo)                         | Confirmação de pagamento e de leitura de QR                                        |
| `enableClosingConfirmation()`, `disableClosingConfirmation()`                       | **Adota**                                            | Evitar fechar no meio do checkout                                                  |
| `getViewportSize()`, `getLaunchContext()`                                           | **Adota**                                            | Layout e origem da abertura                                                        |
| `shareContent`, `shareMaxContent`                                                   | **Depois** (como `shareGuiduContent`)                | Compartilhar loja ou produto numa conversa                                         |
| `requestScreenMaxBrightness`, `restoreScreenBrightness`                             | **Depois**                                           | Mostrar ingresso ou comprovante em QR                                              |
| `downloadFile`                                                                      | **Depois**                                           | Comprovante ou nota                                                                |
| `DeviceStorage`, `SecureStorage`, `BiometricManager`, `NfcManager`, `ScreenCapture` | **Fora da v1**                                       | —                                                                                  |
| _(não existe no MAX)_ `close(result?)`                                              | **Extensão Guidu**                                   | Fechar e devolver um resultado à sala (por exemplo, `{ status: "paid", orderId }`) |
| _(não existe no MAX)_ `colorScheme`                                                 | **Extensão Guidu**                                   | O tema que o turista escolheu no guidu.chat, passado ao `GuiduUI`                  |

**Regras do contrato:**

- A ponte segue o formato do MAX: propriedades prontas na abertura, promessas que falham com `{ error: { code } }` e só o `BackButton` com assinatura de evento. Não há `ready()`.
- As mensagens internas (`postMessage` ou WebView) têm `version` e `type`. O lado que não conhece um `type` ignora (mesmo princípio do `channelContractVersion` da ADR 0011).
- Nenhuma decisão de dinheiro ou de permissão passa pela ponte. "Pago" só vale quando o servidor confirma o pagamento pelo retorno do provedor (Vendure). O `close({ status: "paid" })` serve só para a interface.
- Os eventos da conversa (pedido criado, pagamento confirmado) são postados na sala Matrix **pelo servidor**, nunca pelo mini-app.
- O botão que abre um mini-app numa sala é um evento próprio (por exemplo, `chat.guidu.open_app`, com o id do mini-app e o `start_param`), o equivalente ao botão `open_app` do MAX. Só o núcleo e os agentes publicam esse evento.

## 5. Segurança

1. **Quem pode ser aberto.** O guidu.chat só abre mini-apps de um catálogo da plataforma (id, URL, permissões), e o console só serve mini-apps desse catálogo. Origem conferida nos dois lados do `postMessage`, sem `*`.
2. **Moldura (iframe).** Hoje o console responde `frame-ancestors 'none'` e `X-Frame-Options: DENY` em tudo (`src/core/security/headers.ts`). As rotas de mini-app precisam de exceção só para as origens do guidu.chat. O resto do console continua sem moldura.
3. **`initData` de uso único**, com o `query_id` gravado até expirar, para que uma abertura copiada não gere outra sessão.
4. **Sessão do mini-app separada** da sessão do console: caminho, cookie e duração próprios. Um mini-app nunca acessa o `/app` do comerciante.
5. **Permissões do navegador** (câmera para o `openCodeReader` no PWA, localização) liberadas só nas rotas de mini-app e só quando o mini-app declarou no catálogo. Hoje o `Permissions-Policy` do console desliga todas.
6. **Pelo APISIX** (ADR 0026): limite por IP e tamanho de corpo também nas rotas de mini-app.

## 6. Interface dos mini-apps

O `AGENTS.md` manda usar shadcn/ui em toda tela do console. Os mini-apps são a exceção: usam o `@guidu/ui`, para ter a cara do guidu.chat, como diz o README do kit. A exceção precisa entrar no `AGENTS.md` junto com a ADR, valendo só para as rotas de mini-app. As cores de marca dos dois kits ficam alinhadas.

## 7. Primeiro mini-app: checkout

Liga este documento ao [commerce do guidu.chat](commerce-guidu-chat.md):

1. O carrinho fica pronto: o agente publica `checkout.ready` na sala, ou o turista lê o QR da loja.
2. O guidu.chat abre o mini-app de checkout com o `initData` assinado (`start_param` com a loja e o pedido do Vendure).
3. O mini-app mostra o pedido (Shop API do Vendure, pelo servidor do console) e o pagamento. O pagamento é a aprovação humana.
4. O retorno do provedor confirma no Vendure. O servidor posta o evento na sala da loja, e o mini-app chama `close({ status: "paid", orderId })`.

## 8. Etapas sugeridas

| Etapa   | Entrega                                                                                                                                                                                                             | Depende de               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **MA0** | ADR 0028 com as respostas da seção 9 e a exceção de interface no `AGENTS.md`                                                                                                                                        | Marcelo                  |
| **MA1** | `@guidu/bridge` v1 (PWA com `postMessage`), catálogo de mini-apps, `initData` assinado e troca por sessão no console, exceção de moldura e permissões só nas rotas de mini-app; mini-app de teste com o `@guidu/ui` | MA0                      |
| **MA2** | Mini-app de checkout sobre o Vendure                                                                                                                                                                                | MA1, VC3 do commerce     |
| **MA3** | Ponte no app nativo (WebView) com o mesmo contrato                                                                                                                                                                  | App nativo do guidu.chat |

## 9. Perguntas para o Marcelo

1. **Endereço dos mini-apps:** um caminho no console (`console.guidu.co/m/...`) ou um host próprio (`apps.guidu.chat`) apontando para o mesmo serviço? O host próprio separa cookies e regras de moldura do painel do comerciante (recomendado).
2. **Onde fica a ponte:** pacote separado (`@guidu/bridge`) ou dentro do `guiduchat-ui`?
3. **Servidor do guidu.chat:** quem assina o `initData`? Um backend próprio do guidu.chat ou rotas do próprio GUIDU? Isso depende de onde ficam as contas dos turistas (commerce, seção 9, pergunta 4).
4. **App nativo:** com qual tecnologia (React Native, Capacitor, outra), para definir a injeção da ponte na WebView?
5. **Mini-apps de terceiros:** só nossos no início, ou parceiros também poderão publicar?
6. **Nome do objeto global:** manter `window.WebApp`, igual ao MAX (mini-apps do modelo MAX rodam sem ajuste), ou usar `window.Guidu` com a mesma forma?
