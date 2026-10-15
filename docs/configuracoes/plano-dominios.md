# Domínios personalizados (plataforma, parceiro e workspace)

Pedido do Marcelo em 14/10/2026: o white label gerencia os domínios personalizados da plataforma e dos parceiros. O parceiro (/admin) gerencia os domínios personalizados dos workspaces dos seus clientes. Isso é a base do perfil público do módulo de cartão de visita inteligente. Seguir o modelo já testado no `smarthubaiagency/cartaopro-linkko`.

## 1. Como o legado faz (cartaopro-linkko)

Arquivos lidos: `lib/server/cloudflare.ts`, `lib/server/domain-resolver.ts`, `app/api/domains/{verify,activate,status,retry-ssl,check}/route.ts`, `components/client/CustomDomainConfiguratorClient.tsx`, `proxy.ts`.

1. **Instrução.** O cliente digita o domínio, e a tela mostra o CNAME a criar: `host → proxy.mobio.pro`.
2. **Verificar** (`/api/domains/verify`):
   - o servidor resolve o CNAME e confere se ele aponta para o alvo;
   - se apontar, cria (ou reaproveita) um **Custom Hostname no Cloudflare for SaaS**, com SSL DV validado por HTTP;
   - grava o domínio como `pending` com o `cloudflare_hostname_id`;
   - se o certificado estava travado, um `PATCH` dispara a validação de novo.
3. **Acompanhar o SSL** (`/api/domains/status`): a tela consulta a cada 5 s o status do certificado no Cloudflare, que pode ser `active`, `pending` ou `error`. Se der erro, o botão "Tentar SSL novamente" chama `/api/domains/retry-ssl`.
4. **Ativar** (`/api/domains/activate`):
   - só o admin do workspace pode ativar, e o recurso é exclusivo do plano PRO;
   - o servidor confere o DNS de novo, marca `active` e `is_primary`, e limpa o cache.
5. **Liberar o tráfego** (`/api/domains/check`):
   - é o ForwardAuth do Traefik, chamado em cada requisição a um host personalizado, com um segredo compartilhado (`X-Check-Secret`);
   - responde 200 só se o domínio estiver `active`; qualquer falha nega o acesso (fail-closed);
   - guarda o resultado em cache no Redis por 5 min.
6. **Resolver o host** (`domain-resolver.ts`): busca primeiro no cache do Redis, depois nos domínios personalizados ativos, depois nos subdomínios do sistema (`system_allowed_domains` e `assigned_base_domain`). Uma resposta "não encontrado" nunca vai para o cache.
7. **Remover:** apaga o Custom Hostname no Cloudflare.

Configuração: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `DOMAINS_CHECK_SECRET` e o alvo do CNAME (fixo no código).

## 2. O que o GUIDU já tem

- A tabela `partner_domains`, com `kind` (`subdomain` ou `custom`) e `status` (`pending`, `active` ou `disabled`).
- Hoje só a plataforma cadastra domínios, em /platform › Parceiros, e ativa na mão. Não há verificação de DNS; o comentário no código diz "até a P7".
- `src/core/partners/hosts.ts`: `normalizeHost`, `platformHosts` e `partnerSubdomainBase` (`PARTNER_SUBDOMAIN_BASE`).
- O host da requisição já escolhe o parceiro (`getRequestPartner`), e com ele a marca.
- A F6e (plano-f6.md) previa "subdomínios e domínio próprio do parceiro, com prova de posse e certificado automático". Esta etapa adianta essa parte.

## 3. Proposta para o GUIDU

### Níveis

| Domínio de          | Quem gerencia                                          | Onde                                                                       | Para quê                                                             |
| ------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Plataforma          | owner e operations da plataforma                       | /platform › Marca › Domínios                                               | hosts próprios do GUIDU (hoje vêm por variável de ambiente)          |
| Parceiro            | a plataforma, e o próprio parceiro (owner e admin)     | /platform › Parceiros e /admin › Marca › Domínios                          | painel white label do parceiro (`/admin` e `/app` dos clientes dele) |
| Workspace (público) | o cliente (owner e admin) e o parceiro (owner e admin) | /app › Configurações › Domínios e /admin › Clientes › workspace › Domínios | rotas públicas do workspace: site, perfil digital, quiz              |

Decidido por Marcelo em 14/10/2026:

- O parceiro troca o domínio da própria instalação, por exemplo de `console.guidu.co` para `console.dominiodoparceiro.com`. Esse é o domínio do painel do parceiro e dos clientes dele.
- O cliente, seja da casa ou de um parceiro, **não** troca o domínio do painel.
- O cliente **cadastra e gerencia o domínio público do workspace** em /app › Configurações › Domínios. O parceiro também gerencia esses domínios em /admin.
- O domínio público serve a toda rota pública do workspace (site, perfil digital, quiz e o que vier depois).
- A quantidade de domínios públicos depende do plano contratado.

### Fluxo (o mesmo do legado, com estes ajustes)

1. **Cadastrar:** o host é normalizado, recusado se for da plataforma ou já estiver em uso, e entra como `pending`.
2. **Instrução:** a tela mostra o CNAME para o alvo (`CUSTOM_DOMAIN_CNAME_TARGET`).
3. **Verificar:** o usuário clica em "Verificar". Um job confere o CNAME, cria ou atualiza o Custom Hostname no Cloudflare e guarda o id.
4. **Certificado:** o job acompanha o SSL até `active`, em vez de a tela consultar o status a cada 5 s. A tela mostra o estado e o botão "Tentar de novo".
5. **Ativar:** o domínio fica ativo quando o DNS e o SSL estão OK. O status reconfere o DNS no servidor.
6. **Tráfego:** `/api/domains/check` (ForwardAuth), com segredo, fail-closed e cache no Redis. O resolvedor do proxy passa a mapear o host para o parceiro ou para o workspace.
7. **Remover e desativar:** apaga o hostname no Cloudflare e limpa o cache.
8. Tudo auditado, com RLS por nível e testes SQL, de integração e e2e (Cloudflare e DNS falsos nos testes, como o Chatwoot falso da A5).

### Dados

- `partner_domains` ganha colunas: `cloudflare_hostname_id`, `ssl_status`, `dns_checked_at`, `last_error`.
- Tabela nova `workspace_domains`, com as mesmas colunas, mais `organization_id`, `workspace_id` e `is_primary`.
- Domínios da plataforma: uma tabela `platform_domains`, ou chave no catálogo de configurações. Proposto: tabela, porque tem estado de DNS e SSL.
- Um host é único entre os três níveis.

### Limite por plano

O domínio do workspace segue o plano (no legado era só o PRO). Proposto: uma cota `domains.custom.max` no catálogo de planos (CF4), com padrão 0 até a CF4 existir.

## 4. Perguntas

1. ~~Infra~~: respondida em 14/10. Será a mesma do linkko (EasyPanel + Traefik + Cloudflare for SaaS). O alvo do CNAME fica numa variável de ambiente até ser definido. Depois, a Cloudflare entra como integração da plataforma, porque vamos usar vários serviços dela.
   Texto original da pergunta: o GUIDU vai rodar como o linkko (EasyPanel + Traefik + Cloudflare for SaaS)? Qual será o alvo do CNAME (ex.: `proxy.guidu.com.br`)? Até isso existir, tudo funciona com Cloudflare e DNS falsos e a ativação manual continua.
2. ~~Cliente no /app~~: respondida. O cliente gerencia o domínio público; o domínio do painel é só do parceiro.
3. ~~Etapa~~: respondida, será a CF2b, logo depois da CF2 Marca. Texto original da pergunta: fazer como **CF2b Domínios**, logo depois da CF2 Marca? Ou junto com a CF2?
4. ~~Limite por plano~~: respondida, é por plano. Proposto: a cota `domains.public.max`, com padrão 0 até a CF4.

## 5. Como ficou na CF2b (14/10/2026)

Entregue na branch `claude/loving-davinci-f0g1ux`, com a migration `20261111090000_cf2b_domains.sql`. Guia de operação: `docs/operacao/dominios.md` no repositório.

- **Painel do parceiro:** /admin › Configurações › Domínios. Owner e admin do parceiro cadastram, verificam e removem o domínio próprio do painel. Subdomínios da plataforma continuam sendo da /platform.
- **Domínios públicos:** /app › Configurações › Domínios (owner e admin do workspace) e o mesmo /admin › Configurações › Domínios, no card "Domínios dos clientes" (owner e admin do parceiro). O primeiro domínio ativo vira o principal.
- **Cota:** `core.public_domains` no catálogo de planos, padrão 0. Sem o número no plano, o cliente vê o aviso e não cadastra.
- **Verificação sob demanda,** pelo botão "Verificar", sem job agendado. Sem Cloudflare configurado, o DNS correto basta para ativar.
- **Domínios da plataforma** seguem em variável de ambiente (`APP_URL`, `PLATFORM_HOSTS`). Não foi criada a tabela `platform_domains`.
- **Host único** entre `partner_domains` e `workspace_domains`, garantido no banco.
- **ForwardAuth:** `/api/domains/check`, com `X-Check-Secret`, cache de 5 min no Redis e fail-closed.
- **Remoção** pede confirmação e apaga o hostname no Cloudflare. A limpeza de um workspace excluído apaga as linhas, mas ainda não os hostnames no Cloudflare (pendente).
- **Rotas públicas** ainda não existem. `resolvePublicDomain` já devolve o workspace de um host ativo para quando elas chegarem.
