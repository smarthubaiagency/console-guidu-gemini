# A6: Avisos e indicações (plano)

Escrito em 2026-10-14, a partir do código em main (88e8313). Aguarda o "pode começar" do Marcelo.

## O que já existe

- **Campos de regras** (`src/core/ai/config/schema.ts`, `docs/modules/ai-agents/campos.md` §3): `notify_immediately`, `hot_score_threshold`, `warm_score_threshold`, `notify_on_score`, `owner_phone`, `notify_channel` (whatsapp, email, sms), `notify_template`, `after_hours_behavior`, `out_of_scope_action`, `partner_referral_notify`, `partner_message_template`. Já são editados nas telas e validados.
- **Score**: a ferramenta `score_lead` grava `ai_lead_activities` (pontos, temperatura, detalhamento). Ninguém é avisado.
- **Indicações**: tabela `ai_agent_referrals` (nome, tag, especialidades, telefone, cidade, remoto) com tela no /app e no /admin. **O agente não enxerga as indicações em conversa** e não há ferramenta para encaminhar.
- **Horário e fora do escopo**: `after_hours_behavior` e `out_of_scope_action` já viram texto no prompt (campos.md §7), e os horários (`timezone`, `availability_slots`) também. Mas **o agente não sabe se agora está dentro ou fora do horário**: o prompt não recebe a hora atual.
- **Avisos**: `src/core/notifications` só tem e-mail, e o transporte está desligado até escolhermos o provedor (D-PA-08); as entregas ficam registradas como "não enviadas" em `notification_deliveries`. O aviso de chave reserva (A2c) já usa esse caminho para donos e admins do workspace.

## Proposta

### A6a. Aviso de lead ao responsável

1. Quando `score_lead` faz o lead cruzar `notify_on_score` (ou o limiar de quente, se `notify_on_score` estiver vazio), cria um aviso **uma vez por contato e agente** (não repete a cada nova pontuação). `notify_immediately` desligado = só o aviso no painel, sem mensagem externa.
2. O aviso usa `notify_template` com tags (`{{contact.name}}`, `{{contact.phone}}`, `{{lead.score}}`, `{{lead.temperature}}`, `{{conversation.link}}`, resumo curto). Sem modelo, um texto padrão nos 3 idiomas.
3. **Canal WhatsApp (decidido por Marcelo em 2026-10-14)**: o aviso NÃO sai pelo número Meta Cloud do comerciante. Ele chama o fluxo do Assistente do comerciante, que fala por um número WhatsApp não oficial usado só para conversar com os nossos clientes, sem janela de 24h nem template. Como o canal do Assistente ainda não existe (A8), a A6 deixa o aviso numa fila de saída do Assistente (`assistant_outbox`) e o painel mostra "aguardando canal do Assistente" até a A8 ligar a entrega.
4. **Canal e-mail**: vai pelo caminho de `notify()` para os donos e admins do workspace, registrado como "não enviado" até o provedor existir (igual ao aviso de chave).
5. **SMS**: sem provedor; a opção fica visível mas marcada "em breve" e cai no aviso do painel.
6. **Painel**: lista "Avisos de leads" na página do agente (quem, score, quando, canal, entregue ou não), alimentada por uma tabela nova `ai_lead_notices` (migration). É o que garante que nada se perde mesmo sem provedor.
7. A entrega roda num job (pg-boss) depois do turno, para não atrasar a resposta ao cliente.

### A6b. Encaminhamento para indicações

1. Nova ferramenta `refer_contact {referral_tag, motivo}` (só GUIDS), com a lista de indicações do workspace no prompt (nome, tag, especialidades, cidade, remoto). O parceiro liga a ferramenta na allowlist como as outras.
2. O agente passa ao cliente o contato da indicação usando `partner_message_template` (tags `{{referral.name}}`, `{{referral.phone}}`, `{{contact.name}}`…).
3. Se `partner_referral_notify` estiver ligado e a indicação tiver telefone, avisa a indicação pelo WhatsApp (mesma regra da janela de 24h do item A6a.3).
4. Registro do encaminhamento no histórico do contato (nota) e contagem por indicação na tela de indicações.

### A6c. Horário e fora do escopo

1. O turno calcula "agora está dentro ou fora do horário" com `timezone` e `availability_slots` e entrega isso ao prompt (dia, hora local e o estado). Sem horários cadastrados, conta como sempre aberto.
2. `out_of_scope_action = escalate_team` passa a acionar o handoff de verdade (já existe) em vez de só prometer; com indicações cadastradas, o agente pode usar `refer_contact` quando a pergunta casar com uma especialidade.
3. `after_hours_behavior = auto_reply_only`: fora do horário o agente só manda a resposta automática e não pontua nem faz handoff.

## Divisão e migrations

- A6a: migration `ai_lead_notices` + RLS + testes SQL; job de entrega; tela.
- A6b: sem migration (talvez uma coluna de contagem, evitável com consulta).
- A6c: sem migration.
- Proposta: um PR por parte, na ordem A6c (pequena), A6a, A6b. Ou um PR só se preferir.

## Decisões de 2026-10-14

- Aviso de cliente quente ao dono vai pelo Assistente do comerciante (número não oficial), não pelo número Meta do GUIDS.
- Entrega por webhook (Marcelo, 2026-10-14): o GUIDU chama uma URL com telefone, texto e dados do lead; o fluxo dele (n8n, Evolution, inbox próprio no futuro) envia. Proposta: URL e segredo no /admin do parceiro; entrega registrada no painel. Substitui a fila `assistant_outbox`, sem depender da A8.
- Perguntas 2, 3 e 5 do plano: sim. Indicação (Marcelo, 2026-10-14, ainda será testada): nós avisamos o comerciante pelo mesmo webhook que a indicação X foi recomendada ao lead Y; avisar o indicado é responsabilidade do comerciante. `partner_referral_notify` passa a significar "avisar o comerciante quando indicar".

## Perguntas (versão original)

1. Aviso por WhatsApp: tentar mensagem livre e registrar falha quando a janela estiver fechada? (recomendo sim)
2. Repetir o aviso se o mesmo contato voltar dias depois e cruzar o limiar de novo? (recomendo não, uma vez por contato e agente)
3. E-mail do aviso vai para donos e admins do workspace, não para um e-mail próprio do agente? (recomendo sim; não existe campo de e-mail do responsável)
4. Avisar a indicação por WhatsApp quando `partner_referral_notify` estiver ligado? (recomendo sim, com a mesma regra da janela)
5. Ordem A6c, A6a, A6b em três PRs? (recomendo sim)

## Como ficou a A6c (2026-10-14, commit 7ad8540, sem migration)

- Turno do GUIDS recebe hora local e aberto/fechado (`src/core/ai/turn/hours.ts`), com a regra de fora do horário quando fechado.
- `auto_reply_only`: num canal, fora do horário, resposta fixa sem modelo, uma vez por período fechado; teste do agente sempre usa o modelo.
- `escalate_team`: `handoff` liberado mesmo fora da allowlist (`agentAllowlist` em `src/core/ai/tools/catalog.ts`) e o texto do prompt manda transferir.
- Próximo: A6a (aviso de lead por webhook) e A6b (indicações).

## Como ficou a A6a (2026-10-14, commit d6adfe5, migration 20261107090000_a6a_lead_notices.sql)

- Tabelas `partner_notice_webhooks` (webhook por parceiro, segredo cifrado) e `ai_lead_notices` (um aviso por agente e contato).
- `score_lead` grava o aviso quando o score >= `notify_on_score` (ou limiar quente) ou regra `notify_immediately`; job `ai-agents.lead-notice` posta JSON assinado (`X-Guidu-Signature: sha256=HMAC(timestamp.corpo)`).
- /admin › Assistente GUIDU: seção do webhook. /app gaveta do GUIDS: lista "Avisos de lead".
- E-mail e SMS: registrados como não enviados até haver provedor (a fila de e-mail aos donos/admins não foi feita; nada sairia sem provedor).
- Mesma branch da A6c; A6b (indicações) reutiliza o webhook com outro evento.

## Como ficou a A6b (2026-10-14, migration 20261108090000_a6b_referral_notices.sql)

- Ferramenta `refer_contact {referral_tag, reason}` (só GUIDS); com ela ligada o turno recebe a lista de indicações (até 50).
- Mensagem ao contato pelo `partner_message_template` (`{{referral.name|phone|specialties|city}}`) ou texto padrão; nota no contato.
- `partner_referral_notify` = avisar o comerciante: evento `referral.recommended` no mesmo webhook do parceiro, uma vez por conversa e indicação. Nunca avisamos a indicação.
- `ai_lead_notices` ganhou `kind` (lead, referral), `referral_id`, `reason_text`; gaveta do GUIDS mostra os dois tipos.
- Contagem por indicação na tela de indicações: não feita (dá para tirar dos avisos depois).
- A6 completa; A6c, A6a e A6b na mesma branch, esperando o PR do Marcelo e as duas migrations no dev.
