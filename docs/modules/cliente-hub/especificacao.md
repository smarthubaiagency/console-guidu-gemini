# Módulo Cliente Hub (área da loja): especificação da V1

- **Status:** especificação do gerente de projeto, 24/10/2026, para aprovar no PR. Fecha a [proposta](proposta.md) com as decisões do [handoff do Cliente Hub V1](../../handoff/2026-10-24-handoff-cliente-hub-v1.md), seção 2, que não são reabertas aqui.
- **Documentos irmãos:** [dados e migrations propostas](dados.md) e [pedidos de contrato](contrato.md) (`@guidu/contracts`).
- **Lado do turista:** [Cliente Hub no guidu-chat](https://github.com/smarthubaiagency/guidu-chat/blob/main/docs/produto/cliente-hub.md).
- **Relaciona-se com:** [ADR 0006](../../adr/0006-manifesto-de-modulos.md), [ADR 0013](../../adr/0013-idiomas-do-painel.md), [ADR 0014](../../adr/0014-shell-padrao-sidebar-08.md) (revisão proposta de 24/10/2026), [ADR 0015](../../adr/0015-janela-de-edicao-gaveta-interna.md), [ADR 0016](../../adr/0016-smart-status-banner.md), [ADR 0018](../../adr/0018-configuracoes-em-cascata.md), [ADR 0021](../../adr/0021-componentes-modelo.md), [ADR 0027](../../adr/0027-guidu-chat-v1-console-bridge.md), [ponte dos mini-apps](../../architecture/mini-apps-bridge.md), [tradução do Inbox](../inbox/traducao.md).

Nome no menu: **"Vitrine no guidu.chat"** é a recomendação (pergunta CH-N1, seção 11). Até o Marcelo responder, este documento chama o módulo de **Cliente Hub** e a tela de **editor**. O nome aparece só em textos do i18n (`clienteHub.title`), então trocar depois é mudar uma chave.

## 1. Resumo em uma página

| Peça                        | O que é                                                                                                       | Onde                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Editor**                  | Tela cheia com três painéis: à esquerda Blocos, Textos e Aparência; no centro a prévia; à direita a estrutura | Console, `/app/<workspace>/cliente-hub`                           |
| **Catálogo de blocos**      | Os blocos que existem, com campos, limites e textos padrão nos três idiomas                                   | Código do módulo (`src/modules/cliente-hub/catalog.ts`)           |
| **Rascunho**                | O que a loja está editando; salvar não muda nada para o turista                                               | `hub_configs` ([dados](dados.md))                                 |
| **Versão publicada**        | Retrato imutável do rascunho no momento de "Publicar"                                                         | `hub_versions`                                                    |
| **Template "área da loja"** | Mini-app em `apps.guidu.chat` que desenha a área a partir da versão publicada (ou do rascunho, na prévia)     | Runtime dos mini-apps (equipe console)                            |
| **API pública**             | `GET /v1/stores/{slug}/hub`: a versão publicada, já no idioma pedido                                          | API do guidu.chat ([contrato](contrato.md), H1)                   |
| **Dados do turista**        | Pedidos, favoritos e vistos daquele turista **só naquela loja**                                               | Bridge API com a sessão do mini-app ([contrato](contrato.md), H2) |

Quem nunca abriu o editor também tem área: a API devolve o **modelo padrão da plataforma** (os cinco blocos ligados, textos padrão, logo do perfil da loja e cor da plataforma). O guidu.chat nunca precisa tratar "loja sem área".

## 2. Decisões técnicas desta especificação

Registradas no [painel](../../gestao/painel.md) como T14. O Marcelo pode vetar qualquer uma.

| #    | Decisão                                                                                                                                                                                                                                                       | Por quê                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CH1  | **Catálogo de blocos no código**, não numa tabela (a proposta falava em `hub_block_catalog`). Cada bloco tem esquema Zod, campos, limites e textos padrão, como o catálogo de configurações da ADR 0018                                                       | Um bloco só existe se o template souber desenhá-lo; tabela permitiria cadastrar bloco que o mini-app não conhece. Versão do catálogo anda junto com o deploy     |
| CH2  | **Limites do parceiro pela cascata da ADR 0018**: chave `cliente_hub.enabled` (tipo "só desliga") e `cliente_hub.blocks` (tipo "só estreita")                                                                                                                 | Reaproveita leitura, travas, auditoria e telas da cascata; nenhuma tabela nova para isso                                                                         |
| CH3  | **Editor em tela cheia** num grupo de rotas `(fullscreen)/cliente-hub`, com cabeçalho de 60 px igual ao do Inbox e sem sidebar. Exige a revisão proposta da ADR 0014 ("outro shell exige nova ADR")                                                           | Três painéis com prévia de celular no centro não cabem com a sidebar aberta em telas de 1280 px                                                                  |
| CH4  | **Salvar é explícito** ("Salvar rascunho" e Ctrl/⌘+S), com aviso ao sair com alterações. Sem salvamento automático                                                                                                                                            | O `AGENTS.md` pede retorno pelo `useStatus()` a cada salvamento; salvar sozinho a cada segundo encheria o banner. A prévia não depende de salvar (seção 6)       |
| CH5  | **Concorrência por revisão**: o rascunho tem `revision`; salvar envia a revisão lida e recebe conflito se outra pessoa salvou antes                                                                                                                           | Owner e admin podem editar ao mesmo tempo; nada se perde em silêncio                                                                                             |
| CH6  | **Prévia por token de prévia** com 10 minutos, só leitura, preso ao workspace, guardado como hash (`hub_preview_tokens`), entregue ao iframe por `postMessage` com a origem conferida, **nunca na URL**                                                       | O console (`*.guidu.co`) e o `apps.guidu.chat` são sites diferentes: cookie no iframe falharia no Safari (ponte, 11.6). Hash em tabela permite revogar e auditar |
| CH7  | **Imagens no Storage do Supabase do console**, bucket público `hub-public`, gravadas só pelo servidor, convertidas para WebP, sem EXIF e com nome pelo hash. Sem SVG                                                                                          | Logo e capa são lidos por milhares de turistas no pico: precisam de URL pública com cache longo. SVG pode carregar script                                        |
| CH8  | **Nenhum texto em cima de imagem.** O nome da loja e os títulos ficam abaixo da capa                                                                                                                                                                          | Contraste sobre foto não dá para garantir; assim a capa nunca deixa texto ilegível                                                                               |
| CH9  | **Cache da área publicada**: `GET /v1/stores/{slug}/hub` com `ETag` pela versão e `Cache-Control: public, max-age=60, stale-while-revalidate=300`; publicar limpa o cache do APISIX daquela loja                                                              | Pico de QR na mesma loja; um minuto de atraso depois de publicar é aceitável                                                                                     |
| CH10 | **Restaurar uma versão copia para o rascunho**; não publica sozinho                                                                                                                                                                                           | A loja confere na prévia antes de voltar ao ar                                                                                                                   |
| CH11 | **Favoritos e últimos vistos da loja moram na área da loja** (mini-app). O banner do Local (guidu.chat) mantém o coração de favoritar **a loja** e o item que gerou a visita. Ajusta a linha "Local: banner, favoritos e últimos vistos" da ADR 0027, seção 3 | Evita desenhar a mesma lista duas vezes, por duas equipes                                                                                                        |
| CH12 | **Ordem na V1**: a loja ordena os cinco blocos entre si; as partes fixas ficam em posição fixa (entrar no topo para visitante; adicionar ao carrinho dentro do produto). A "ordem livre" da V1.1 é misturar o bloco próprio e as partes fixas                 | Mantém o que a seção 2 decidiu (ligar, desligar, ordenar) e o que a proposta deixou para a V1.1                                                                  |
| CH13 | **Editor só a partir de 1024 px.** Abaixo disso, a tela mostra o estado "Abra no computador para editar" com o link da prévia publicada                                                                                                                       | Três painéis e arrastar blocos não funcionam bem no celular; a loja edita pouco e vê muito                                                                       |

## 3. Permissão, manifesto e cascata

### 3.1 Permissão

- **`cliente_hub.manage`** (nova, no catálogo do núcleo `src/core/permissions/catalog.ts`): abrir o editor, salvar, traduzir, gerar prévia, publicar e restaurar.
- **Quem tem:** `owner` e `admin` do workspace. No modo gerenciado (ADR 0020), o parceiro que atende o cliente, pelos mesmos caminhos dos outros módulos.
- **Atendente** não vê o módulo.
- Toda ação de servidor revalida a permissão; o menu só esconde.

### 3.2 Manifesto (`src/modules/cliente-hub/manifest.ts`)

- `moduleKey: "cliente-hub"`, rota `cliente-hub.editor` (`destination: "app"`, `path: "cliente-hub"`), entrada de menu no grupo `modules`, ícone `store`, `requiredPermissions: [cliente_hub.manage]`.
- Sem `settings` próprio na V1: a ligação de participar ou não fica na cascata (abaixo).
- `releaseStatus: "beta"` até o fim do piloto.

### 3.3 Cascata (ADR 0018)

| Chave                 | Tipo          | Níveis                          | Padrão               | Efeito                                                                                                                             |
| --------------------- | ------------- | ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `cliente_hub.enabled` | "só desliga"  | plataforma, parceiro, workspace | ligado na plataforma | Desligado: o menu some e a API devolve o modelo padrão da plataforma (a loja não personaliza, mas o turista continua vendo a área) |
| `cliente_hub.blocks`  | "só estreita" | plataforma, parceiro            | os cinco de janeiro  | Quais blocos a loja pode ligar. Bloco fora da lista some do editor e da API, mesmo que esteja ligado num rascunho antigo           |

O workspace não grava `cliente_hub.blocks`: a escolha dele é o próprio rascunho.

## 4. Catálogo de blocos de janeiro

Regras de todos os campos de texto: texto puro, sem HTML nem Markdown, sem quebra de linha (exceto nas respostas das perguntas frequentes), espaços nas pontas removidos, caracteres de controle recusados. O mini-app desenha tudo como texto (o React escapa). Links escritos no texto **não** viram link.

Textos em **pt-BR são obrigatórios** para publicar; inglês e espanhol são opcionais e, se faltarem, o turista vê o **texto padrão** do catálogo no idioma dele (seção 7.3). Se a loja deixar um campo em branco, vale o texto padrão.

### 4.1 Aparência

| Campo                     | Regra                                                                                                                      | Sem preencher                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Logo                      | JPG, PNG ou WebP; até 2 MB; quadrada, mínimo 256 × 256 px (corte quadrado no editor se não for). Gravada em WebP 512 × 512 | Logo do perfil da loja no Portfólio; sem ela, as iniciais na cor de destaque |
| Capa                      | JPG, PNG ou WebP; até 4 MB; mínimo 1200 × 480 px (proporção 5:2, corte no editor). Gravada em WebP 1600 × 640 e 800 × 320  | Faixa lisa na cor de destaque, com 64 px de altura                           |
| Texto alternativo da capa | Até 120 caracteres, por idioma                                                                                             | "Capa de {store}"                                                            |
| Cor de destaque           | `#RRGGBB`, escolhida no seletor ou digitada; regras da seção 5                                                             | Cor primária do guidu.chat                                                   |

### 4.2 Blocos da loja

| Bloco (`type`)                            | O que mostra                                                                                                                                                                                                                     | Precisa de login?                                        | Campos (limite)                                                                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Meus pedidos nesta loja** (`my_orders`) | Até 3 pedidos do turista **nesta loja**, mais recentes primeiro, com código, situação, total e data; tocar abre o pedido em Minhas compras (`openOrder`). Link "Ver todos" abre Minhas compras filtrado pela loja (`openOrders`) | Sim. Visitante vê o convite para entrar (parte fixa)     | Título (40), texto do vazio (120), rótulo do link (24)                                                                                                            |
| **Favoritos** (`favorites`)               | Os itens da loja que o turista favoritou (até 12, em carrossel). O coração nos itens fica no mini-app de produto                                                                                                                 | Sim. Visitante vê o texto do vazio com o convite         | Título (40), texto do vazio (120)                                                                                                                                 |
| **Últimos vistos** (`recent`)             | Até 8 itens desta loja que o turista abriu, do mais recente ao mais antigo                                                                                                                                                       | Não: sem login, vem do aparelho (seção 8.3)              | Título (40)                                                                                                                                                       |
| **Conversar** (`chat`)                    | Cartão com título, texto e botão. Em janeiro o botão abre o **WhatsApp da loja** com o código da origem (N9). Com a loja fechada, mostra o texto de fora do horário                                                              | Não para ver; o guidu.chat decide se pede login ao tocar | Título (40), texto (160), rótulo do botão (24), texto de fora do horário (160)                                                                                    |
| **Perguntas frequentes** (`faq`)          | Lista em sanfona (abre uma por vez)                                                                                                                                                                                              | Não                                                      | Título (40); de 1 a 15 pares de pergunta (120) e resposta (600, quebra de linha permitida). Bloco ligado sem nenhuma pergunta não é publicado (erro na seção 7.2) |

### 4.3 Partes fixas (a loja só muda o texto)

| Parte (`fixed`)                            | Onde aparece                                                                                                              | Campos (limite)                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Entrar ou criar conta** (`login_prompt`) | Topo da área, só para visitante. O botão pede ao guidu.chat a tela de entrada da plataforma (`requestLogin`, contrato H6) | Título (40), texto (120), rótulo do botão (24)                                                           |
| **Adicionar ao carrinho** (`add_to_cart`)  | Dentro do mini-app de produto e do catálogo daquela loja                                                                  | Botão (24), aviso de adicionado (60), aviso de sem estoque (60), aviso de loja fechada para pedidos (80) |

O texto da tela de entrada (telefone, código) é da plataforma e não muda.

### 4.4 Textos padrão

| Campo                      | pt-BR                                                                                                | en                                                                                               | es                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `my_orders.title`          | Seus pedidos aqui                                                                                    | Your orders here                                                                                 | Tus pedidos aquí                                                                                      |
| `my_orders.empty`          | Você ainda não fez pedidos nesta loja.                                                               | You haven't ordered from this store yet.                                                         | Todavía no hiciste pedidos en esta tienda.                                                            |
| `my_orders.see_all`        | Ver todos                                                                                            | See all                                                                                          | Ver todos                                                                                             |
| `favorites.title`          | Seus favoritos                                                                                       | Your favorites                                                                                   | Tus favoritos                                                                                         |
| `favorites.empty`          | Toque no coração de um produto para guardar aqui.                                                    | Tap the heart on a product to save it here.                                                      | Toca el corazón de un producto para guardarlo aquí.                                                   |
| `recent.title`             | Vistos por último                                                                                    | Recently viewed                                                                                  | Vistos recientemente                                                                                  |
| `chat.title`               | Fale com a gente                                                                                     | Talk to us                                                                                       | Habla con nosotros                                                                                    |
| `chat.text`                | Tire dúvidas, peça uma indicação ou combine a retirada.                                              | Ask questions, get a recommendation or plan your pickup.                                         | Haz preguntas, pide una recomendación o coordina el retiro.                                           |
| `chat.button`              | Conversar                                                                                            | Chat with us                                                                                     | Conversar                                                                                             |
| `chat.closed_text`         | Estamos fechados agora. Deixe sua mensagem e respondemos quando abrirmos.                            | We're closed right now. Leave a message and we'll reply when we open.                            | Ahora estamos cerrados. Deja tu mensaje y te respondemos cuando abramos.                              |
| `faq.title`                | Perguntas frequentes                                                                                 | Frequently asked questions                                                                       | Preguntas frecuentes                                                                                  |
| `login_prompt.title`       | Entre para ver seus pedidos                                                                          | Sign in to see your orders                                                                       | Inicia sesión para ver tus pedidos                                                                    |
| `login_prompt.text`        | Com a sua conta do guidu.chat você acompanha pedidos e guarda favoritos em todas as lojas da cidade. | With your guidu.chat account you can track orders and save favorites across every store in town. | Con tu cuenta de guidu.chat sigues tus pedidos y guardas favoritos en todas las tiendas de la ciudad. |
| `login_prompt.button`      | Entrar                                                                                               | Sign in                                                                                          | Entrar                                                                                                |
| `add_to_cart.button`       | Adicionar                                                                                            | Add                                                                                              | Agregar                                                                                               |
| `add_to_cart.added`        | Adicionado ao carrinho                                                                               | Added to cart                                                                                    | Agregado al carrito                                                                                   |
| `add_to_cart.out_of_stock` | Sem estoque no momento                                                                               | Out of stock right now                                                                           | Sin stock por ahora                                                                                   |
| `add_to_cart.closed`       | A loja não está recebendo pedidos agora.                                                             | The store isn't taking orders right now.                                                         | La tienda no está recibiendo pedidos ahora.                                                           |
| `cover.alt`                | Capa de {store}                                                                                      | {store} cover                                                                                    | Portada de {store}                                                                                    |

Os textos padrão moram no i18n do runtime dos mini-apps (`miniapps.hub.*`), revisados por pessoa antes de janeiro. A variável `{store}` é a mesma nos três idiomas (regra da ADR 0013) e é preenchida com o nome do perfil da loja.

## 5. Regras de contraste

Base: WCAG 2.2, nível AA. A conta usa a luminância relativa da WCAG e é feita em código puro e testado (`src/modules/cliente-hub/contrast.ts`), no editor (aviso na hora) e no servidor (ao publicar).

| Onde a cor de destaque é usada                                                                               | Exigência                                                                                        | Quando não passa                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fundo do botão** com o texto do botão                                                                      | 4,5 : 1. O texto é branco (`#FFFFFF`) ou o escuro da marca (`#111111`), o que der mais contraste | **Bloqueia a publicação.** O campo mostra "Com essa cor, o texto do botão fica difícil de ler" e o botão **Usar cor sugerida**: a mesma cor clareada ou escurecida (no espaço OKLCH, mantendo matiz) até passar |
| **Ícones, bordas, anel da foto, indicador da aba** sobre o fundo claro e sobre o fundo escuro do `@guidu/ui` | 3 : 1                                                                                            | Não bloqueia. O servidor gera uma variante da cor para aquele tema (mesmo ajuste OKLCH) e a prévia mostra os dois temas lado a lado em Aparência                                                                |
| **Texto na cor de destaque** (links, "Ver todos")                                                            | 4,5 : 1 sobre o fundo do tema                                                                    | Não bloqueia. O texto usa a cor normal do tema e só o sublinhado fica na cor de destaque                                                                                                                        |
| **Capa e logo**                                                                                              | Sem texto por cima (CH8); logo sobre círculo branco com borda                                    | —                                                                                                                                                                                                               |

A API devolve as cores já resolvidas (`accent`, `on_accent`, `accent_light_ui`, `accent_dark_ui`); o mini-app não recalcula. Testes: tabela de cores conhecidas (o amarelo `#FFD400` precisa de texto escuro; o azul `#1E40AF` passa com branco; `#9CA3AF` não passa com nenhum e recebe sugestão).

## 6. O editor

### 6.1 Desenho

Tela cheia (CH3), com componentes do shadcn e os modelos da ADR 0021. Mínimo de 1024 px (CH13).

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ← Dashboard │ Vitrine no guidu.chat · Restaurante Buzin  [Rascunho com alterações]    │  60 px
│             │ Editando em: [Português ▾]   Versões   Traduzir   Salvar rascunho   Publicar │
├───────────────────┬───────────────────────────────────────────┬──────────────────────┤
│ [Blocos|Textos|   │  [Visitante | Com login]  [Aberta | Fechada]│ Estrutura            │
│  Aparência]       │  [Claro | Escuro]  [pt | en | es]   📱 QR  │ 🔒 Entrar ou criar…   │
│                   │  ┌───────────────┐                          │ ⠿ Meus pedidos   ●  │
│  lista ou campos  │  │  prévia 390px │                          │ ⠿ Favoritos      ●  │
│  do bloco         │  │  (mini-app)   │                          │ ⠿ Últimos vistos ●  │
│                   │  └───────────────┘                          │ ⠿ Conversar      ●  │
│                   │                                             │ ⠿ Perguntas…     ○  │
│                   │                                             │ 🔒 Adicionar ao…     │
└───────────────────┴───────────────────────────────────────────┴──────────────────────┘
```

| Área                     | Componentes                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cabeçalho                | Igual ao cabeçalho primário do Inbox (60 px, borda inferior): voltar ao dashboard, título, nome da loja, `Badge` de situação, seletor do idioma em edição (`NativeSelect`), botões. Ctrl/⌘+S salva |
| Painel esquerdo (320 px) | `Tabs` segmentadas: **Blocos** (lista de `Item` com `Switch`), **Textos** (campos do bloco selecionado, com contador de caracteres), **Aparência** (logo, capa, cor). Painéis em `Card` `surface`  |
| Centro                   | `ToggleGroup` segmentados para a situação da prévia; moldura de celular de 390 × 844 com o iframe; botão **Ver no meu celular** (QR com o link de prévia, seção 6.4)                               |
| Painel direito (280 px)  | **Estrutura**: lista ordenável (arrastar pela alça e, para teclado, botões subir e descer); partes fixas com cadeado; tocar seleciona o bloco nos dois painéis e rola a prévia até ele             |
| Versões                  | Gaveta interna (`WorkbenchDrawer`, ADR 0015) com a lista de versões                                                                                                                                |
| Avisos                   | `useStatus()` (ADR 0016) para salvar, publicar, traduzir, restaurar e erros. Erro de um campo fica ao lado do campo                                                                                |

Colunas com `Resizable`, como no Inbox; a coluna recolhida não renderiza o conteúdo.

### 6.2 Situação do módulo (badge no cabeçalho)

| Situação                | Badge                                 | Quando                                         |
| ----------------------- | ------------------------------------- | ---------------------------------------------- |
| Usando o modelo padrão  | `neutral` "Modelo padrão"             | Nunca publicou                                 |
| Publicado               | `success` "Publicado · versão N"      | Rascunho igual à versão publicada              |
| Rascunho com alterações | `warning` "Alterações não publicadas" | Rascunho salvo diferente da versão publicada   |
| Alterações não salvas   | `info` "Não salvo"                    | Há mudanças na tela que ainda não foram salvas |

### 6.3 Estados da tela

| Estado                            | O que aparece                                                                                                                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primeira vez**                  | `Empty` com "Monte a vitrine da sua loja no guidu.chat", texto "Os turistas e moradores veem esta área quando abrem sua loja pelo QR ou pelo app." e o botão **Começar pelo modelo padrão** (cria o rascunho com o modelo da plataforma) |
| **Carregando**                    | Esqueleto dos três painéis (`Skeleton`)                                                                                                                                                                                                  |
| **Sem perfil da loja publicado**  | `Empty` "Publique o perfil da loja no Portfólio antes" com link para o Portfólio. A área precisa do nome e do slug da loja                                                                                                               |
| **Módulo desligado pela cascata** | 404 uniforme do console (a entrada de menu já não aparece)                                                                                                                                                                               |
| **Tela menor que 1024 px**        | `Empty` "Abra no computador para editar" e o link **Ver como o turista vê** (prévia da versão publicada)                                                                                                                                 |
| **Prévia não carregou**           | Dentro da moldura: "Não conseguimos abrir a prévia" e **Tentar de novo**; o resto do editor continua funcionando                                                                                                                         |
| **Conflito ao salvar**            | Banner `warning` "Outra pessoa salvou esta vitrine às {hora}. Recarregue para ver a versão dela; suas alterações ficam nesta tela até você recarregar." com **Recarregar**                                                               |
| **Sem permissão**                 | 404 uniforme                                                                                                                                                                                                                             |

### 6.4 Prévia

1. A prévia é o próprio template "área da loja" de `apps.guidu.chat`, aberto em iframe na rota `apps.guidu.chat/preview/hub/{slug}`.
2. Ao abrir o editor, o servidor emite um **token de prévia** (CH6): 10 minutos, só leitura, preso ao workspace. O editor renova sozinho um minuto antes de vencer.
3. Aperto de mão: o iframe manda `guidu.preview.hello`; o editor confere `event.origin` (só `https://apps.guidu.chat` e o host de dev) e responde `guidu.preview.welcome { token }`. O runtime guarda o token só em memória e o manda no cabeçalho `Authorization`.
4. **A prévia não espera salvar.** A cada mudança (até 300 ms depois de parar de digitar), o editor manda `guidu.preview.update { config, situation }` com o rascunho da tela; o runtime valida com o mesmo esquema Zod do servidor e redesenha. O servidor só é chamado para os dados de exemplo e as imagens.
5. **Situações:** visitante ou com login, loja aberta ou fechada, tema claro ou escuro, idioma. Com login, os blocos mostram **dados de exemplo** marcados "Exemplo" (três pedidos fictícios, quatro favoritos e seis vistos tirados de itens publicados da própria loja). Nenhum dado de turista real entra na prévia.
6. **Ver no meu celular:** gera um link de prévia de uso único que vale 10 minutos (`apps.guidu.chat/preview/hub/{slug}#t=<código>`; o código fica no fragmento, que não vai para o servidor nem para log, e o runtime o troca por um token e limpa a barra de endereço). Mostra o rascunho **salvo**.
7. **Moldura:** a rota `/preview/*` do `apps.guidu.chat` libera `frame-ancestors` só para os hosts do console (plataforma e domínios de parceiro, lista do `proxy.ts`); as rotas do turista continuam liberando só o guidu.chat web. Prévia responde `X-Robots-Tag: noindex` e `Cache-Control: no-store`.

### 6.5 Traduzir

- **Traduzir** abre um `Dialog` com os idiomas do turista (inglês e espanhol no piloto, pergunta CH-N3) e duas opções: "Só campos vazios" (padrão) ou "Refazer todos".
- Usa o **motor de tradução do workspace** configurado no Inbox (modelo de IA com a chave do cliente e Google Translate de reserva, [tradução](../inbox/traducao.md), seção 3), com o glossário do Inbox. O nome da loja e dos produtos nunca é traduzido.
- **Sem motor configurado:** o botão fica desabilitado com a dica "Configure a tradução em Configurações › Módulos › Inbox ou escreva os textos em cada idioma". A loja pode digitar à mão em qualquer idioma.
- Cada texto traduzido fica marcado `origin: machine` e aparece com o selo "Tradução automática" ao lado do campo até alguém editar ou tocar **Revisado**.
- Roda como job (pg-boss); o banner mostra "Traduzindo 18 textos…" e depois "Tradução pronta. Revise antes de publicar.". Falha parcial: "Traduzimos 15 de 18 textos. Os que faltam continuam no padrão."; nada é apagado.
- Limite: uma tradução por vez por workspace; o botão fica ocupado até terminar.

### 6.6 Salvar, publicar, versões

| Ação                     | Regras                                                                                                                                                                                                                                                                                                                                                             | Aviso                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| **Salvar rascunho**      | Valida o formato (tamanhos, cor, imagens existentes); erros de campo ficam ao lado do campo e não salvam aquele campo. Envia a `revision` (CH5). Ao sair com mudanças não salvas, o navegador avisa (aviso nativo do `beforeunload`, o único caso permitido) e a navegação interna pede confirmação num `Dialog`                                                   | `success` "Rascunho salvo"                                             |
| **Publicar**             | Salva antes, se preciso. Bloqueia se: cor sem contraste no botão (seção 5); falta texto obrigatório em pt-BR; Perguntas frequentes ligado sem perguntas; imagem que não carregou. Se houver traduções automáticas não revisadas, o `Dialog` de publicação lista quantas por idioma e deixa publicar assim mesmo. Campo opcional "O que mudou" (até 120 caracteres) | `success` "Publicado. Os turistas veem a nova versão em até 1 minuto." |
| **Versões**              | Gaveta com número, data, quem publicou e "O que mudou". **Ver** abre a prévia daquela versão; **Restaurar no rascunho** copia para o rascunho (CH10)                                                                                                                                                                                                               | `info` "Versão N copiada para o rascunho. Publique para voltar ao ar." |
| **Descartar alterações** | No menu ⋯: volta o rascunho para a versão publicada, com confirmação em `Dialog`                                                                                                                                                                                                                                                                                   | `success` "Alterações descartadas"                                     |

Erros genéricos: `danger` "Não deu para salvar agora. Tente de novo em instantes." com o código do erro em letra pequena (registrado no log, sem dados da loja).

### 6.7 Imagens

- Envio pelo servidor: o editor pede uma URL de envio assinada (60 s, um arquivo, tamanho máximo do tipo); o servidor confere tipo real pelo conteúdo (não pela extensão), tamanho em pixels, converte para WebP, remove metadados e grava em `hub-public/{workspace_id}/{sha256}.webp`.
- Cortes (quadrado para logo, 5:2 para capa) feitos no editor antes do envio; o servidor corta de novo se vier fora da proporção.
- A imagem trocada continua no Storage enquanto alguma versão publicada usar; a limpeza semanal apaga as órfãs (`hub_assets.deleted_at`).
- Erros ao lado do campo: "Use JPG, PNG ou WebP", "A imagem precisa ter pelo menos 1200 × 480 px", "O arquivo passa de 4 MB".

## 7. API interna do módulo

Ações de servidor do console (não fazem parte do `@guidu/contracts`), todas com `withContext` do workspace, `cliente_hub.manage` revalidada e auditoria.

| Ação                                     | Entrada                              | Saída / erros                                                                              | Auditoria                    |
| ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------- |
| `getHubEditorState()`                    | —                                    | Rascunho, `revision`, versão publicada, catálogo permitido pela cascata, situação, idiomas | —                            |
| `startFromDefault()`                     | —                                    | Cria o rascunho com o modelo padrão; `already_exists` se já houver                         | `cliente_hub.draft.create`   |
| `saveHubDraft(config, revision)`         | Configuração (esquema `HubConfigV1`) | Nova `revision`; `revision_conflict`; `invalid_config` com os campos                       | `cliente_hub.draft.save`     |
| `requestAssetUpload(kind)`               | `logo` ou `cover`                    | URL assinada e id do asset                                                                 | —                            |
| `confirmAssetUpload(assetId)`            | —                                    | URL pública e tamanhos; `invalid_image`                                                    | `cliente_hub.asset.upload`   |
| `startHubTranslation(locales, mode)`     | Idiomas, `empty_only` ou `all`       | Id do job; `translation_not_configured`; `translation_running`                             | `cliente_hub.translate`      |
| `markTranslationReviewed(path, locale)`  | Campo e idioma                       | —                                                                                          | —                            |
| `createPreviewToken(target)`             | `draft` ou versão                    | Token (10 min) ou código de uso único para celular                                         | `cliente_hub.preview.create` |
| `publishHub(revision, note?)`            | Revisão lida                         | Versão nova; `revision_conflict`; `publish_blocked` com a lista do que falta               | `cliente_hub.publish`        |
| `listHubVersions(cursor?)`               | —                                    | Página de 20 versões                                                                       | —                            |
| `restoreHubVersion(versionId, revision)` | —                                    | Nova `revision` do rascunho                                                                | `cliente_hub.restore`        |
| `discardHubDraft(revision)`              | —                                    | Rascunho igual à versão publicada                                                          | `cliente_hub.draft.discard`  |

Rotas lidas pelo runtime dos mini-apps (no container do GUIDU, atrás do APISIX):

| Rota                                 | Quem chama               | Autenticação                              | Devolve                                                  |
| ------------------------------------ | ------------------------ | ----------------------------------------- | -------------------------------------------------------- |
| `GET /api/hub-preview/{slug}`        | Runtime, na prévia       | `Authorization: Bearer <token de prévia>` | Rascunho resolvido (cores, textos com padrão), como o H1 |
| `GET /api/hub-preview/{slug}/sample` | Runtime, na prévia       | Mesmo token                               | Dados de exemplo (seção 6.4, item 5)                     |
| `POST /api/hub-preview/exchange`     | Runtime, link do celular | Código de uso único                       | Token de prévia                                          |
| `GET /v1/stores/{slug}/hub`          | Runtime e guidu.chat     | Público                                   | Versão publicada ([contrato](contrato.md), H1)           |

Limites no APISIX: prévia 60 req/min por token; troca de código 10 req/min por IP.

### 7.1 Esquema da configuração (`HubConfigV1`)

```ts
type Localized = { "pt-BR": string; en?: string; es?: string }; // vazio = texto padrão
type TextMeta = Record<
  string,
  { origin: "human" | "machine"; reviewed: boolean }
>; // chave "campo@idioma"

type HubConfigV1 = {
  schemaVersion: 1;
  appearance: {
    logoAssetId?: string;
    coverAssetId?: string;
    coverAlt?: Localized;
    accent?: string; // #RRGGBB
  };
  blocks: Array<
    | {
        id: string;
        type: "my_orders";
        enabled: boolean;
        title?: Localized;
        empty?: Localized;
        seeAll?: Localized;
      }
    | {
        id: string;
        type: "favorites";
        enabled: boolean;
        title?: Localized;
        empty?: Localized;
      }
    | { id: string; type: "recent"; enabled: boolean; title?: Localized }
    | {
        id: string;
        type: "chat";
        enabled: boolean;
        title?: Localized;
        text?: Localized;
        button?: Localized;
        closedText?: Localized;
      }
    | {
        id: string;
        type: "faq";
        enabled: boolean;
        title?: Localized;
        items: Array<{ id: string; q: Localized; a: Localized }>;
      }
  >; // a ordem do array é a ordem na tela; cada type aparece no máximo uma vez
  fixed: {
    loginPrompt: { title?: Localized; text?: Localized; button?: Localized };
    addToCart: {
      button?: Localized;
      added?: Localized;
      outOfStock?: Localized;
      closed?: Localized;
    };
  };
  textMeta: TextMeta;
};
```

O esquema Zod fica em `@guidu/contracts` (`hub/config.ts`), usado pelo editor, pelo servidor e pelo runtime. `schemaVersion` sobe quando um campo muda de forma; o servidor converte versões antigas ao ler.

## 8. O template "área da loja" (runtime)

### 8.1 Rotas

| Rota                                 | Para quê                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `apps.guidu.chat/{slug}/hub`         | Área publicada, aberta pelo guidu.chat no Local e no Hub (iframe, ponte v1) |
| `apps.guidu.chat/preview/hub/{slug}` | Prévia do editor (seção 6.4)                                                |

### 8.2 Ordem na tela

1. Capa, logo, nome da loja e chip de situação ("Aberto agora · fecha às 22h" / "Fechado · abre às 9h"), calculados no servidor com o fuso da loja.
2. Visitante: parte fixa **Entrar ou criar conta**.
3. Os blocos ligados, na ordem da loja.

Bloco que não tem o que mostrar **e** não tem texto de vazio (Últimos vistos sem nada visto) não aparece. Os demais mostram o texto do vazio.

### 8.3 Dados do turista

- Com login, o runtime chama `GET /bridge/stores/{slug}/hub/me` com a sessão do mini-app (contrato H2): só pedidos, favoritos e vistos **daquela loja**, consultados com o `withContext` da loja (ponte, seção 7, item 6). A loja é sempre a da sessão do mini-app; um slug diferente na rota é recusado.
- Sem login, os vistos ficam no `localStorage` do `apps.guidu.chat`: só ids de itens, até 20 por loja, 30 dias. Ao entrar, o guidu.chat envia a lista para `POST /me/recent` (H4) e o runtime limpa a cópia local.
- Favoritar um item ou a loja chama `setFavorite` pela ponte (H6): quem grava é o guidu.chat, com o token do turista.
- Tocar num pedido chama `openOrder(orderId)` pela ponte (H6); o guidu.chat abre Minhas compras. O mini-app nunca mostra o detalhe do pedido nem dado de pagamento.

### 8.4 Desempenho

- Configuração publicada em cache (CH9); imagens com `Cache-Control: public, max-age=31536000, immutable` (o nome é o hash).
- Meta: primeira pintura da área em até 1,5 s num 4G ruim (perfil "Slow 4G" do Lighthouse), com a configuração em cache; os blocos do turista carregam depois, com esqueleto.
- Um erro no H2 não derruba a área: os blocos do turista mostram "Não deu para carregar agora" com **Tentar de novo**; o resto aparece.

## 9. Segurança

1. **Sem CSS, HTML, Markdown nem script.** Só os campos do catálogo, validados por Zod no servidor e no runtime. Campo desconhecido é recusado.
2. **Imagens** só pelo envio do servidor, conferidas pelo conteúdo, convertidas e sem metadados; sem SVG.
3. **Isolamento entre lojas:** a configuração e as consultas do H2 sempre pelo `withContext` da loja; uma loja nunca vê dado de turista de outra loja nem o que o turista faz em outra loja.
4. **Prévia:** token curto, só leitura, guardado como hash, revogado ao sair do editor; dados de exemplo, nunca de turista real.
5. **RLS** em todas as tabelas novas ([dados](dados.md)); versões imutáveis.
6. **Auditoria** de salvar, publicar, restaurar, descartar, traduzir, enviar imagem e gerar prévia.
7. **Limites** no APISIX para as rotas públicas e de prévia (seção 7).
8. **Exclusão do workspace** apaga rascunho, versões, tokens e imagens (purga do WS1).

## 10. Testes e aceite

| Camada        | O que cobre                                                                                                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unidade       | Esquema `HubConfigV1` (limites, campos desconhecidos, ordem, um bloco por tipo); contraste (tabela da seção 5, sugestão OKLCH); resolução de textos (loja → padrão do idioma → pt-BR); cascata `cliente_hub.*` |
| Banco         | RLS de cada tabela com dois workspaces (um não lê o outro); versão não aceita `update`; token vencido não lê                                                                                                   |
| Integração    | Salvar com revisão velha devolve conflito; publicar bloqueado pelos motivos da seção 6.6; restaurar não publica; publicar limpa o cache                                                                        |
| e2e (console) | Owner monta a vitrine do zero, traduz (motor simulado), vê a prévia nas quatro situações e publica; atendente não vê o menu; tela de 800 px mostra o estado de computador                                      |
| e2e (runtime) | Área publicada no iframe de teste com e sem login; H2 com erro mantém o resto; texto com `<script>` aparece como texto                                                                                         |

**Aceite:** os e2e acima verdes no CI; a loja de teste do piloto publicada e aberta pelo guidu.chat web no dev; `pnpm typecheck && pnpm lint && pnpm test && pnpm build` verdes.

**Etapas e semanas** (sem mudar o plano de janeiro): **CH-A** (semana de 10/11) catálogo, esquema, tabelas, H1 com o modelo padrão e o template "área da loja"; **CH-B** (17/11) H2 a H6 e o modelo padrão aberto no guidu.chat web; **CH-C** (24/11) editor, prévia, publicação e versões; **CH-D** (01/12) tradução e imagens. A equipe guidu.chat abre a área no Local e no Hub na semana de 17/11, contra o simulado desde 27/10.

## 11. Perguntas ao Marcelo

As cinco perguntas da seção 4 do handoff, com a recomendação. Registradas no [painel](../../gestao/painel.md) como N10 a N14.

| #     | Pergunta                         | Recomendação                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CH-N1 | Nome no menu do console          | **"Vitrine no guidu.chat"**. O lojista entende "vitrine" sem explicação; "do turista" deixaria de fora o morador, que também usa o app; "Cliente Hub" é jargão em inglês e confunde com o Hub do próprio turista. O nome interno continua `cliente-hub`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CH-N2 | Os cinco blocos de janeiro       | **Manter os cinco.** Cobrem o que o turista mais procura numa loja (meus pedidos, guardar, voltar ao que viu, falar, tirar dúvida) e todos usam dados que já teremos em janeiro. Único ajuste: "Conversar" abre o WhatsApp da loja em janeiro (N9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CH-N3 | Idiomas da tradução no piloto    | **Inglês e espanhol bastam.** São os visitantes estrangeiros mais comuns em Búzios (argentinos à frente). A estrutura aceita qualquer idioma; incluir outro depois é cadastrar o idioma e revisar os textos padrão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CH-N4 | Como atendentes aparecem no chat | **Cada pessoa escolhe**, com o padrão mais reservado: **primeiro nome e iniciais, sem foto**; foto só se a pessoa enviar. Sobrenome nunca. Em janeiro a conversa com as lojas é pelo WhatsApp (N9), então isso vale quando o chat no app chegar; a escolha entra no perfil da pessoa no console antes disso                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CH-N5 | Pontos do contrato v1.1          | (a) **Tela "Com quem você está comprando" já em janeiro**, no "Pagar à loja": logo, razão social, CNPJ, selo "Loja verificada" (só depois da aprovação à mão) e o aviso "O pagamento é processado por {provedor}, da loja. O guidu.chat não recebe nem guarda seu pagamento." É a principal defesa contra golpe de link enquanto o dinheiro não passa pela plataforma. **O texto do aviso precisa do jurídico.** (b) **Avaliação depois da entrega fica na V1.1**, como já previsto; o espaço em Minhas compras fica reservado. (c) **"Problema com o pedido" em janeiro**, como conversa com a loja: o botão **Falar com a loja** da página do pedido abre o WhatsApp da loja com o código do pedido (pela decisão de poucas etapas de 24/10/2026, ajuste, cancelamento e comprovante também seguem por aí) |
