# Handoff 24/10/2026 — O que cada equipe produz

Terceira conversa. Começa **depois** que as conversas do BotCompara V1 e do Cliente Hub V1 terminarem e preencherem a seção "Entradas". Junta tudo o que foi decidido e vira o backlog de cada equipe até janeiro de 2027.

## Mensagem de abertura (colar no chat novo)

> Você é o gerente de projeto do ecossistema guidu (piloto em Armação dos Búzios, janeiro de 2027), especialista em aplicativos e plataformas com foco em inovação, desempenho e segurança. Traga recomendação com o porquê, em linguagem simples; decida o técnico e registre; leve a mim só negócio, dinheiro, jurídico, risco alto ou produção.
>
> As conversas do BotCompara V1 e do Cliente Hub V1 foram fechadas. Esta conversa transforma tudo no que **cada equipe vai produzir**: equipe console e equipe guidu.chat. Leia primeiro `docs/handoff/2026-10-24-handoff-equipes.md` no repositório `smarthubaiagency/console-guidu-gemini` (branch `ccr-9cbbbae2-qs9m9e`), incluindo a seção "Entradas", e os documentos que ele lista. Não reabra decisões sem eu pedir.

**Repositórios para anexar à sessão:** `smarthubaiagency/console-guidu-gemini`, `smarthubaiagency/guidu-chat` e `smarthubaiagency/botcompara`.

## 1. Leia antes

| Repositório          | Branch                        | Arquivo                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| console-guidu-gemini | `ccr-9cbbbae2-qs9m9e`         | `AGENTS.md`; `docs/gestao/painel.md`; `docs/gestao/plano-janeiro-2027.md`; `docs/gestao/equipes-guidu-chat-v1.md` (divisão e semanas atuais); `docs/adr/0026-gateways-apisix-e-agentgateway.md`; `docs/adr/0027-guidu-chat-v1-console-bridge.md`; `docs/architecture/gateways.md`; `docs/architecture/commerce-guidu-chat.md`; `docs/auditoria/2026-10-23-seguranca-de-borda.md`; `docs/operacao/capacidade-buzios.md`; `docs/modules/cliente-hub/` |
| guidu-chat           | `claude/produto-v1`           | `docs/contexto.md`; `docs/produto/`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| botcompara           | `claude/documentacao-inicial` | `docs/alinhamento-2026-10-24.md` e a especificação da V1                                                                                                                                                                                                                                                                                                                                                                                            |

## 2. Entradas (preenchidas pelas outras conversas)

| Conversa       | Especificação | Pedidos à equipe console (contrato, motor, Vendure) | Decisões do Marcelo |
| -------------- | ------------- | --------------------------------------------------- | ------------------- |
| BotCompara V1  | _a preencher_ | _a preencher_                                       | _a preencher_       |
| Cliente Hub V1 | _a preencher_ | _a preencher_                                       | _a preencher_       |

## 3. O que esta conversa deve produzir

1. **Backlog da equipe console** e **backlog da equipe guidu.chat** até 31/12, por semana, cada item com entrega, critério de aceite e dependência; atualizar `docs/gestao/equipes-guidu-chat-v1.md` e `docs/gestao/plano-janeiro-2027.md`.
2. **Contrato v1** (`@guidu/contracts`): lista final de rotas, eventos e esquemas da ponte para a equipe console publicar na semana de 27/10, com o servidor simulado.
3. **Etapas no formato do `AGENTS.md`** (Contexto → Objetivo → Requisitos → Lógica → Plano → Testes → Aceite) para as primeiras duas semanas de cada equipe.
4. **Plano de campo:** cadastro e treino das lojas a partir de novembro, QR impressos.
5. **Painel atualizado** com o que ficou decidido e o que espera o Marcelo.

## 4. Pendências que esta conversa precisa encaixar

**Do contrato v1.1 (begoo-contrato-v1-1.md, lido em 24/10/2026):**

1. **`track_id`**: identificador da jornada desde o primeiro contato (QR, link, WhatsApp) até pedido e pagamento, com canal de origem; entra na ADR 0027 e no contrato.
2. **Verificação do lojista**: CNPJ validado automaticamente e aprovação à mão no piloto (base do selo de "verificada").
3. **Trabalho de campo** começando em novembro (hoje o plano só cadastra lojas na semana de 15/12).
4. **Home**: serviços essenciais fixos (Prefeitura, 190, 192, 193), filtros "Abertos agora" e "Perto de mim", busca única com dois modos (produto ou estabelecimento).
5. Depois de janeiro: link curto e QR de oferta com validade; profissionais autônomos com CPF como "loja"; identidade visual da loja no chat; integração com o Hostse (sem senhas de porta nas salas).

**Decisões do Marcelo ainda abertas:** N2 e N7 (lojas e quantidade), N4 (projeto Supabase do turista), N8 (primeiro provedor de pagamento por API; o contrato v1.1 sugeria Pagar.me), N9 (chat em janeiro: navegador ou WhatsApp da loja); aprovação das ADRs 0026 e 0027; três PRs abertos ou por abrir (console `ccr-9cbbbae2-qs9m9e`, guidu-chat `claude/produto-v1`, botcompara `claude/documentacao-inicial`).
