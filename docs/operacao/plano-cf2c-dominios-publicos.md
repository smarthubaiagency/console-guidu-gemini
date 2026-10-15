# Plano da CF2c — Domínios padrão e endereços públicos

- **Versão:** 0.1, 15/10/2026. Nada aqui foi implementado.
- **Tipo:** ajuste de plataforma (núcleo), não regra de módulo.
- **Origem:** decisões do Marcelo em 15/10/2026, durante o planejamento do [perfil digital](../modules/perfil-digital/plano-perfil-digital.md). Vale para todas as ferramentas com página pública: perfil digital, quiz, sites e landing pages.
- **Parte de:** [dominios.md](dominios.md) (CF2b), que já cobre o domínio do painel do parceiro e o domínio público do workspace.

## 1. Decisões

1. A plataforma tem um **domínio do painel** (ex.: `console.guidu.co`) e um **domínio padrão por tipo de rota pública**:

   | Tipo            | Exemplo de padrão | Endereço publicado      |
   | --------------- | ----------------- | ----------------------- |
   | Perfil digital  | `mobio.pro`       | `mobio.pro/{slug}`      |
   | Quiz            | `quiz.mobio.pro`  | `quiz.mobio.pro/{slug}` |
   | Sites e páginas | `page.mobio.pro`  | `page.mobio.pro/{slug}` |

   Os domínios são exemplos.

2. O **parceiro** pode substituir os domínios padrão da plataforma para os clientes dele, por tipo.
3. O **admin do workspace** (no `/app`) pode cadastrar **domínio próprio por tipo**: `cards.empresa.com/{slug}`, `quiz.empresa.com/{slug}`, `page.empresa.com/{slug}`.
4. **Cascata.** Para publicar, vale o primeiro que existir: domínio próprio do workspace para o tipo → domínio padrão do parceiro para o tipo → domínio padrão da plataforma para o tipo. O cliente não precisa cadastrar nada para publicar.
5. **Fora do MVP:** subdomínio por workspace (`rodobens.mobio.pro/{slug}`). Pode entrar depois sem mudar o modelo de dados da seção 3.
6. **Nomes reservados** por host, para evitar problema futuro.

## 2. Consequências

- No domínio padrão (da plataforma ou do parceiro), vários workspaces usam o mesmo host. O **slug é único por host**, não por workspace. No domínio próprio, o espaço de nomes é só daquele workspace.
- O workspace de uma requisição pública deixa de sair do host. No host compartilhado ele sai do endereço (`host`, `slug`). Hoje `private.resolve_public_domain` devolve o workspace a partir do host e só conhece `workspace_domains`; precisa mudar.
- Um endereço publicado não pode quebrar: QR code e cartão impresso apontam para ele. Toda troca de slug, de domínio próprio ou de domínio padrão do parceiro deixa o endereço antigo reservado e com redirecionamento 308.
- Os domínios padrão são hosts fixos com certificado comum. Sem subdomínio por workspace, não há certificado curinga de dois níveis no MVP.

## 3. Modelo proposto

Nomes de tabela e coluna são propostas; a migration final sai na etapa CF2c-1.

**Domínio com finalidade.** Cada domínio diz para que serve.

| Onde                          | Mudança                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Domínios padrão da plataforma | Cadastro no `/platform` (ou variável de ambiente, como `PLATFORM_HOSTS`), um por tipo.                                                   |
| `partner_domains`             | Coluna de finalidade: `console` (o domínio do painel de hoje) ou um tipo de rota pública. No máximo um padrão ativo por parceiro e tipo. |
| `workspace_domains`           | Coluna de tipo de rota pública. `is_primary` passa a valer por tipo: no máximo um primário ativo por workspace e tipo.                   |

**Endereço público** (tabela do núcleo, comum a todos os módulos):

| Campo                             | Regra                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `host`                            | Host em que o endereço foi publicado                                                          |
| `slug`                            | Formato `^[a-z0-9]+(-[a-z0-9]+)*$`, 3 a 64 caracteres; único com `host`                       |
| `route_type`                      | Tipo de rota; tem de bater com a finalidade do host                                           |
| `workspace_id`, `organization_id` | Dono do endereço                                                                              |
| `module_key`, `resource_id`       | Recurso que o módulo desenha (cartão, quiz, página)                                           |
| `status`                          | `active`, `redirect` (aponta para outro endereço) ou `reserved` (sem recurso, bloqueia reuso) |
| `redirect_to`                     | Endereço de destino quando `status = redirect`                                                |

Os módulos não criam tabela própria de slug nem de histórico. Eles reservam, publicam, trocam e liberam endereços por um serviço do núcleo, que aplica a cascata, a unicidade e os reservados.

## 4. Regras

- **Reservados.** Lista do núcleo aplicada em todo host: prefixos de rota (`api`, `id`, `en`, `es`, `nfc`, `_next`, `static`, `assets`), nomes técnicos (`admin`, `app`, `login`, `www`) e termos da marca da plataforma. O parceiro pode acrescentar termos nos domínios dele.
- **Sugestão de slug.** Na criação, o serviço sugere um slug livre a partir do nome (`joao-silva`, `joao-silva-rodobens`).
- **Troca de slug.** O endereço antigo vira `redirect` para o novo.
- **Cliente passa a usar domínio próprio.** Os endereços no domínio padrão viram `redirect` para o domínio próprio.
- **Parceiro troca o domínio padrão.** O host antigo continua ativo, só com redirecionamentos, para os endereços já publicados.
- **Recurso excluído ou despublicado.** O endereço vira `reserved`; ninguém reaproveita o slug.
- **Cota.** Domínios padrão não contam na `core.public_domains`. A cota continua só para domínios próprios.

## 5. Resolução de uma requisição pública

1. Traefik e ForwardAuth (`/api/domains/check`) aceitam também os domínios padrão ativos da plataforma e dos parceiros. Hoje `private.domain_host_active` só conhece `partner_domains` e `workspace_domains`.
2. O host define o tipo de rota e o dono do host (plataforma, parceiro ou workspace).
3. (`host`, `slug`) define o endereço. `redirect` responde 308; `reserved` ou ausente responde 404.
4. O endereço ativo define workspace, módulo e recurso. Para um host de workspace, o workspace do endereço tem de ser o dono do host.
5. A rota pública chama o módulo por função `security definer` que devolve só campos públicos. O contrato da rota pública no manifesto é a ADR prevista na DP1a do perfil digital.

## 6. Etapas

| Etapa  | Entrega                                                                                                                                                                                            | Migration |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| CF2c-1 | Finalidade nos domínios, domínios padrão da plataforma e do parceiro, tabela e serviço de endereços públicos, reservados, resolução e ForwardAuth; testes com dois workspaces no mesmo host padrão | Sim       |
| CF2c-2 | Telas: domínios padrão no `/platform` e no `/admin`; domínio próprio por tipo no `/app` (amplia a tela da CF2b)                                                                                    | Não       |
| CF2c-3 | Infraestrutura: DNS e certificado dos domínios padrão no Cloudflare e no Traefik; domínio padrão do parceiro pelo fluxo de Custom Hostname da CF2b                                                 | Não       |

## 7. Em aberto

1. Domínio padrão da plataforma: cadastro no `/platform` ou variável de ambiente. Recomendo cadastro, para o parceiro e a plataforma usarem o mesmo modelo.
2. Ao cadastrar domínio próprio, os endereços do domínio padrão redirecionam sempre, ou o cliente escolhe? Recomendo redirecionar sempre.
3. Mais de um domínio próprio do mesmo tipo: um primário e os outros redirecionam. Recomendo sim.
4. Lista inicial de termos reservados da marca.

## 8. Histórico

| Versão | Data       | Mudança                                              |
| ------ | ---------- | ---------------------------------------------------- |
| 0.1    | 15/10/2026 | Primeira versão, separada do plano do perfil digital |
