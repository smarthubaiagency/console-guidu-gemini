# CF2c. Núcleo, domínios públicos padrão

Escopo aprovado pelo Marcelo (decisão 4 de `cartao-digital/plano-perfil-digital.md` e linha CF2c da tabela de etapas). Base: CF2b (`plano-dominios.md`, `src/core/domains`, cota `core.public_domains`). Branch `claude/cf2c-dominios-publicos`, migration `20261120090000_cf2c_public_domains.sql`.

## Objetivo

Toda rota pública (perfil digital, quiz, páginas e sites) ganha um endereço padrão sem configuração: `{slug-do-workspace}.{domínio padrão do tipo}/{slug}`. O parceiro pode trocar o domínio padrão de cada tipo para os clientes dele. O workspace pode usar os domínios próprios da CF2b, e cada ferramenta escolhe o domínio pelo seletor. O host da requisição resolve para workspace e tipo, para a rota pública da DP1a.

## Decisões (defaults adotados; os três primeiros estão a confirmar pelo Marcelo)

1. O subdomínio padrão não conta na cota `core.public_domains` (não é linha de `workspace_domains`; é derivado do slug).
2. O domínio padrão ativo do parceiro substitui o da plataforma para os clientes dele: nesse tipo, o subdomínio no domínio da plataforma deixa de abrir para esses workspaces (white label).
3. Quiz no mesmo formato: `rodobens.quiz.mobio.pro/{slug}`.
4. Domínios padrão da plataforma por variável de ambiente (`PUBLIC_DOMAIN_PROFILE`, `PUBLIC_DOMAIN_QUIZ`, `PUBLIC_DOMAIN_PAGE`), com `mobio.pro`, `quiz.mobio.pro` e `mobio.page` como padrão; valor vazio desliga o tipo. Motivo: trocar o domínio exige DNS curinga e certificado no Traefik (operação), como `APP_URL` e `PLATFORM_HOSTS` na CF2b. Uma tela na /platform fica para quando a Cloudflare virar integração.
5. Tipos de rota: `profile`, `quiz`, `page`.
6. Domínio padrão do parceiro: tabela nova `partner_public_domains`, um por tipo por parceiro, com verificação por DNS (CNAME do host e do curinga `*.host` para `CUSTOM_DOMAIN_CNAME_TARGET`). O parceiro da casa não cadastra (o padrão dele é o da plataforma). O certificado curinga do domínio do parceiro é operação (guia em `docs/operacao/dominios-publicos.md`); o app não cria Custom Hostname curinga no Cloudflare nesta etapa.
7. Escolha por ferramenta: tabela `workspace_public_routes` (workspace, `tool_key`, tipo, domínio próprio). Só existe linha quando a ferramenta usa um domínio próprio ativo; sem linha, vale o subdomínio padrão do tipo. Remover o domínio apaga a escolha (volta ao padrão). Duas ferramentas podem usar o mesmo domínio próprio (a DP1a separa pelo caminho). `tool_key` é texto validado (sem manifesto público, que é da DP1a).
8. Resolução de host (`resolvePublicHost`): host da plataforma → nada; domínio próprio ativo → workspace (+ ferramentas que o escolheram); senão o maior domínio padrão que é sufixo do host (plataforma ou parceiro ativo): host igual ao domínio padrão → "base" (raiz do tipo); um rótulo só antes do domínio → workspace ativo com esse slug, se o rótulo não é reservado e o dono confere (parceiro da base, ou sem substituição do parceiro na base da plataforma). Qualquer outra coisa é desconhecida.
9. Rótulos reservados (www, api, app, admin, mail, etc.) e rótulos que formam outro domínio padrão (`quiz` sob `mobio.pro`) nunca resolvem para workspace; o workspace com esse slug fica sem subdomínio padrão nesse tipo (a tela avisa).
10. Colisões: um domínio próprio (painel ou workspace) não pode ficar sob um domínio padrão da plataforma (app) nem de parceiro (gatilho no banco); um domínio padrão de parceiro não pode conter hosts já cadastrados nem ficar sob outro.
11. ForwardAuth (`/api/domains/check`) passa a liberar também os hosts padrão que resolvem.
12. Limpeza de workspace excluído (F3e) passa a apagar `workspace_public_routes` e `workspace_domains` (a CF2b deixou as linhas).

## Telas

- /app › Configurações › Domínios: card novo "Endereços padrão" com o subdomínio de cada tipo.
- /admin › Configurações › Domínios: card novo "Domínios padrão dos clientes": o padrão da plataforma por tipo e o domínio próprio do parceiro (cadastrar, instruções com os dois CNAMEs, verificar, remover).
- Seletor: componente `PublicDomainPicker` e serviço/ação prontos para a DP1a; não montado em nenhuma ferramenta ainda.

## Testes

Suíte SQL `tests/core/public-domains-rls.sql`; unidade (`public-host.test.ts`, verificação do curinga); integração `tests/core/public-domains.test.ts`; e2e `e2e/public-domains.spec.ts`.

## Pendências

- Certificado curinga dos domínios padrão de parceiro (Cloudflare for SaaS curinga ou DNS-01): operação.
- Troca do slug do workspace muda o subdomínio padrão sem redirecionamento.
- Rota pública e destino público no manifesto: DP1a.
