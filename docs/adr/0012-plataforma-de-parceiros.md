# ADR 0012 — Plataforma de parceiros (white label, cobrança dividida e comunicação)

- **Status:** Proposto, aguarda aprovação do Marcelo no PR.
- **Data:** 10/10/2026
- **Decisões de origem (Marcelo, 10/10/2026):** três níveis com console da plataforma em `/platform` e console do parceiro em `/admin`; cliente final acessa pelo domínio do parceiro com a identidade, os termos e a cobrança dele; checkout da plataforma com o preço do parceiro, valores mínimos e divisão padrão de 70% para o parceiro e 30% para a plataforma; alternativa em que o próprio parceiro cadastra o cliente e paga só o valor base da plataforma; provedores Iugu, Stripe e manual como opções.
- **Altera:** ADR 0004 (marca e domínio deixam de ser só por ambiente), ADR 0005 (rotas administrativas passam de `/admin` para `/platform`) e a §12 da especificação.
- **Detalhamento:** [`docs/partners/especificacao.md`](../partners/especificacao.md).

## Contexto

O GUIDU vai ser revendido por parceiros (agências) com a marca deles, e os clientes finais devem ver só a marca do parceiro. Hoje existem dois níveis, empresa e workspace, e um console interno em `/admin`. Marca e domínio vêm de variáveis de ambiente (ADR 0004), e cobrança, planos e provedor ainda estão em aberto (F3 e pendência "Provedores e cobrança").

## Decisão

1. **Três níveis de inquilino: plataforma → parceiro → empresa → workspace.** Toda empresa pertence a exatamente um parceiro. Os clientes diretos pertencem ao **parceiro zero**, que é a marca da casa. Não existe empresa sem parceiro.
2. **O domínio acessado define o parceiro, e a rota define o papel.**
   - `/platform`: console de quem opera a plataforma. Só responde nos domínios da plataforma; em domínio de parceiro, responde 404.
   - `/admin`: console do parceiro, no domínio do parceiro. O parceiro zero usa o mesmo console no domínio da plataforma.
   - `/app`: produto do cliente final.
3. **Papéis de parceiro são separados** dos papéis internos e dos papéis de empresa e workspace. Por padrão, **não dão acesso aos dados dos workspaces dos clientes**. O acesso de suporte só existe por concessão temporária, justificada, auditada e visível ao cliente (especificação §12).
4. **A marca é do parceiro e é resolvida no servidor a partir do host.** A configuração de ambiente da ADR 0004 continua como marca do parceiro zero e como padrão.
5. **Domínios em etapas:** primeiro subdomínio da plataforma (`<parceiro>.<domínio-da-plataforma>`), depois domínio próprio com verificação de posse e certificado automático.
6. **Dois modos de cobrança, escolhidos pelo parceiro com a chave "Ativar checkout"** no console dele, **desligada por padrão**. O modo fica gravado em cada assinatura, e mudar a chave só afeta quem já é cliente no fim do período pago. A plataforma não custodia o dinheiro dos parceiros.
   - **Cliente paga (chave ligada):** o checkout da plataforma aparece no painel do cliente, e o cliente paga a ativação e as mensalidades pelo preço do parceiro. O provedor divide o valor na origem entre a conta do parceiro e a da plataforma. Preço do parceiro ≥ preço mínimo do plano base. Repasse da plataforma = maior valor entre o percentual da plataforma (padrão 30%) e o repasse mínimo do plano; o parceiro recebe o restante.
   - **Parceiro paga (chave desligada, padrão):** o parceiro cadastra o cliente e cuida da cobrança no próprio painel, ativação e mensalidades. Ele paga à plataforma só o **valor base da plataforma** para o plano escolhido e cobra o cliente por conta própria. Não há divisão, e o cliente não vê cobrança no produto.
   - Pisos, percentuais, valores base e preços são versionados. Mudanças não alteram assinaturas existentes sem processo explícito (§18).
7. **Provedores atrás de uma porta única** (`PaymentProvider`), com três adaptadores previstos: **Iugu**, **Stripe** e **manual**. O manual cobre pilotos e acordos fora do gateway: registro de pagamentos com evidência e relatório de repasse.
8. **Comunicação com a identidade do parceiro.** E-mails de autenticação, convites, cobrança e avisos usam marca, remetente e contato de suporte do parceiro, por uma porta única de notificação. Os e-mails de autenticação passam a ser enviados pela plataforma (hook de envio do Supabase Auth), não pelos modelos únicos do projeto.
9. **Termos e privacidade versionados por parceiro**, com registro de aceite por versão.

## Consequências

- O núcleo ganha o contexto `app.partner_id`, com RLS no mesmo padrão da ADR 0001, e tabelas de parceiros, domínios, membros, marca, documentos legais, conta de recebimento, planos do parceiro, regras de divisão, pagamentos e eventos de provedor. O SQL nasce em migrations próprias, aprovadas no PR.
- Os pontos que dá para preparar já estão listados na especificação (§9), sem regra comercial inventada. Planos, cobrança e acesso de suporte seguem a ordem da ADR 0003 (F3).
- Mover `/admin` para `/platform` é mais barato agora, com poucas páginas administrativas.
- **Fora do código, exigem validação antes de produção:** emissão de nota fiscal e enquadramento tributário na divisão (contador), papéis de controlador e operador na LGPD e contrato com parceiros (jurídico), e as condições contratuais de cada provedor.
- Identidade continua global (um projeto Supabase Auth). No domínio de um parceiro, o login só mostra empresas daquele parceiro, e a sessão vale só naquele domínio.
