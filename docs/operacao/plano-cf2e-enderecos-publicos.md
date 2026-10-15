# Plano da CF2e — Endereços públicos

- **Versão:** 0.3, 15/10/2026. Nada aqui foi implementado.
- **Tipo:** ajuste de plataforma (núcleo), não regra de módulo.
- **Origem:** decisões do Marcelo em 15/10/2026, durante o planejamento do [perfil digital](../modules/perfil-digital/plano-perfil-digital.md). Vale para todas as ferramentas com página pública: perfil digital, quiz, sites e landing pages.
- **Base:** a [CF2c](../configuracoes/plano-cf2c.md) (PR #89), já na `main`, resolve o **host**: subdomínio do workspace no domínio padrão do tipo (`rodobens.mobio.pro`), domínio padrão do parceiro e domínios próprios da CF2b com o seletor por ferramenta ([guia](dominios-publicos.md)). Esta etapa cuida do **caminho** depois do host (`/{slug}`): unicidade, histórico, redirecionamentos e carência.

## 1. Decisões

1. O endereço público é `{host}/{slug}`. O host vem da CF2c: domínio próprio escolhido pela ferramenta, senão o subdomínio do workspace no domínio padrão do tipo (do parceiro, se ele tiver, senão da plataforma). O cliente publica sem cadastrar domínio.
2. Como o host já identifica o workspace, o **slug é único dentro do workspace**, não entre workspaces. Num domínio próprio usado por mais de uma ferramenta, o slug é único naquele host (as ferramentas não disputam o mesmo caminho).
3. **Nomes reservados** no caminho, para evitar problema futuro.
4. **Troca de slug** com o recurso ativo: o endereço antigo responde 308 para o novo enquanto o recurso existir.
5. **Carência de 30 dias.** O endereço de um recurso excluído fica reservado por 30 dias. Depois, outro recurso **do mesmo workspace** pode usar o slug. Até alguém ocupá-lo, o endereço pode responder 307 para um endereço de reserva indicado pelo módulo (no perfil digital, o perfil master da unidade).
6. Os módulos não criam tabela própria de slug nem de histórico: usam o serviço de endereços do núcleo.

## 2. Consequências

- Um QR antigo nunca abre o recurso de outra empresa: depois da carência, o slug só pode ser reocupado dentro do mesmo workspace. É a principal diferença em relação à versão 0.2 deste plano, que previa o slug disputado entre todos os workspaces de um host compartilhado.
- O desvio para a reserva usa 307: o navegador não guarda o desvio e passa a seguir o novo dono do slug quando ele existir.
- Um endereço publicado não pode quebrar: QR code e cartão impresso apontam para ele. As trocas de host (seção 7) também precisam de redirecionamento, não só a troca de slug.

## 3. Modelo proposto

Nomes de tabela e coluna são propostas; a migration final sai na etapa CF2e-1.

**Endereço público** (tabela do núcleo, comum a todos os módulos):

| Campo                             | Regra                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_id`, `organization_id` | Dono do endereço                                                                                                                            |
| `route_type`                      | Tipo de rota da CF2c (`profile`, `quiz`, `page`)                                                                                            |
| `public_domain_id`                | Domínio próprio usado (linha de `workspace_domains`), ou vazio quando o endereço está no subdomínio padrão do tipo                          |
| `slug`                            | Formato `^[a-z0-9]+(-[a-z0-9]+)*$`, 3 a 64 caracteres; único por workspace, tipo e domínio                                                  |
| `module_key`, `resource_id`       | Recurso que o módulo desenha (cartão, quiz, página)                                                                                         |
| `status`                          | `active`, `redirect` (308 para outro endereço), `reserved` (recurso existe, mas está fora do ar) ou `grace` (recurso excluído, em carência) |
| `redirect_to`                     | Endereço de destino quando `status = redirect`                                                                                              |
| `fallback_to`                     | Endereço de reserva para o 307, quando o módulo indica um                                                                                   |
| `release_at`                      | Fim da carência quando `status = grace`                                                                                                     |

O serviço do núcleo reserva, publica, troca e libera endereços, e aplica a unicidade e os reservados. A escolha do domínio continua na `workspace_public_routes` da CF2c.

## 4. Regras

- **Reservados.** Lista do núcleo aplicada a todo caminho: prefixos de rota (`api`, `id`, `en`, `es`, `nfc`, `_next`, `static`, `assets`), nomes técnicos (`admin`, `app`, `login`, `www`) e termos da marca da plataforma. Os rótulos reservados de subdomínio já existem na CF2c (`src/core/domains/public-hosts.ts`).
- **Sugestão de slug.** Na criação, o serviço sugere um slug livre a partir do nome (`joao-silva`, `joao-silva-2`).
- **Troca de slug.** O endereço antigo vira `redirect` para o novo enquanto o recurso existir.
- **Recurso despublicado ou desativado.** O endereço vira `reserved` e só o mesmo recurso volta a usá-lo.
- **Recurso excluído.** O endereço e os antigos que redirecionavam para ele viram `grace`, com `release_at` 30 dias depois. Na carência e depois dela, respondem 307 para `fallback_to` quando houver, ou 404. Depois de `release_at`, outro recurso do workspace pode ocupar o slug; a linha antiga é substituída e o histórico fica na auditoria. O prazo vira chave do catálogo de configurações (ADR 0018) no nível da plataforma.
- **Ferramenta passa a usar domínio próprio** (seletor da CF2c). Os endereços no subdomínio padrão viram `redirect` para o domínio próprio.

## 5. Resolução de uma requisição pública

1. Traefik e ForwardAuth (`/api/domains/check`) já liberam os hosts que existem (CF2c).
2. `resolvePublicHost` (CF2c) devolve o workspace, o tipo de rota e, no domínio próprio, as ferramentas que o escolheram.
3. Workspace, tipo, domínio e `slug` definem o endereço. `redirect` responde 308; `grace` responde 307 para `fallback_to`, ou 404 sem ele; `reserved` ou ausente responde 404.
4. O endereço ativo define o módulo e o recurso.
5. A rota pública chama o módulo por função `security definer` que devolve só campos públicos. O contrato da rota pública no manifesto é a ADR prevista na DP0 do perfil digital.

## 6. Etapas

| Etapa  | Entrega                                                                                                                                                      | Migration |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| CF2e-1 | Tabela e serviço de endereços públicos (com carência e 307), reservados, sugestão de slug e resolução do caminho; testes com dois recursos e dois workspaces | Sim       |
| CF2e-2 | Redirecionamentos de troca de host (seção 7, itens 1 e 2), conforme a decisão do Marcelo                                                                     | Sim       |

A CF2e-1 vem antes da DP2 do perfil digital. A CF2e-2 pode esperar o primeiro cliente com cartões impressos.

## 7. Em aberto

1. **Troca do slug do workspace.** Hoje muda o subdomínio padrão sem redirecionamento (pendência da CF2c). Recomendo guardar os slugs antigos do workspace e responder 308 do subdomínio antigo para o novo; o slug antigo fica reservado e não pode ser usado por outro workspace.
2. **Parceiro troca ou ativa o domínio padrão.** O host antigo deixa de abrir para os clientes dele (decisão 2 da CF2c). Recomendo 308 do host antigo para o novo enquanto o certificado do antigo existir.
3. Mais de um domínio próprio para a mesma ferramenta: um primário e os outros redirecionam. Recomendo sim.
4. Lista inicial de termos reservados da marca.

## 8. Histórico

| Versão | Data       | Mudança                                                                                                                                                                                                                                                   |
| ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1    | 15/10/2026 | Primeira versão, como "plano da CF2c", separada do plano do perfil digital                                                                                                                                                                                |
| 0.2    | 15/10/2026 | Carência de 30 dias para endereço de recurso excluído, com 307 para a reserva; status `grace`                                                                                                                                                             |
| 0.3    | 15/10/2026 | Renomeado para CF2e. A CF2c foi construída (PR #89) com subdomínio por workspace; este plano passa a cobrir só o caminho: slug único por workspace, histórico, reservados e carência. Domínios por tipo e do parceiro saem daqui, porque a CF2c já os fez |
