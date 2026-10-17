# Domínios personalizados

Etapa CF2b. Cobre o domínio do painel do parceiro e os domínios públicos dos workspaces, com a mesma infraestrutura do linkko: EasyPanel, Traefik e Cloudflare for SaaS. Os endereços padrão de cada tipo de rota pública (`rodobens.mobio.pro`) e o domínio padrão do parceiro são da CF2c: [dominios-publicos.md](dominios-publicos.md).

## Quem gerencia o quê

| Domínio                      | Quem gerencia                                         | Onde                                                                |
| ---------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Hosts da plataforma          | operação, por variável de ambiente                    | `APP_URL` e `PLATFORM_HOSTS`                                        |
| Subdomínio do parceiro       | owner e operations da plataforma                      | /platform › Parceiros                                               |
| Domínio do painel            | owner e admin do parceiro                             | /admin › Configurações › Domínios                                   |
| Domínio público do workspace | owner e admin do workspace; owner e admin do parceiro | /app › Configurações › Domínios e /admin › Configurações › Domínios |

O cliente nunca troca o domínio do painel. A quantidade de domínios públicos vem da cota `core.public_domains` do plano; sem o número no plano, o limite é 0.

## Fluxo

1. O usuário cadastra o host. Ele entra como pendente e a tela mostra o CNAME para `CUSTOM_DOMAIN_CNAME_TARGET`.
2. "Verificar" confere o CNAME. Com o Cloudflare configurado, cria ou atualiza o Custom Hostname (SSL DV por HTTP) e só ativa quando o certificado está ativo. Sem o Cloudflare, o DNS correto basta.
3. Um domínio ativo nunca volta a pendente por uma verificação que falhou.
4. Remover pede confirmação, apaga a linha e, quando há, o Custom Hostname no Cloudflare.

Um host é único entre `partner_domains` e `workspace_domains`; o banco garante isso.

## Variáveis

| Variável                     | Uso                                                                |
| ---------------------------- | ------------------------------------------------------------------ |
| `CUSTOM_DOMAIN_CNAME_TARGET` | Destino do CNAME (ex.: `proxy.guidu.com.br`). Sem ele, nada ativa. |
| `CLOUDFLARE_API_TOKEN`       | Token com permissão de SSL and Certificates na zona do proxy.      |
| `CLOUDFLARE_ZONE_ID`         | Zona do Cloudflare for SaaS.                                       |
| `DOMAINS_CHECK_SECRET`       | Segredo do ForwardAuth, com 16 caracteres ou mais.                 |

## Traefik

Os hosts personalizados passam por um ForwardAuth antes de chegar ao painel. O middleware `forwardAuth` aponta para `http://<serviço web>:3000/api/domains/check`. O Traefik já envia o host original em `X-Forwarded-Host`; o segredo vai em `X-Check-Secret`, acrescentado por um middleware `headers` antes do `forwardAuth` na cadeia do roteador dos hosts personalizados. A configuração exata fica para a implantação no EasyPanel, como no linkko.

O endpoint responde 200 para um domínio ativo de um parceiro ativo ou de um workspace ativo, e 403 para todo o resto, inclusive segredo errado e banco fora do ar. O resultado fica 5 minutos no Redis; verificar ou remover limpa a entrada na hora.

## Pendências

- Resolvido na WS1: a limpeza de um workspace excluído remove antes os Custom Hostnames no Cloudflare (gancho `core.workspace_domains` da limpeza externa) e só depois apaga as linhas de `workspace_domains` e as escolhas das ferramentas. Um 404 do Cloudflare conta como já removido. Sem o Cloudflare configurado, os hostnames ficam e o resultado registra `cloudflare: "off"`. Veja [exclusao-suave-workspace.md](exclusao-suave-workspace.md).
- As rotas públicas (site, perfil digital, quiz) ainda não existem. `resolvePublicHost` (CF2c) já devolve o workspace e o tipo de um host. O caminho depois do host (slug, histórico e carência) está planejado na [CF2e](plano-cf2e-enderecos-publicos.md).
- O Cloudflare como integração da plataforma (vários serviços) fica para uma etapa própria.
