# ADR 0022 — Central de Eventos (Event Hub)

- **Status:** Proposto (H1); vira aceito com o "pode começar" do Marcelo
- **Data:** 16/10/2026
- **Aprovador:** Marcelo
- **Plano:** [central-de-eventos.md](../architecture/central-de-eventos.md)
- **Relaciona-se com:** [ADR 0012](0012-plataforma-de-parceiros.md) (parceiros), [ADR 0018](0018-configuracoes-em-cascata.md) (cascata), [ADR 0020](0020-modo-de-servico-gerenciado.md) (modo de serviço), P4b2 (acesso de suporte), CF3c (sino e preferências), CF5a (eventos de segurança)

## Contexto

Os avisos nasceram soltos: o `notify` da CF3c tem 6 eventos; o aviso de lead quente e o de indicação (A6) saem por um webhook próprio; a GB1a posta no sino por uma função própria; a segurança (CF5a) lê a auditoria. O perfil digital vai trazer visitas, leads e analytics; a GB2 vai trazer aprovações e passagem de trabalho entre agentes. Sem um caminho único, cada módulo reinventa aviso, auditoria e métrica. O projeto legado (CartãoPro/Linkko) tinha 4 subsistemas independentes (analytics, auditoria de workspace, eventos de addon e Event Bus de WhatsApp), com erros engolidos e instrumentação que nunca foi ligada.

## Decisão

1. **Um ponto de entrada.** Todo evento novo de módulo sai de `emitEvent(tx, tipo, dados)` (`src/core/events/`), chamado pelo serviço **na transação da mudança**. Não há trigger no Postgres nem chamada HTTP para a própria aplicação: o evento é gravado e o job `events.dispatch` é enfileirado no pg-boss na mesma transação.
2. **Catálogo no código.** Cada tipo declara módulo, gravidade, se é essencial, audiências (cliente, parceiro, plataforma), finalidade (`transactional` ou `marketing`), rota padrão e **destinos** (encaixes): `notify`, `audit`, `analytics`, `subscribers` (passagem de trabalho) e `webhook` (do cliente). Tipo fora do catálogo é recusado.
3. **Roteador, não tabela única.** Cada destino guarda os dados no seu formato: a tabela `events` guarda o que tem ciclo de vida (avisos, aprovações, passagens); a auditoria continua no `audit_events`; o analytics de negócio terá tabela própria e agregados. Só se constrói o encaixe quando chega a etapa que precisa dele; o caminho fica pronto.
4. **Rota por modo de serviço.** Modo padrão avisa o cliente (owner e admin do workspace); gerenciado avisa o parceiro (`partner_owner`, `partner_admin`, `partner_support`), e no parceiro zero esses membros são a GUIDU.
5. **Selo de integridade.** Cada evento recebe `content_hash` = HMAC-SHA256 do conteúdo canônico (tipo, ids, data, quem gerou e dados) com uma chave secreta da plataforma (variável de ambiente com versão, `key_version`), e `prev_hash`, o selo do evento anterior do mesmo workspace (corrente). HMAC, e não sha256 simples, porque dados curtos (telefone, CPF) seriam descobertos por tentativa. Uma rotina confere a corrente; a plataforma confere um dado apresentado pelo cliente recalculando o selo, sem abrir os dados.
6. **Visibilidade.** A plataforma vê sempre a **situação** de todo evento: tipo, cliente, data, entregas (saiu, falhou e por quê), `event_id`, selo e resultado da verificação. Os **dados** do evento ficam com o cliente (e com quem gerencia, no gerenciado). No padrão, o parceiro vê só a situação, como a GUIDU (ADR 0020).
7. **Acesso por evento.** O suporte (da GUIDU ou do parceiro) localiza o evento, pede acesso aos dados com motivo e referência da solicitação; o owner ou admin do workspace aprova pelo sino ou por link seguro. Só quem pediu vê, só os eventos do pedido, por **72 horas** (padrão; de 24 horas a 7 dias). Cada visualização é auditada e aparece ao cliente no próprio evento; o cliente revoga quando quiser. Tabela `event_access_grants` (`pending`, `approved`, `denied`, `revoked`, `expired`).
8. **Papel `keychain` (acesso total).** Uma capacidade da plataforma que se soma ao papel principal (por exemplo, `operations` + `keychain`) e dá **uma única permissão**: `platform.events.read_all_data`, ver os dados completos de qualquer evento da central. Não dá escrita nem acesso a nenhuma outra área. Fica numa tabela própria (`platform_admin_capabilities`), porque `platform_admin_members` tem um papel só por pessoa; só o `owner` da plataforma concede ou retira, e o `owner` não tem a capacidade por padrão. Cada abertura exige MFA recente e motivo escrito e grava `platform.event.view_data` (event_id, quem, quando, motivo, IP) na auditoria da plataforma. **O registro fica só na auditoria da plataforma** (Marcelo, 16/10/2026): o cliente não é avisado.
9. **Auditoria pelo hub.** Evento com `audit: true` grava no `audit_events` na mesma transação. Os `recordAudit` que já existem ficam como estão e passam para o hub quando o módulo for mexido.

## Consequências

- Etapas H1 a H5 no [plano](../architecture/central-de-eventos.md#4-etapas); H1 e H2 antes da GB2, H3 com o DP2, H4 com a GB2.
- Nova variável de ambiente `EVENTS_HMAC_KEY` (e `EVENTS_HMAC_KEY_ID`) no web e no worker; sem ela, a emissão falha na subida, não em silêncio.
- Lacunas conhecidas registradas no [plano](../architecture/central-de-eventos.md#5-lacunas-registradas), entre elas a tela de auditoria completa da plataforma.
- A capacidade `keychain` entra na [matriz de permissões](../architecture/permissoes.md) na H1.
