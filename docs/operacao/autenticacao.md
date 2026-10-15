# Autenticação: cadastro, Google e link mágico

Etapa CF5b do plano das configurações (`/mnt/project-files/configuracoes/plano-cf5.md`). Telas em Configurações › Autenticação na /platform e no /admin.

## O que é fixo

| Item                    | Regra                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Cadastro                | Só por convite (plataforma, parceiro ou equipe do workspace). Não há cadastro público. |
| Verificação de e-mail   | Sempre ligada. O convite confirma o e-mail.                                            |
| MFA                     | Em Configurações › Segurança (CF5a, `docs/operacao/seguranca.md`).                     |
| Cadastro público e SAML | Ficam para depois (levantamento, item 7).                                              |
| App OAuth do Google     | Da GUIDU (decisão de 14/10/2026). O parceiro não traz app próprio.                     |

## Quando um botão aparece no login

Um botão ("Entrar com Google" ou "Receber link de acesso por e-mail") só aparece quando as duas condições valem:

1. **Provedor ligado pela operação.** O painel nunca muda o Supabase Auth. Depois de ligar o provedor no Supabase, a operação avisa o painel pelo ambiente do serviço web:
   - `AUTH_GOOGLE_ENABLED=true`
   - `AUTH_MAGIC_LINK_ENABLED=true`

   Qualquer outro valor (vazio, `1`, `yes`) conta como desligado.

2. **Cascata oferece no host** (chaves `auth.google` e `auth.magic_link`, ADR 0018):
   - A plataforma oferece (padrão: desligado).
   - O parceiro pode esconder nos domínios dele. Não consegue ligar o que a plataforma não oferece.
   - Nos hosts da plataforma vale o parceiro da casa; num host desconhecido, só a plataforma.

As ações do login conferem as duas condições de novo no servidor. Se a leitura das configurações falhar, os botões somem e o login com senha continua.

## Ordem para ligar

Cada passo que mexe no Supabase Auth precisa de aprovação do Marcelo registrada antes.

### Google

1. Conferir no Supabase Auth (Authentication › Sign In / Providers) que **"Allow new users to sign up" está desligado**. Assim o Google só entra em contas que já existem (convidadas); uma conta Google sem convite é recusada pelo próprio Supabase.
2. No Google Cloud da GUIDU, criar o cliente OAuth (tipo "Aplicativo da Web") com a URL de retorno do Supabase: `https://<projeto>.supabase.co/auth/v1/callback`.
3. No Supabase Auth, ligar o provedor Google com o Client ID e o Client Secret (o segredo fica só no Supabase).
4. Em Authentication › URL Configuration, incluir nas Redirect URLs o `APP_URL` e cada domínio de parceiro que vai usar o botão: `https://<host>/auth/callback**`.
5. No serviço web: `AUTH_GOOGLE_ENABLED=true` e reiniciar.
6. Em /platform › Configurações › Autenticação, marcar "Oferecer login com Google" e salvar.
7. Testar no host da plataforma e num domínio de parceiro.

### Link mágico

1. Mesma conferência do passo 1 do Google (cadastro desligado). O painel ainda pede o link com `shouldCreateUser: false`.
2. Conferir o modelo "Magic Link" de e-mail do Supabase Auth. O padrão (`{{ .ConfirmationURL }}`) funciona: o Supabase confere o link e volta para o `/auth/callback` do host com `code`. Um modelo próprio pode apontar direto para `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=magiclink`; o retorno aceita os dois.
3. Redirect URLs como no passo 4 do Google.
4. No serviço web: `AUTH_MAGIC_LINK_ENABLED=true` e reiniciar.
5. Em /platform › Configurações › Autenticação, marcar "Oferecer link mágico" e salvar.

### Para desligar

Na ordem inversa: desmarcar na tela (os botões somem na hora), tirar a variável, e só então desligar o provedor no Supabase Auth. Desligar o provedor antes da variável deixa o botão na tela levando a um erro ("Não foi possível concluir a autenticação").

## Retorno (`/auth/callback`)

- O Google e o link voltam para `/auth/callback` do host onde a pessoa estava: `APP_URL` nos hosts da plataforma, o domínio do parceiro quando ele é um domínio ativo. O retorno manda a pessoa para o mesmo host; num host desconhecido, para o `APP_URL`.
- Quem tem o segundo fator passa por `/auth/mfa` antes de seguir, como depois da senha.
- O login fica registrado em Segurança › Eventos (`auth.sign_in`, origem `callback`).

## Auditoria

Toda mudança na tela grava `platform.settings.save` ou `partner.settings.save` em `audit_events`, com as chaves alteradas em `fields`.

## Variáveis

| Variável                  | Padrão | Uso                                                       |
| ------------------------- | ------ | --------------------------------------------------------- |
| `AUTH_GOOGLE_ENABLED`     | vazio  | `true` depois de ligar o Google no Supabase Auth.         |
| `AUTH_MAGIC_LINK_ENABLED` | vazio  | `true` depois de conferir o link mágico no Supabase Auth. |
