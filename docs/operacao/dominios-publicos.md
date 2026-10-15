# Domínios públicos padrão

Etapa CF2c. Complementa os [domínios personalizados](dominios.md) da CF2b. Este guia é para quem opera a infraestrutura: o que configurar no Cloudflare e no Traefik (EasyPanel) para que os endereços padrão abram com HTTPS. Nada aqui é feito pelo app.

## O que o app faz

Cada tipo de rota pública tem um domínio padrão. Cada workspace responde num subdomínio dele, com o slug do workspace; o caminho depois (`/{slug}`) é da ferramenta (a rota pública chega na DP1a).

| Tipo            | Variável                | Padrão           | Endereço do workspace            |
| --------------- | ----------------------- | ---------------- | -------------------------------- |
| Perfil digital  | `PUBLIC_DOMAIN_PROFILE` | `mobio.pro`      | `rodobens.mobio.pro/{slug}`      |
| Quiz            | `PUBLIC_DOMAIN_QUIZ`    | `quiz.mobio.pro` | `rodobens.quiz.mobio.pro/{slug}` |
| Páginas e sites | `PUBLIC_DOMAIN_PAGE`    | `mobio.page`     | `rodobens.mobio.page/{slug}`     |

- Sem a variável, vale o padrão. Com a variável vazia, o tipo fica desligado.
- O subdomínio padrão não conta na cota `core.public_domains`.
- Nomes reservados (`www`, `api`, `app`, `admin`, `mail` e outros, em `src/core/domains/public-hosts.ts`) nunca viram workspace. O workspace `quiz` não tem perfil em `quiz.mobio.pro`, porque esse é o domínio do quiz; a tela avisa.
- O parceiro pode cadastrar o próprio domínio padrão de cada tipo em /admin › Configurações › Domínios (por exemplo `cartao.parceiro.com`). Quando ativo, ele substitui o da plataforma para os clientes daquele parceiro, e o endereço na plataforma deixa de abrir para eles.
- O workspace continua podendo usar domínios próprios (CF2b), e cada ferramenta escolhe o domínio pelo seletor.
- `/api/domains/check` (ForwardAuth) passa a responder 200 também para os endereços padrão que existem.

Trocar uma variável muda os endereços de todos os workspaces. Só troque depois que o DNS e o certificado do domínio novo estiverem prontos.

## 1. DNS no Cloudflare (domínios da plataforma)

As zonas `mobio.pro` e `mobio.page` ficam no Cloudflare. Crie os registros apontando para o servidor do EasyPanel, **sem proxy** (nuvem cinza), para o Traefik emitir os certificados:

| Zona         | Nome     | Tipo | Valor          |
| ------------ | -------- | ---- | -------------- |
| `mobio.pro`  | `@`      | A    | IP do servidor |
| `mobio.pro`  | `*`      | A    | IP do servidor |
| `mobio.pro`  | `*.quiz` | A    | IP do servidor |
| `mobio.page` | `@`      | A    | IP do servidor |
| `mobio.page` | `*`      | A    | IP do servidor |

Por que sem proxy: o certificado universal do Cloudflare cobre só um nível (`*.mobio.pro`), e o quiz precisa de dois (`rodobens.quiz.mobio.pro`). Com o proxy ligado, seria preciso o Advanced Certificate Manager. Se preferir o proxy, contrate o ACM com `*.quiz.mobio.pro` e use o modo SSL "Full (strict)".

## 2. Certificado curinga no Traefik

O curinga só sai por desafio de DNS (DNS-01). No Cloudflare, crie um token de API com **Zone › DNS › Edit** nas zonas `mobio.pro` e `mobio.page`, e cadastre no Traefik como `CF_DNS_API_TOKEN` (é segredo: só no painel do EasyPanel).

Configuração estática do Traefik (resolvedor de certificados):

```yaml
certificatesResolvers:
  publicwildcard:
    acme:
      email: operacao@mobio.pro
      storage: /letsencrypt/public-wildcard.json
      dnsChallenge:
        provider: cloudflare
        resolvers: ["1.1.1.1:53", "1.0.0.1:53"]
```

Configuração dinâmica (roteador para o serviço web do GUIDU, porta 3000):

```yaml
http:
  routers:
    guidu-public-defaults:
      rule: >-
        Host(`mobio.pro`) || HostRegexp(`^[a-z0-9-]+\.mobio\.pro$`) ||
        HostRegexp(`^[a-z0-9-]+\.quiz\.mobio\.pro$`) ||
        Host(`mobio.page`) || HostRegexp(`^[a-z0-9-]+\.mobio\.page$`)
      entryPoints: [websecure]
      service: guidu-web
      middlewares: [guidu-domain-secret, guidu-domain-check]
      tls:
        certResolver: publicwildcard
        domains:
          - main: mobio.pro
            sans: ["*.mobio.pro", "*.quiz.mobio.pro"]
          - main: mobio.page
            sans: ["*.mobio.page"]
```

Os middlewares `guidu-domain-secret` (cabeçalho `X-Check-Secret`) e `guidu-domain-check` (`forwardAuth` para `http://<serviço web>:3000/api/domains/check`) são os mesmos da CF2b. Com eles, um subdomínio que não existe recebe 403 já no Traefik. Os nomes do serviço e do entrypoint mudam conforme o EasyPanel.

## 3. Domínio padrão de um parceiro

O parceiro cadastra o domínio em /admin e cria dois CNAMEs no DNS dele, para `CUSTOM_DOMAIN_CNAME_TARGET`:

| Nome                    | Tipo  | Valor                        |
| ----------------------- | ----- | ---------------------------- |
| `cartao.parceiro.com`   | CNAME | `CUSTOM_DOMAIN_CNAME_TARGET` |
| `*.cartao.parceiro.com` | CNAME | `CUSTOM_DOMAIN_CNAME_TARGET` |

"Verificar" confere os dois (o curinga com um nome aleatório) e ativa pelo DNS. O app **não** emite o certificado desse curinga nesta etapa. Opções para a operação escolher:

1. **Cloudflare for SaaS com hostname curinga** (`*.cartao.parceiro.com`), validado por TXT. Confirme no plano da Cloudflare se o recurso está disponível; depois disso dá para automatizar no app, como a CF2b faz com os hostnames simples.
2. **DNS-01 no Traefik com delegação:** o parceiro cria `_acme-challenge.cartao.parceiro.com` como CNAME para uma zona nossa no Cloudflare, e o Traefik valida por ela.

Até uma das duas existir, o domínio do parceiro abre pelo DNS mas o HTTPS falha. Não ative domínio padrão de parceiro em produção antes disso.

## 4. Conferir

```bash
# 200: o workspace existe (troque o slug)
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Check-Secret: $DOMAINS_CHECK_SECRET" \
  -H "X-Forwarded-Host: rodobens.mobio.pro" https://<host do painel>/api/domains/check
# 403: nome reservado ou desconhecido
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Check-Secret: $DOMAINS_CHECK_SECRET" \
  -H "X-Forwarded-Host: www.mobio.pro" https://<host do painel>/api/domains/check
```

O resultado fica 5 minutos no cache do Redis. Remover o domínio padrão de um parceiro limpa só a entrada do próprio domínio; os subdomínios dos clientes param de abrir em até 5 minutos.

## Checklist do Marcelo

1. Zonas `mobio.pro` e `mobio.page` no Cloudflare, com os registros da seção 1.
2. Token `CF_DNS_API_TOKEN` (DNS Edit) no Traefik e o resolvedor `publicwildcard`.
3. Roteador dos domínios padrão no EasyPanel, com os middlewares da CF2b.
4. Se os domínios forem outros, as variáveis `PUBLIC_DOMAIN_*` no web e no worker.
5. Escolher como emitir o certificado curinga dos domínios de parceiro (seção 3).

## Pendências

- Certificado curinga dos domínios padrão de parceiro (seção 3).
- Trocar o slug do workspace muda os endereços padrão sem redirecionar os antigos.
- A rota pública (DP1a) usa `resolvePublicHost` (`src/core/domains/runtime.ts`) para chegar ao workspace e ao tipo.
