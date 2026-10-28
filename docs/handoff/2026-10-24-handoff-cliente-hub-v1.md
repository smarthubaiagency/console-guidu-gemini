# Handoff 24/10/2026 — Cliente Hub V1

> **Fechado em 24/10/2026.** Entregas: [especificação do módulo](../modules/cliente-hub/especificacao.md), [dados](../modules/cliente-hub/dados.md), [contrato](../modules/cliente-hub/contrato.md) e, no guidu-chat, `docs/produto/cliente-hub.md` (seção 8). Perguntas da seção 4 com recomendação no [painel](../gestao/painel.md), N10 a N14.
>
> **Revisado e entregue em 28/10/2026.** A conversa de 24/10 parou antes dos PRs; a de 28/10 trouxe o trabalho para a `main` atual, corrigiu o isolamento do H2 (a loja vem da sessão do mini-app), acrescentou `openOrders` à ponte para o "Ver todos" de Meus pedidos e apontou os links para a `main`. As perguntas N10 a N14 continuam com o Marcelo.

Passagem de bastão da conversa de arquitetura e produto (23 e 24/10/2026) para uma conversa só sobre a **V1 do Cliente Hub**: o Hub do turista no guidu.chat e o módulo do console em que a loja personaliza a sua área.

## Mensagem de abertura (colar no chat novo)

> Você é o gerente de projeto do ecossistema guidu (piloto em Armação dos Búzios, janeiro de 2027), especialista em aplicativos e plataformas com foco em inovação, desempenho e segurança. Traga recomendação com o porquê, em linguagem simples; decida o técnico e registre; leve a mim só negócio, dinheiro, jurídico, risco alto ou produção.
>
> Esta conversa fecha a **V1 do Cliente Hub**: o Hub do turista no guidu.chat e o módulo Cliente Hub do console (área da loja). Leia primeiro `docs/handoff/2026-10-24-handoff-cliente-hub-v1.md` no repositório `smarthubaiagency/console-guidu-gemini` (branch `ccr-9cbbbae2-qs9m9e`) e os documentos que ele lista. Não reabra decisões da seção 2 sem eu pedir. Ao final, entregue a especificação no console e no guidu-chat e atualize o handoff de equipes.

**Repositórios para anexar à sessão:** `smarthubaiagency/console-guidu-gemini` e `smarthubaiagency/guidu-chat`.

## 1. Leia antes

| Repositório          | Branch                | Arquivo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| console-guidu-gemini | `ccr-9cbbbae2-qs9m9e` | `AGENTS.md`; `docs/gestao/painel.md` (T12, T13); `docs/modules/cliente-hub/proposta.md` (módulo e referência do editor do Klaviyo, com as imagens em `assets/`); `docs/adr/0027-guidu-chat-v1-console-bridge.md`; `docs/architecture/mini-apps-bridge.md`; `docs/adr/0014-shell-padrao-sidebar-08.md` (exceção de tela cheia); `docs/adr/0018-configuracoes-em-cascata.md`; `docs/adr/0013-idiomas-do-painel.md` e `docs/modules/inbox/traducao.md` (tradução); `docs/architecture/ui-shell.md` e `docs/adr/0021-componentes-modelo.md` (padrões de tela) |
| guidu-chat           | `claude/produto-v1`   | `docs/contexto.md`; `docs/produto/cliente-hub.md` (referência Klaviyo e abas); `docs/produto/v1-navegacao-e-pedido.md` (menus, chat com identificação de quem fala, pedido); `docs/produto/assets/chat-v1-rascunho.webp`                                                                                                                                                                                                                                                                                                                                  |

## 2. Já decidido

1. **Duas partes:** o **Hub do turista** (conta, perfil, consentimentos, todas as compras, conversas, carteira) é da plataforma e não se personaliza; a **área da loja** (o que o turista vê daquela loja, no Local e no Hub) é personalizada pela loja no módulo do console (T13).
2. **Abas do Hub:** Para você · Minhas compras · Conversas · Perfil; Carteira na V2.
3. **Editor do módulo** no modelo do Klaviyo: três painéis, blocos da loja (ligar, desligar, ordenar) e partes fixas (só texto), prévia pelo próprio mini-app com token curto, traduzir, rascunho e publicação com versões, **sem CSS ou HTML livre**, contraste conferido, cascata plataforma → parceiro → loja.
4. **Área da loja** é um mini-app em `apps.guidu.chat`, feito pela **equipe console**, lendo `GET /stores/{slug}/hub`; a equipe guidu.chat só abre o mini-app no Local e no Hub (ADR 0027).
5. **Escopo por versão** da proposta (janeiro: logo, capa, cor; blocos Meus pedidos nesta loja, Favoritar, Últimos vistos, Conversar, Perguntas frequentes).
6. **Chat:** cabeçalho com voltar · cápsula (foto, nome, loja; selo "Assistente virtual" para IA) · menu; a API traz loja e quem fala.
7. **Recomendação** só com o que o turista declarou ou fez; consentimentos separados e revogáveis (LGPD).

## 3. O que esta conversa deve produzir

1. **Especificação do módulo** em `console/docs/modules/cliente-hub/`: telas do editor (estados, textos, validações), catálogo de blocos de janeiro com campos e textos padrão, regras de contraste, permissão `cliente_hub.manage`, tabelas e migrations propostas (para aprovar no PR), API de rascunho, prévia e publicação.
2. **Especificação do Hub do turista** em `guidu-chat/docs/produto/cliente-hub.md`: cada aba com estados (vazio, carregando, erro, sem login), textos e ações; onde a área da loja aparece.
3. **Contrato:** campos novos para `@guidu/contracts` (`GET /stores/{slug}/hub`, favoritos, últimos vistos, perguntas frequentes) para a equipe console publicar.
4. **Decisão do Marcelo** sobre as perguntas da seção 4.

## 4. Perguntas abertas

1. Nome no menu do console: "Cliente Hub", "Vitrine do turista" ou outro?
2. Os cinco blocos de janeiro estão bons?
3. Idiomas da tradução no piloto: inglês e espanhol bastam?
4. Atendentes no chat: cada um escolhe como aparece (primeiro nome com foto, sem foto ou iniciais)?
5. Pontos do contrato v1.1 a encaixar aqui: **tela "com quem você está comprando"** no "Pagar à loja" (logo, razão social, CNPJ, selo de verificada, aviso de que o pagamento é processado pelo provedor da loja); **avaliação depois da entrega** (V1.1); **"problema com o pedido"** como conversa com a loja.

## 5. Ao terminar

Atualize a seção "Entradas" de `docs/handoff/2026-10-24-handoff-equipes.md` com os links das especificações e os pedidos de contrato.
