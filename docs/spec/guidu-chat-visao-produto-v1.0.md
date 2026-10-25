# Guidu.chat: visão de produto, arquitetura e casos de uso (v1.0)

> Cópia em Markdown do documento `Guidu_Chat_Visao_Produto_Arquitetura_e_Casos_de_Uso.docx` (versão 1.0, 21/10/2026), enviado pelo Marcelo em 23/10/2026. É proposta de arquitetura e requisitos, não decisão: onde conflita com ADR ou com o código, vale o que diz a [análise deste documento](../architecture/analise-visao-guidu-chat.md).

Documento de referência • Produto, casos de uso, arquitetura multicanal e plano de implementação

Versão 1.0 \| 21 de outubro de 2026 \| Mercado-piloto: Armação dos Búzios, RJ

**Tese central.** O Guidu.chat conecta descoberta física, mini apps, conversas multilíngues, agentes especializados e um checkout reutilizável em diversos estabelecimentos, preservando o isolamento operacional de cada comerciante.

Status do documento: proposta de arquitetura e requisitos baseada nas capacidades relatadas pelo responsável pelo produto. Não é uma auditoria do código nem afirma que componentes ainda planejados estejam prontos.

# Sumário executivo

- 1\. O que é o Guidu.chat e qual problema resolve

- 2\. Atores, fronteiras do produto e funcionalidades

- 3\. Jornadas e catálogo de casos de uso

- 4\. Experiência: app nativo, Web e cinco mini apps

- 5\. Arquitetura-alvo e stack tecnológica

- 6\. Mini App Bridge: protocolo, SDK e segurança

- 7\. Matrix, WhatsApp, tradução e agentes

- 8\. Checkout compartilhado e identidade

- 9\. Organização do monorepo e contratos

- 10\. Dados, isolamento, LGPD e segurança

- 11\. Roadmap, critérios de aceite e testes

- 12\. Indicadores, riscos, decisões e fontes

# 1. O que é o Guidu.chat

Guidu.chat é o aplicativo voltado ao consumidor — inicialmente turistas e moradores de Búzios — para descobrir, conversar, solicitar e futuramente pagar por produtos e serviços de estabelecimentos locais. O aplicativo integra experiências digitais contextualizadas por QR Code ou NFC, conversas via Matrix e WhatsApp, atendimento multilíngue com IA e atendentes humanos, e um checkout unificado da rede.

O Console do Comércio é o ambiente administrativo dos lojistas, implementado em Next.js. Ele gerencia portfólio, contatos, agentes de IA e Inbox. O Guidu.chat é o canal de relacionamento e consumo; mini apps são superfícies transacionais leves publicadas pelos comerciantes e apresentadas no Guidu.chat ou no navegador.

## 1.1 Posicionamento e proposta de valor

- Para o turista: entrar por um QR Code, ver o item exato, conversar em seu idioma, ser atendido de forma contínua e, no futuro, pagar com uma credencial reutilizável.

- Para o comerciante: publicar portfólio e mini apps, responder em português independentemente do idioma do turista, usar agentes com sua própria chave de API (BYOK) e acompanhar pedidos/solicitações pelo Console.

- Para a plataforma: distribuir um padrão único de descoberta, atendimento e pagamento sem compartilhar bases comerciais entre lojistas.

## 1.2 Princípios invariantes

- Um comerciante não pode consultar produtos, contatos, pedidos nem conversas de outro por padrão.

- A identidade do turista e sua autorização de pagamento são globais, mas o acesso dos comerciantes é estritamente contextual.

- O agente principal conversa; os subagentes são acionados internamente e executam somente ferramentas autorizadas.

- A mensagem original e suas traduções são preservadas de forma controlada; o comerciante atende em português.

- A IA não é fonte de verdade para estoque, agenda, preço final nem confirmação financeira.

- O checkout é da rede Guidu.chat; o recebimento financeiro pode permanecer diretamente na conta de cada lojista, dependendo do PSP.

# 2. Atores e estado atual

| **Ator**            | **Acesso e papel**                                                                |
| ------------------- | --------------------------------------------------------------------------------- |
| Turista/consumidor  | App Guidu.chat Android/iOS/Web; QR, chat, mini apps e futuro checkout.            |
| Comerciante         | Console Next.js: portfólio, agentes IA, contatos, configuração.                   |
| Atendente           | Inbox do estabelecimento; atendimento em português e handoff.                     |
| Agente principal    | Atendimento com contexto da sessão e do item; responde ao consumidor.             |
| Subagentes          | Consultas especializadas (estoque, reservas, pagamento etc.) em execução interna. |
| Provedor financeiro | Tokenização, antifraude, autenticação e liquidação, conforme contrato.            |

## 2.1 Matriz de maturidade

| **Capacidade**                   | **Condição informada**                   | **Diretriz**                                          |
| -------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| Console Next.js                  | Existente                                | Preservar como backoffice/fonte administrativa.       |
| Portfólio com fotos, textos e QR | Existente                                | Adotar IDs e publicação de versões.                   |
| Agentes com chave do lojista     | Existente / modelo operacional informado | Cofre de credenciais e orçamento por estabelecimento. |
| Matrix, WhatsApp, Inbox          | Existente / integração informada         | Validar fluxos reais e E2EE.                          |
| Tradução turista↔português       | Existente / informada                    | Tradução por participante e original íntegro.         |
| Mini apps                        | Interface disponível                     | Construir runtime, Bridge e solicitações.             |
| Pedidos, estoque e reservas      | Integrações não definidas                | Começar por solicitação assistida.                    |
| Checkout da rede                 | Visão futura                             | Selecionar PSP com token compartilhável.              |
| App Android/iOS/Web              | Stack ainda não definida                 | Recomendação de implementação neste documento.        |

# 3. Jornadas centrais

## 3.1 Descoberta e atendimento contextual

1.  Turista lê QR Code de produto, vitrine, mesa, quarto ou serviço; abre URL HTTPS universal.

2.  Resolver link público para merchantId e portfolioItemId; apresentar mini app mesmo sem instalar aplicativo.

3.  Se Guidu.chat estiver instalado, oferecer continuidade via universal/app link, sem obrigar instalação para catálogo público.

4.  Ao abrir Conversar, autenticar quando necessário e criar/recuperar conversa associada ao comerciante; adicionar contexto do item.

5.  Agente principal atende no idioma preferido; subagentes consultam fontes do comerciante sob autorização.

6.  Atendente humano assume no Inbox em português, preservando histórico e links ao item.

## 3.2 Solicitação comercial antes do checkout

Cliente solicita reserva, disponibilidade ou orçamento. A plataforma cria um registro estruturado com merchantId, item, variante, quantidade, status, prazo e sala relacionada. O comerciante confirma manualmente; o turista recebe notificação no idioma escolhido. Não chamar isso de pedido pago nem de estoque reservado sem confirmação operacional.

## 3.3 Compra com credencial compartilhada (futura)

Após implantação do serviço de pedidos e escolha do parceiro financeiro, o checkout global recupera token de pagamento consentido e processa pagamento em conta do comerciante indicado. O provedor confirma via callback/webhook validado; o sistema atualiza pedido e gera comprovante. Passkeys/biometria autenticam o usuário, mas não dispensam controles do emissor ou PSP.

# 4. Catálogo de casos de uso do Guidu.chat

Códigos UC para mapear requisitos, telas, permissões, instrumentação e testes. Ação “manual” denota solicitação/encaminhamento pelo Inbox; a ação “automática” dependerá de adaptadores operacionais futuros.

| **ID** | **Caso**                         | **Segmento**         | **Jornada resumida**                                                            |
| ------ | -------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| UC-01  | Vitrine inteligente              | Boutique             | QR de item → detalhes → chat → verificação manual → reserva para retirada.      |
| UC-02  | Consultoria de produto           | Joalheria/artesanato | História, variações e combinações; sugestão de itens do próprio comerciante.    |
| UC-03  | Seleção de tamanhos              | Moda praia           | Preferências → recomendações → solicitação de prova/retirada.                   |
| UC-04  | Entrega posterior                | Souvenirs            | Compra/solicitação com retirada ou entrega futura; frete depende de integração. |
| UC-05  | Cardápio contextual              | Restaurante          | QR da mesa → fotos e ingredientes → IA → pedido assistido.                      |
| UC-06  | Reserva gastronômica             | Restaurante          | Horário e ambiente → consulta de disponibilidade → pré-reserva.                 |
| UC-07  | Fila de espera                   | Bar/restaurante      | QR de entrada → solicitação de fila → avisos por chat; estimativa operacional.  |
| UC-08  | Retirada agendada                | Café/padaria         | Escolha de itens → solicitação de preparo → retirada programada.                |
| UC-09  | Passeio náutico                  | Turismo              | Roteiro → perguntas multilíngues → pré-reserva → futuro pagamento.              |
| UC-10  | Locação de praia                 | Equipamentos         | Tipo, período e disponibilidade → solicitação → contrato futuro.                |
| UC-11  | Mergulho orientado               | Atividades           | Explicações, requisitos e encaminhamento para profissional habilitado.          |
| UC-12  | Locação de veículos              | Mobilidade           | Modelo → requisitos → pré-reserva com validação de documentos.                  |
| UC-13  | Concierge de quarto              | Pousada              | QR do quarto → demanda → conversa → recepção/serviço responsável.               |
| UC-14  | Upsell de hospedagem             | Pousada              | Upgrade, pacote romântico ou late checkout → consulta e solicitação.            |
| UC-15  | Spa e bem-estar                  | Serviços             | Portfólio → escolha do profissional → agendamento futuro.                       |
| UC-16  | Salão/barbearia                  | Beleza               | Fotos e serviços → conversa → pedido de horário.                                |
| UC-17  | Lista de compras                 | Mercado              | Consumidor descreve lista → correspondência ao catálogo → separação/delivery.   |
| UC-18  | Orçamento de fotógrafo           | Serviços             | Portfólio → briefing → proposta → negociação humana.                            |
| UC-19  | Experiência em outro idioma      | Todos                | Turista escreve em espanhol/inglês; lojista responde em português.              |
| UC-20  | Handoff com contexto             | Todos                | Agente encaminha à pessoa com histórico e produto sem perguntar tudo de novo.   |
| UC-21  | Pagamento recorrente entre lojas | Rede Guidu           | Mesmo perfil e token consentido em lojistas independentes (futuro).             |
| UC-22  | Histórico e comprovantes         | Rede Guidu           | Consumidor vê compras por loja; cada lojista só vê as suas.                     |
| UC-23  | Contato via NFC                  | Profissional/loja    | Cartão inteligente abre perfil e mini app do estabelecimento.                   |
| UC-24  | Pós-atendimento                  | Todos                | Mensagem de atualização de solicitação, retirada ou cancelamento com opt-in.    |

## 4.1 Primeiro piloto recomendado

Selecionar boutique, restaurante e pousada para cobrir três situações de QR (produto, mesa, quarto), duas modalidades de atendimento (venda e serviço) e idiomas estrangeiros. Para cada estabelecimento: publicar perfil, 10–30 itens reais, um QR contextual, agente principal, Inbox e fluxo de solicitação confirmado manualmente.

# 5. Experiência e mapa de telas

| **Tela**                     | **Função**                                        | **Reutilização**             |
| ---------------------------- | ------------------------------------------------- | ---------------------------- |
| 01 — Home do estabelecimento | Identidade, destaques, categorias e chat          | Todos os segmentos           |
| 02 — Portfólio               | Grade/lista, filtros, disponibilidade informativa | Produtos e serviços          |
| 03 — Detalhes                | Fotos, variantes, CTA contextual, QR deep link    | Item, prato, passeio, quarto |
| 04 — Chat contextual         | Matrix + IA + tradução + humano                   | Global                       |
| 05 — Solicitação             | Resumo, formulário e estado do atendimento        | Pré-reserva e orçamento      |
| 06 — Checkout global         | Pedido validado, método salvo, confirmação        | Futuro, todas as lojas       |
| 07 — Comprovante             | Status confirmado, retirada, histórico            | Futuro, todas as lojas       |

A navegação não deve obrigar o usuário a passar pela Home: o QR individual abre diretamente os detalhes. Na fase piloto, as telas 03, 04 e 05 formam o percurso demonstrável mínimo.

## 5.1 Aplicativo nativo vs WebView

O shell principal do Guidu.chat deve ser nativo (React Native + Expo): autenticação, lista de conversas, timeline do chat, notificações, QR scanner, navegação, histórico e carteira. Os mini apps publicados no Console são páginas Web responsivas em Next.js e entram por WebView (Android/iOS). No navegador, renderizar diretamente o runtime Next.js ou, quando houver isolamento entre origens, iframe com postMessage estritamente validado.

A compra não ocorre em uma página arbitrária do lojista: a Bridge solicita a abertura de uma tela financeira própria do Guidu.chat, ligada ao pedido validado no servidor.

# 6. Stack e decisões tecnológicas

| **Camada**          | **Recomendação**                                          | **Justificativa**                                     |
| ------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| Android/iOS         | React Native + Expo, TypeScript, Expo Router              | UI nativa e ecossistema alinhado ao Next.js.          |
| Chat Web            | Next.js (aplicação própria)                               | Boa compatibilidade com Matrix JS SDK e Web APIs.     |
| Console do Comércio | Next.js existente                                         | Preservar investimentos e módulos.                    |
| Mini apps           | Next.js, React e templates                                | URLs públicas, SEO quando fizer sentido e WebView.    |
| Mini App Bridge     | SDK TypeScript + APIs backend                             | Contrato portátil entre app, mini apps e serviços.    |
| Comunicação         | Matrix + gateway WhatsApp existente                       | Persistência de sala e canais; avaliar E2EE.          |
| Identidade          | OIDC/OAuth 2.1 compatível + PKCE; sessões curtas          | Conta global do turista; isolamento por lojista.      |
| Dados               | PostgreSQL/Supabase por domínio, Redis opcional           | Identidade, solicitações, sessões, pedidos e eventos. |
| Pagamentos          | PSP com contas de vendedores e tokens reutilizáveis       | Evitar guarda de cartão e liquidação própria.         |
| Notificações        | APNs/FCM via expo-notifications ou integração equivalente | Eventos de chat e solicitações; Web separado.         |

**Alternativa para Web.** Expo Router também pode fornecer UI Web em código compartilhado, mas para o Guidu.chat eu priorizaria uma aplicação Web Next.js independente, compartilhando pacotes de domínio, SDK e design tokens. Evitar adaptação não oficial de Next.js como runtime universal para nativo.

## 6.1 Critérios para reconsiderar Flutter

Flutter seria preferível caso a equipe tivesse forte experiência Dart, exigisse um único renderer visual multiplataforma ou adotasse um SDK Matrix Dart compatível com as exigências do projeto. A decisão por React Native é estratégica, não uma afirmação de superioridade universal.

## 6.2 Matrix: prova técnica obrigatória

O matrix-js-sdk declara suporte a Node.js e navegadores; sua execução completa em React Native não deve ser presumida. Antes de congelar a stack de chat móvel, validar login, sync, histórico, mensagens, anexos, background, push, salas, controle de acesso e criptografia. Alternativas: adapter nativo baseado em Matrix Rust SDK ou gateway de chat backend, com análise explícita de E2EE e confiança. A camada do app deve ocultar essas alternativas por trás de uma interface ChatProvider.

# 7. Mini App Bridge — desenho detalhado

“Bridge” aqui significa o protocolo entre mini app Web e aplicativo hospedeiro, distinto de uma bridge Matrix↔WhatsApp. Não duplicar os endpoints de portfólio: o Console publica dados; o runtime consulta APIs de leitura e a Bridge resolve sessão, contexto e capacidades.

## 7.1 Componentes

- Mini App Registry: merchantId, miniAppId, slug, versão publicada, template, capabilities, política de origem, status.

- Mini App Runtime: site responsivo que renderiza templates e recebe contexto publicado pela API.

- Bridge API: emite sessões de curta duração, autoriza ações e coordena chat/solicitação/checkout.

- Bridge SDK (Web): getContext, openChat, createRequest, openCheckout, close, subscribe; mensagens versionadas.

- Host Adapter (Expo): WebView, verificação de origem e navegação, roteamento para código nativo.

- Host Adapter (Web): iframe postMessage ou chamada direta para runtime mesma origem.

## 7.2 Envelope de mensagem sugerido

Exemplo lógico (não contrato implementado):

{ v: 1, id: "uuid", type: "guidu.openChat", sessionId: "...", payload: { itemId: "..." } }

Resposta: { v: 1, id: "uuid", type: "guidu.result", ok: true, payload: {...} }. Cada requisição deve possuir timeout, allowlist de métodos, validação Zod e prevenção de replay. Não confiar no merchantId, preço ou URL enviados pelo conteúdo Web.

## 7.3 Capacidades V1 e futuras

| **Método SDK**              | **Fase** | **Comportamento**                                                |
| --------------------------- | -------- | ---------------------------------------------------------------- |
| getContext()                | V1       | Retorna comerciante, item público, idioma e capacidades mínimas. |
| openChat(itemId, intent)    | V1       | Servidor valida item; encontra/cria sala autorizada.             |
| createRequest(itemId, qty)  | V1       | Cria solicitação pendente com registro estruturado.              |
| close()                     | V1       | Retorna ao app e preserva estado anterior.                       |
| openCheckout(orderId)       | Futura   | Checkout global recebe ID e busca preço no servidor.             |
| getPaymentStatus(paymentId) | Futura   | Status confirmado pela API do pagamento.                         |

## 7.4 Fluxo de inicialização do mini app

7.  Leitura do link público e resolução do mini app; visitante pode navegar sem autenticação.

8.  No aplicativo autenticado, host solicita bridgeSession no backend com escopo e nonce de uso único.

9.  WebView navega para origem permitida em HTTPS; a sessão não deve ficar em URL persistente.

10. Handshake de versão/capabilities com autenticação da origem da página e vínculo da sessão.

11. Ações posteriores usam validação server-side do usuário, comerciante e objeto.

12. Expiração, logout, revogação e erro de rede devem devolver estado seguro e oferecer retry.

## 7.5 Contexto comercial persistente

Guardar no backend: sourceType (qr, nfc, link, chat), merchantId, portfolioItemId, variantId opcional, idioma, conversationId e roomId autorizado. Evitar PII e dados financeiros em eventos públicos. Atualizações do contexto devem ser rastreadas; ao passar da WebView ao chat, o agente consulta os dados atuais do item, não apenas o snapshot recebido.

# 8. Matrix, WhatsApp, idiomas e agentes

## 8.1 Conceito de conversa

Cada atendimento corresponde a uma conversa lógica associada a uma sala Matrix segundo a regra operacional informada. O mapeamento entre conversa e sala deve ser persistido e idempotente; a mesma visita não pode abrir várias salas por taps duplicados. Conversas em WhatsApp exigem um vínculo explícito com canal, participantes e permissões.

## 8.2 Tradução por participante

- Armazenar mensagem original e idioma original; traduções derivadas por destinatário ou idioma.

- Turista vê sua conversa no idioma selecionado; atendente vê conteúdo em português.

- O agente principal utiliza contexto normalizado, preservando números, preços, datas, nomes e entidades do produto.

- Marcar tradução quando apropriado, permitir acesso autorizado ao original e corrigir ambiguidades.

- Estabelecer política de retenção e base legal para tradução, IA e integrações de terceiros.

## 8.3 BYOK e agentes

Cada comerciante traz sua chave de API de LLM e paga diretamente ao provedor de IA. O backend mantém credenciais criptografadas por merchantId e impede uso cruzado. A orquestração mantém agente principal e subagentes internos (catálogo, disponibilidade, reservas, pagamentos), com controles de ferramentas, auditoria e limites configurados. A tradução pode consumir a mesma chave, mediante explicitação de custos e fallback quando a chave estiver indisponível.

## 8.4 Segurança dos canais

Se as mensagens forem processadas por servidor para tradução ou IA, a arquitetura deve declarar onde ocorre a descriptografia. Não prometer E2EE ponta a ponta entre humanos quando um serviço intermediário consegue ler conteúdo. Segregar bots, operadores e consumidores por papéis, tokens e políticas de acesso.

# 9. Checkout global Guidu

A visão é um único checkout com identidade global e reutilização consentida de meios de pagamento em estabelecimentos jurídicos independentes. Isto não significa um único caixa ou compartilhamento irrestrito de dados entre lojas.

## 9.1 Componentes financeiros

- Global Customer Identity: conta do turista e consentimentos para credenciais.

- Merchant Payment Account: identificador da conta do comerciante no PSP, onboarding/KYC conforme parceiro.

- Payment Method Reference: token emitido pelo PSP, escopo aprovado e vínculo à identidade global.

- Order Service: valor e itens recalculados no servidor, estados e idempotência.

- Checkout UI: confirmação de estabelecimento, item, moeda, impostos/taxas e meio de pagamento.

- PSP Webhooks: assinatura verificada, reconciliação, estorno, disputa e comprovante.

## 9.2 Fluxo e decisões

No primeiro pagamento: coletar e tokenizar informações pelo PSP com consentimento específico. Em compras seguintes: listar referências permitidas, validar usuário e autenticar a ação. Para lojas diferentes, o token precisa ser reutilizável entre connected accounts de modo explicitamente suportado pelo PSP; split de pagamento isoladamente não basta.

Passkeys (WebAuthn/FIDO2) são recomendadas para autenticação forte da conta; Face ID e biometria Android são mecanismos locais do autenticador. Isso não substitui desafios 3DS/SCA e validações do adquirente. Em WebView, os fluxos de passkey/carteiras dependem da plataforma e precisam de teste em aparelho físico; pode ser necessário abrir checkout em contexto seguro externo ou fluxo nativo.

## 9.3 Abordagem regulatória

Priorizar recebimento direto do lojista no PSP, com comissão da plataforma apenas quando contratualmente prevista. Validar LGPD, PCI DSS em escopo apropriado, normas do Banco Central, papéis de marketplace/subcredenciador e contratos de PSP com assessoria jurídica. A plataforma não armazena PAN/CVV nem biometria.

# 10. Organização modular do código

Monorepo sugerido (não pressupõe que a estrutura já exista):

- apps/commerce-console — Next.js administrativo existente

- apps/guidu-mobile — Expo + React Native (Android/iOS)

- apps/guidu-web — Next.js para consumidor no navegador

- apps/miniapp-runtime — Next.js público e templates

- apps/bridge-api — serviço Node/TypeScript ou módulo backend isolado inicialmente

- packages/miniapp-sdk — contrato Web e adaptadores

- packages/miniapp-contracts — schemas Zod versionados

- packages/miniapp-ui — componentes React de catálogo e solicitações

- packages/chat-domain — interfaces de sala, mensagem e tradução

- packages/commerce-client — cliente tipado das APIs comerciais

- packages/design-tokens — cores, tipografia, dimensões e componentes básicos

- packages/identity-contracts — conta global e vínculo de comerciante

## 10.1 Organização dos módulos do Console

Um módulo Mini Apps no Console deve gerar menus administrativos, páginas de configuração, publicação e preview utilizando o framework de módulos já adotado. Cada estabelecimento gerencia templates, coleções e links QR; o pacote de UI do runtime é compartilhado e publicado de forma independente do backoffice.

## 10.2 Contratos de API mínimos

| **Endpoint lógico**           | **Acesso**                      | **Função**                                     |
| ----------------------------- | ------------------------------- | ---------------------------------------------- |
| GET /public/miniapps/:slug    | Público                         | Manifest publicado e capacidades sem segredos. |
| GET /public/portfolio/:itemId | Público                         | Detalhes publicados do item autorizado.        |
| POST /bridge/sessions         | Autenticado                     | Sessão curta vinculada a usuário e host.       |
| POST /conversations/open      | Autenticado                     | Sala Matrix idempotente e contexto.            |
| POST /requests                | Autenticado ou fluxo verificado | Solicitação estruturada.                       |
| POST /orders                  | Futuro, autenticado             | Pedido persistido por comerciante.             |
| POST /checkout/sessions       | Futuro, autenticado             | Sessão de pagamento via PSP.                   |
| POST /psp/webhook             | Futuro, assinatura validada     | Atualização transacional.                      |

# 11. Modelo de dados de referência

| **Entidade**       | **Campos-chave e regra**                                            |
| ------------------ | ------------------------------------------------------------------- |
| Merchant           | id, status, settings; tenant isolado.                               |
| MiniApp            | id, merchantId, template, version, publishedAt, capabilities.       |
| MiniAppEntryPoint  | id, merchantId, itemId?, sourceType, qrSlug.                        |
| ConsumerIdentity   | id global, preferredLocale, accountStatus.                          |
| MerchantContact    | merchantId, consumerId?, consent, vínculo local.                    |
| Conversation       | id, merchantId, consumerId, matrixRoomId, status, itemContext.      |
| Translation        | messageId, sourceLocale, targetLocale, content, modelMetadata.      |
| CommercialRequest  | id, merchantId, itemId, quantity, status, requestedAt.              |
| Order / Payment    | Futuro: snapshot de preço, currency, PSP refs, states, idempotency. |
| PaymentMethodToken | Futuro: consumerId, providerRef, scope, consent; sem PAN/CVV.       |

O isolamento é obrigatório em todas as consultas, incluindo chaves compostas e verificações do backend. Um UUID global de consumidor não concede ao comerciante acesso aos dados de outros tenants.

# 12. Roadmap de implantação

| **Etapa**                 | **Entregável**                                            | **Critério de aceite**                                  |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| 0 — Discovery técnico     | PoC Matrix mobile, WebView, deep links, permissões        | Funciona em Android, iOS e Web, com cenário de falha.   |
| 1 — Núcleo Guidu          | Login, sala, Inbox, tradução e 3 mini apps                | QR item → sala contextual → atendente em português.     |
| 2 — Solicitação           | Templates completos, formulário, histórico e notificações | Solicitação persistida e confirmação humana auditável.  |
| 3 — Piloto comercial      | Boutique, restaurante, pousada com dados reais            | Métricas de funil e estabilidade acompanhadas.          |
| 4 — Transações            | Pedidos, PSP, checkout e comprovantes                     | Reconciliar pagamento/estorno sem inconsistência.       |
| 5 — Credencial de rede    | Token consentido entre comerciantes                       | Compra recorrente em dois lojistas, com reautenticação. |
| 6 — Integrações avançadas | ERP, agendas, reservas, dashboards                        | Operação idempotente e monitorada em escala.            |

## 12.1 Matriz mínima de testes

- QR público abre item sem instalar o app; deep link preserva merchantId e itemId.

- Navegação entre detalhes, chat e solicitação conserva o contexto ao voltar.

- Usuário de uma loja não lê sala, contatos, pedidos ou produtos privados de outra.

- Uma ação repetida por rede instável não duplica sala, solicitação, pedido nem cobrança.

- Mensagem em espanhol aparece traduzida em português no Inbox; resposta retorna em espanhol.

- Falha do LLM BYOK não interrompe acesso humano nem expõe segredo.

- Token de sessão WebView expira; URLs de origem não permitida são bloqueadas.

- Notificações conduzem à conversa correta com autenticação prévia.

- Checkout recalcula total e comerciante no backend; webhooks repetidos são idempotentes.

- Face ID/passkey é validado em dispositivos reais, incluindo fallback sem biometria.

- Limites de acessibilidade, performance, conexão ruim, offline e retomada são testados.

## 12.2 Indicadores de negócio e engenharia

| **Categoria** | **Métricas**                                                                  |
| ------------- | ----------------------------------------------------------------------------- |
| Aquisição     | QR scans únicos, aberturas do mini app, origem por estabelecimento.           |
| Engajamento   | Detalhes→chat, mensagens, idiomas, uso de atendente humano.                   |
| Conversão     | Chat→solicitação, confirmação de solicitação, solicitação→pagamento futuro.   |
| Qualidade     | Latência P50/P95, tradução corrigida, falha de handshake, erro de sala.       |
| Financeiro    | GMV, conversão de checkout, pagamento recorrente, chargebacks, reconciliação. |
| Comerciante   | Ativos, portfólio publicado, tempo de resposta, retenção.                     |

## 12.3 Riscos e mitigação

| **Risco**                          | **Mitigação**                                                             |
| ---------------------------------- | ------------------------------------------------------------------------- |
| SDK Matrix no RN e E2EE            | PoC antes do congelamento; adapter intercambiável e decisão de confiança. |
| WebView e permissões               | Origem fixa, whitelist, sandbox, sessões curtas, sem segredo no JS.       |
| Credencial reutilizável multi-loja | Prova comercial/técnica com PSP e contas reais em sandbox.                |
| Políticas das lojas                | Revisão de mini apps, moderação, privacidade e regras de bens físicos.    |
| Qualidade da tradução              | Original preservado, correção, contextos críticos e avaliação humana.     |
| Comerciante sem ERP                | Fluxo assistido antes de transação automática.                            |
| Sazonalidade e conectividade       | Medição de pico, cache, reintentos, telas de falha elegantes.             |

## 12.4 Decisões ainda abertas

- Qual homeserver Matrix e qual política de E2EE para atendimentos mediados por IA/tradução?

- O Guidu Web será uma aplicação própria Next.js ou uma UI universal Expo Web? Recomendação atual: Next.js.

- Qual identidade (OIDC provider), vínculo de visitante anônimo e estratégia de migração para login?

- Qual PSP comprova token compartilhado entre vendedores independentes no Brasil?

- Quais eventos entram na sala Matrix e quais ficam exclusivamente nos serviços comerciais?

- Qual política de retenção de conversas, traduções, consentimentos e recibos?

- Qual política comercial de cobrança SaaS, uso de infraestrutura e comissões?

# 13. Orientação para implementação assistida por IA

Organizar o trabalho em especificações isoladas e verificáveis: Contexto → Objetivo → Requisitos → Contratos → Segurança → Plano → Testes → Critérios de aceite. Antes de cada pacote, o agente de desenvolvimento deve ler contratos existentes, implementar alterações pequenas e apresentar evidências de testes. Qualquer alteração de schema ou SQL remoto exige revisão e execução manual do responsável, conforme prática operacional definida.

Ordem de tarefas recomendada: (1) monorepo e contratos; (2) runtime de detalhe público; (3) host Expo WebView e handshake; (4) abertura da sala; (5) contexto, tradução e handoff; (6) solicitações; (7) testes e telemetria; (8) fluxo financeiro apenas após PSP selecionado.

# 14. Referências técnicas oficiais

Expo Router — https://docs.expo.dev/router/introduction/

React Native WebView no Expo — https://docs.expo.dev/versions/latest/sdk/webview/

Expo SecureStore — https://docs.expo.dev/versions/latest/sdk/securestore/

Expo Push Notifications — https://docs.expo.dev/push-notifications/overview/

Expo com Next.js — ressalvas — https://docs.expo.dev/guides/using-nextjs/

Matrix — catálogo de SDKs — https://www.matrix.org/ecosystem/sdks/

Matrix JS SDK — suporte declarado — https://github.com/matrix-org/matrix-js-sdk

Apple App Review Guidelines — https://developer.apple.com/app-store/review/guidelines/

MDN Window.postMessage — https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage

WebAuthn W3C — https://www.w3.org/TR/webauthn-3/

Nota de escopo: referências consultadas em outubro de 2026; versões de bibliotecas, políticas de lojas e contratos de PSP devem ser revalidados no momento da implementação.
