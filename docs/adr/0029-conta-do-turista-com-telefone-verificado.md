# ADR 0029 — Conta do turista com telefone verificado, senha, Google e Apple

- **Status:** Proposto; vira aceito com a aprovação do Marcelo no PR
- **Data:** 30/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** decisão do Marcelo de 30/10/2026, ao aprovar o modelo das telas de login, cadastro e código do guidu.chat
- **Ajusta:** [ADR 0027](0027-guidu-chat-v1-console-bridge.md), só na seção 8 (identidade do turista), e a decisão N4 de 24/10/2026 no que diz respeito à forma de entrar. O projeto Supabase próprio do guidu.chat continua valendo
- **Relaciona-se com:** [ADR 0028](0028-qr-mini-app-publico-e-telas-nativas.md), [equipes-guidu-chat-v1.md](../gestao/equipes-guidu-chat-v1.md)

## Contexto

A N4 e a seção 8 da ADR 0027 definem a entrada do turista como telefone e código, e a especificação do Cliente Hub deixa Apple e Google para depois.

O telefone é o que permite continuar a conversa pelo WhatsApp e o que liga a pessoa no CRM. Por isso, toda conta precisa ter um número verificado.

**Alternativas que caíram:**

- **Só telefone e código:** cada login custaria um envio e dependeria da entrega da mensagem, o que pesa para turista estrangeiro.
- **Google e Apple sem telefone:** criaria contas com as quais a loja não consegue falar pelo WhatsApp.
- **Código só por SMS:** não prova que o número tem WhatsApp.
- **Código só por WhatsApp:** deixaria de fora quem não tem o aplicativo ou está sem internet.

## Decisão

Decidido pelo Marcelo em 30/10/2026.

1. **O telefone é o identificador principal da conta**, no lugar do e-mail.
2. **Toda conta tem telefone verificado (P0).** Não há como usar as rotas com conta sem ele.
3. **Entrada com telefone e senha.** A verificação por código acontece no cadastro e na recuperação de senha, não a cada login.
4. **Google e Apple entram na V1**, com uma etapa obrigatória de informar e verificar o telefone. Até lá, a sessão fica incompleta: `GET /me` traz `phone_verified: false`, e as rotas com conta respondem `403 phone_required`.
5. **O código vai pelo WhatsApp, com SMS de reserva** à escolha da pessoa, depois de 60 segundos.
6. **Telefone que já tem conta não é revelado antes do código.** Depois dele:
   - Vindo de Google ou Apple, o provedor é ligado à conta existente, porque o código provou que o número é da pessoa.
   - Vindo do cadastro, a pessoa é levada ao login.
7. **Erros não revelam se o número tem conta:** login com mensagem genérica e recuperação com a mesma resposta nos dois casos.
8. **A sessão continua no servidor:** cookie `HttpOnly` no web e `expo-secure-store` no app, como na ADR 0027. Não há opção "Lembrar de mim".

## Consequências

- **Equipe guidu.chat:** as telas estão prontas contra o servidor simulado, com o esquema em `packages/api/src/auth.ts` e `mocks/auth.ts`, no guidu-chat.
- **Equipe console, a definir:**
  - rotas de login em `api.guidu.chat`, para o app continuar falando só com a API, ou uma exceção formal à regra de ouro da ADR 0027;
  - fornecedor do código com WhatsApp e SMS, custo por envio e modelo de mensagem aprovado no WhatsApp;
  - limites de envio e de tentativas por telefone e por IP, que ficam no servidor;
  - como ligar Google ou Apple a uma conta existente no Supabase Auth.
- **Marcelo, a definir:** quem cria e paga as contas Google Cloud e Apple Developer, e o texto dos termos e da política de privacidade, com o jurídico.
- **Custo:** cada verificação tem custo de envio; o login comum não tem.
- **Reversível:** em parte. As telas e o fluxo mudam sem migração de dados, mas contas já criadas continuam tendo senha.
