# CF5. Segurança, autenticação, manutenção e operações

Pedido do Marcelo em 14/10/2026, dentro do plano de construção das configurações (menus-admin-app.md). Nada aqui muda a configuração do Supabase Auth nem chama a API de gestão do Supabase: isso mexe no Auth e precisa de aprovação do Marcelo.

Base: levantamento.md, itens 6 (Segurança), 7 (Autenticação) e 15 (Manutenção), o "Menu final proposto" e a "Estrutura das telas de configurações".

## O que já existe

- O login é do Supabase Auth: senha, sessão, tentativas e senha vazada ficam na configuração do Auth do projeto, fora do nosso banco.
- MFA por TOTP existe. A /platform e o /admin já exigem MFA em toda página e ação (`requirePlatformAdminPage`, `requirePartnerConsolePage`, `platformActor`, `partnerActor`).
- Quem não tem fator é mandado para `/app/account/security`, fora do workspace, então sempre consegue ativar.
- HTTPS, HSTS e CSP são fixos no código (`src/core/security/headers.ts`).
- `audit_events` só aceita gravação: ninguém lê pelo app. Um gatilho no banco grava `auth.mfa_enrolled` e `auth.mfa_unenrolled`. Não há registro de login.
- O cadastro é só por convite. Não há modo manutenção. `/platform/operations` mostra saúde, filas e falhas.

## Divisão proposta

### CF5a. Segurança: feita em 15/10/2026, branch claude/cf5-seguranca (commit 2096172), aguardando PR

Entrada "Segurança" em Configurações na /platform, no /admin e no /app (no /app só a MFA da equipe).

- **Acesso › MFA obrigatória por área:**
  - /platform e /admin: sempre exigida. Já é assim no código e fica fixo, a tela só mostra.
  - /app: nova chave da cascata `security.mfa.app` (CF1). A plataforma pode exigir de todos, o parceiro dos seus clientes e o workspace da sua equipe.
  - A chave só aperta: se um nível de cima exige, os de baixo não desligam (a tela mostra "exigida por ...").
  - Quem entra num workspace que exige MFA sem ter feito o segundo fator vai para `/auth/mfa`; sem fator, para a página de ativação. Ações devolvem "confirme a MFA" no SmartStatusBanner. A API e o MCP usam chave, então não mudam.
  - O workspace só liga a exigência se quem salva já está com MFA, para não se trancar fora sem querer.
- **Acesso › Lista de IPs (opcional):**
  - Uma lista para a /platform (plataforma) e uma por parceiro para o /admin dele. Lista vazia = sem restrição.
  - Tabela própria `ip_allowlists` (endereços em `cidr[]`), e não a cascata: a cascata é lida por todos e os IPs não devem vazar.
  - Vale em todas as páginas e ações da área (pelos guardas de papel da plataforma e do parceiro). Não vale para chaves de API.
  - Nunca tranca quem salva: o servidor recusa uma lista que não inclui o IP da própria requisição e valida cada endereço.
  - Leitura do IP atrás do Traefik (`X-Forwarded-For` e `TRUSTED_PROXY_HOPS`) e o caminho de recuperação ficam em `docs/operacao/seguranca.md`. `SECURITY_IP_ALLOWLIST=off` desliga a checagem numa emergência.
- **Eventos (só leitura):** lista de `audit_events` de segurança: logins, MFA, chaves de API e credenciais, papéis e membros, convites, acesso de suporte e mudanças de segurança.
  - A plataforma (owner, operations e support) vê tudo. O parceiro (owner e admin) vê o que é dele: eventos com o seu id e eventos das empresas dos seus clientes.
  - A leitura é por uma função `security definer`; a tabela continua sem leitura direta.
  - Passa a registrar o login (`auth.sign_in`) e o segundo fator (`auth.mfa_verified`, `auth.mfa_failed`).
- **Senha e sessão (só leitura):** card que explica que senha, sessão, tentativas e senha vazada moram no Supabase Auth, sem mostrar nem mudar valores.
- Toda mudança é auditada (`<nível>.settings.save` e `<nível>.security.ip_allowlist.save`).
- Migration `20261116090000_cf5a_security.sql`, teste SQL `tests/core/security-rls.sql`, testes de unidade, integração e e2e.

### CF5b. Autenticação: feita em 15/10/2026, branch claude/cf5b-autenticacao, aguardando PR

- Tela Configurações › Autenticação na /platform e no /admin (`/platform/settings/authentication`, `/admin/settings/authentication`), em Sistema, ao lado de Segurança. Lê quem lê Segurança (plataforma owner, operations e support; parceiro owner e admin); muda quem gere as configurações do nível.
- Card "Cadastro e verificação", só leitura: cadastro só por convite, verificação de e-mail sempre ligada (o convite confirma o e-mail), MFA com link para Segurança, cadastro público e SAML "ainda não disponíveis".
- **Login com Google** e **link mágico:** chaves da cascata `auth.google` e `auth.magic_link` (plataforma e parceiro), desligadas por padrão. A plataforma oferece; o parceiro só pode esconder nos seus domínios (regra nova "só desliga" do catálogo, `turnOffOnly`). App OAuth do Google da GUIDU.
- **Supabase Auth intocado** (decisão do Marcelo, 15/10/2026): nada de provedor, `config.toml` ou API de gestão. O botão só aparece com o provedor ligado pela operação e avisado no ambiente (`AUTH_GOOGLE_ENABLED=true`, `AUTH_MAGIC_LINK_ENABLED=true`) **e** com a cascata oferecendo no host. Quem liga o quê e em que ordem: `docs/operacao/autenticacao.md`.
- Login: "Entrar com Google" (`signInWithOAuth`) e "Receber link de acesso por e-mail" (`signInWithOtp` com `shouldCreateUser: false`, resposta igual para qualquer e-mail). As ações conferem provedor e cascata de novo no servidor.
- `/auth/callback`: volta para o host onde a pessoa estava (APP_URL nos hosts da plataforma, o domínio do parceiro quando ativo, APP_URL nos desconhecidos) e passa por `/auth/mfa` quem tem segundo fator.
- Toda mudança é auditada (`platform.settings.save`, `partner.settings.save`) e aparece em Segurança › Eventos.
- Migration `20261117090000_cf5b_auth.sql` (`private.auth_login_settings` e eventos de segurança com `auth.*`), teste SQL `tests/core/auth-settings-rls.sql`, testes de unidade, integração (`tests/core/auth-settings.test.ts`) e e2e (`e2e/auth-settings.spec.ts`).
- Cadastro público e SAML ficam para depois (levantamento).

### CF5c. Manutenção e operações: feita em 15/10/2026, branch claude/cf5c-manutencao, sem commit

- Operações ganha abas: "Saúde e filas" (`/platform/operations`) e "Manutenção" (`/platform/operations/maintenance`). Lê quem lê Operações (owner, operations e support); muda quem gere as configurações da plataforma (`platform.settings.manage`).
- Uma janela só, tabela `platform_maintenance` de linha única: ligada ou não, modo (`maintenance` ou `read_only`), início e fim (opcionais), mensagem em pt-BR, en e es (até 500 caracteres) e quem salvou. Botão "Encerrar agora".
- **Modo manutenção:** /app, /admin e os convites mandam para `/maintenance` (mensagem no idioma da pessoa e hora de volta); ações devolvem "plataforma em manutenção" no SmartStatusBanner. A API pública e o MCP de workspace respondem 503 JSON com `Retry-After`. A /platform segue aberta e gravável para os admins com MFA.
- **Somente leitura:** páginas abrem com a faixa de aviso; toda ação (server action) do /app e do /admin é recusada no SmartStatusBanner; na API, leituras passam (GET e buscas com escopo `:read`) e gravações recebem 503 com `Retry-After`; o MCP de workspace só lista e roda ferramentas de leitura.
- **Jobs e webhooks:** a entrada dos webhooks continua aberta e grava o evento e o job como sempre. O worker segura a fila nos dois modos: não despacha, e um job já despachado volta para `pending`. Nada se perde; ao fim da janela tudo roda.
- **Agentes de IA em manutenção total:** os canais (`/api/channels/*`) recebem e guardam a mensagem e o job de resposta; o worker segura o job e, quando a janela termina (fim agendado ou "Encerrar agora"), responde em ordem.
- **Faixa de aviso:** aparece em todas as telas logadas (e no login) 24 h antes do início e durante a janela, com "hoje/amanhã às ...".
- **Leitura barata e segura:** função `private.maintenance_state()` (`security definer`, só a linha ativa, sem quem salvou) lida no máximo a cada 5 s por processo, com uma leitura em voo por vez. Se a leitura falhar, usa o último valor bom por até 5 min e depois considera desligada (falha aberta: um banco fora do ar já derruba o app de qualquer jeito, e a manutenção não pode trancar a /platform). O processo que salva limpa o cache na hora; os demais veem em até 5 s.
- **Rotas que nunca fecham:** /platform, `/api/v1/platform`, `/mcp/platform`, /login, `/auth/*` (callback e MFA), /forgot-password, /reset-password, /app/account/security, /maintenance, /legal, /brand, `/api/health/*`, `/api/domains/check`, `/api/channels/*` (webhooks de entrada) e `/api/v1/openapi.json`. A lista também aparece na aba.
- Toda mudança é auditada (`platform.maintenance.save` com estado, modo, campos, início e fim, sem as mensagens; `platform.maintenance.end`).
- Migration `20261118090000_cf5c_maintenance.sql`, teste SQL `tests/core/maintenance-rls.sql`, testes de unidade (`src/core/maintenance/*.test.ts`), integração (`tests/core/maintenance.test.ts`) e e2e (`e2e/maintenance.spec.ts`, que desliga a janela direto no banco ao fim, mesmo com falha).

Cada parte é um PR com testes SQL, de integração e e2e. As migrations são aplicadas no dev pelo Marcelo depois do PR.

## Decisões tomadas sem perguntar (CF5a)

- MFA no /admin continua sempre exigida. O levantamento diz que o parceiro decide para o /admin, mas o código já exige e afrouxar seria um passo para trás.
- `security.mfa.app` só aperta, nunca afrouxa, e vem desligada por padrão.
- A lista de IPs não vale para a API da plataforma nem para chaves de API: elas são de máquinas, com IPs que mudam. Fora de uma requisição (worker, testes) não há IP e a checagem não se aplica.
- O IP do cliente é o `TRUSTED_PROXY_HOPS`-ésimo endereço do `X-Forwarded-For` a partir da direita (padrão 1, o que o Traefik acrescenta). Sem IP legível, uma área com lista nega o acesso.
- Lista com até 50 endereços (IPv4 ou IPv6, com ou sem máscara).
- Bloqueio por IP não é registrado em `audit_events`, para não encher a tabela; o login e a MFA são.
- O parceiro vê o e-mail só dos seus membros; nos demais eventos aparece o id do usuário.
- A lista de eventos mostra 50 por página, do mais novo para o mais antigo, com "Mais antigos".

## Decisões tomadas sem perguntar (CF5b)

- Link mágico segue a mesma regra do Google: a plataforma oferece e o parceiro só esconde. O parceiro não liga sozinho o que a plataforma não oferece.
- A plataforma não trava as duas chaves: o parceiro sempre pode esconder.
- Os sinais do provedor são variáveis do serviço web (`AUTH_GOOGLE_ENABLED`, `AUTH_MAGIC_LINK_ENABLED`); só `true` conta. Se a leitura das configurações falhar, os botões somem e a senha continua.
- O link mágico reaproveita o campo de e-mail do login; o Google é um formulário à parte, para a senha nunca ir junto.
- Conta Google sem convite é barrada pelo próprio Supabase com "Allow new users to sign up" desligado; o passo a passo manda conferir isso antes de ligar.
- Mudança de `auth.*` entra em Segurança › Eventos, com o mesmo rótulo "Segurança da plataforma/do parceiro alterada".
- Nos hosts da plataforma vale o parceiro da casa; num host desconhecido, só a plataforma.

## O que ficou de fora (CF5b)

- Ligar os provedores no Supabase Auth, criar o cliente OAuth do Google e incluir as Redirect URLs dos domínios de parceiro: passo da operação, com aprovação do Marcelo.
- Cadastro público, SAML, Apple e o "papel padrão" (o papel vem do convite).
- Teste ponta a ponta do retorno real do Google e do e-mail do link: o rig não tem os provedores; o e2e confere o botão e a ida ao provedor com o retorno do host, e os testes de unidade cobrem o `/auth/callback`.

## Decisões tomadas sem perguntar (CF5c)

- O bloqueio fica no guarda comum (`guard()`), por onde passa toda página e ação, e não no `proxy.ts`, que não decide acesso.
- Admins da plataforma também são barrados no /app e no /admin durante a janela; só a /platform fica aberta.
- `/app/account/security` fica aberta para ninguém perder a ativação da MFA; os convites fecham.
- A /platform continua gravável nos dois modos.
- O worker segura os jobs também no somente leitura, então os agentes só respondem ao fim da janela.
- No somente leitura, a recusa é só nas ações; páginas e rotas GET abrem.
- `Retry-After`: segundos até o fim; sem fim, 600 s (mínimo 30 s).
- Início vazio = agora; fim vazio = até alguém encerrar. O fim precisa ser depois do início e no futuro.
- Datas do formulário no fuso de São Paulo.
- Mensagem vazia num idioma cai no pt-BR; vazia em todos, só o texto padrão.
- Cache de 5 s por processo, com falha aberta.
- A resposta 503 da API vem em inglês, como os demais erros da API.

## O que ficou de fora (CF5c)

- Lista de IPs (retirada do plano).
- Agentes respondendo durante o somente leitura.
- Pré-visualização do /app pelos admins da plataforma durante a janela.
- Barreira no banco para gravações que não passem pelo `guard()`.
- Estado no Redis, antecedência da faixa configurável e várias janelas agendadas.
