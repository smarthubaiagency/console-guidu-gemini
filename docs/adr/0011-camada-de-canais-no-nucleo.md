# ADR 0011 — Camada de canais de mensagem no núcleo

- **Status:** Aceito
- **Data:** 09/10/2026
- **Aprovador:** Marcelo
- **Decisão de origem:** D-AG-01 da [especificação do módulo Agentes de IA](../modules/ai-agents/especificacao.md), aprovada por Marcelo em 09/10/2026. A aprovação formal fica registrada no PR que introduz esta ADR.
- **Relaciona-se com:** [ADR 0001](0001-prisma-como-caminho-unico.md), [ADR 0002](0002-jobs-e-hospedagem.md), [ADR 0003](0003-ordem-das-fases.md), [ADR 0006](0006-manifesto-de-modulos.md); Especificação §14–§16 e §19; Adendo §6–§7.

## Contexto

O módulo Agentes de IA vai atender por canais de mensagem: Chatwoot via Agent Bot, Meta WhatsApp Cloud API, Evolution API, Matrix e o chat interno, que é um módulo futuro. O chat interno também vai precisar das mesmas conexões. O caso típico é um número da Meta atendido no chat interno, com o agente atuando como bot dentro dele.

Cada provedor entrega os eventos de uma conexão num ponto único: o webhook do app na Meta, o webhook da instância na Evolution, o Agent Bot da inbox no Chatwoot, o usuário bot ou Application Service no Matrix. Se a integração morasse dentro de um módulo, outro módulo não poderia usar a mesma conexão sem duplicar a integração ou ler tabelas alheias, o que o Adendo §7 proíbe.

## Decisão

1. **A integração com provedores de mensagem é capacidade do núcleo**, em `src/core/channels/`. O núcleo é dono de:
   - **conexões de canal** por workspace, com configuração não secreta e referências ao cofre;
   - **adaptadores** por provedor, que verificam a autenticação do webhook, normalizam eventos, baixam mídia, enviam mensagens e executam a transferência nativa quando o canal tem;
   - **entrada**: webhook por conexão, que só verifica, grava o evento normalizado com chave única no id externo e responde;
   - **roteamento**: tabela que liga (conexão, escopo) a **um consumidor**;
   - **identidade da conversa**: conversa e contato externos por conexão e escopo;
   - **saída**: serviço de envio com fila, retry, idempotência e regras do provedor, como a janela de 24 horas da Meta.
2. **Módulos são consumidores.** Um módulo declara no manifesto que consome conversas e registra um handler de servidor. Ele recebe eventos já normalizados com o contexto de workspace montado pelo núcleo, e responde pelo serviço de saída do núcleo. Um módulo nunca recebe o payload bruto do provedor nem o segredo da conexão, e nunca chama o provedor diretamente.
3. **Cada (conexão, escopo) tem no máximo uma rota ativa**, garantida por restrição única no banco. O escopo é, por exemplo, uma inbox do Chatwoot, um número da Meta, uma instância Evolution ou uma sala Matrix. O dono da rota é o dono da conversa.
4. **Um hub pode delegar ao agente sem passar pelo canal.** Quando o dono da rota é um módulo hub, como o chat interno, o hub aciona o agente pelo serviço público do módulo Agentes de IA (Adendo §7) e envia a resposta pelo serviço de saída do núcleo. O núcleo aceita envio do dono da rota; não há rota paralela para o agente no mesmo escopo.
5. **Processamento assíncrono no worker**, conforme a ADR 0002. O despacho de eventos para o consumidor e a entrega das mensagens rodam como jobs no `app_worker`, com concorrência 1 por conversa. O webhook não chama o consumidor de forma síncrona.
6. **A mesma política de acesso vale em todas as entradas.** Antes de despachar ou enviar, o núcleo revalida workspace ativo, conexão ativa, rota ativa, disponibilidade do módulo consumidor, plano e quota. Consumidor indisponível não recebe eventos: o evento fica registrado e auditado.
7. **O contrato tem versão.** O evento normalizado e as capacidades de canal são versionados (`channelContractVersion`) e evoluem de forma compatível. Consumidores ignoram campos que não conhecem.
8. **Gestão por permissão do núcleo.** Criar, testar, revogar conexões e alterar rotas exige a permissão `channels.manage` e gera auditoria, sem o valor de segredos.

## Consequências

- O núcleo ganha um subsistema novo. Ele precisa existir, ao menos com o contrato final e um adaptador, antes do primeiro módulo consumidor.
- A primeira entrega é **o adaptador Chatwoot com o módulo Agentes de IA como consumidor**, para substituir os fluxos atuais do n8n. Os demais adaptadores entram depois, com o contrato já estável.
- Trocar quem atende um escopo é mudar a rota, sem reintegrar o provedor, por exemplo de "agente direto" para "chat interno com agente".
- As tabelas de canal (conexões, eventos de entrada, rotas, conversas externas e entregas) pertencem ao núcleo. As tabelas dos módulos referenciam a conversa do núcleo por FK composta com `workspace_id`. Os nomes e o SQL saem em migrations próprias, aprovadas no PR.
- Esta ADR não descongela o módulo Agentes de IA nem muda a ordem das fases (ADR 0003). O subsistema depende da fila e do worker da F3.
- Webhooks públicos ampliam a superfície de ataque. Cada adaptador precisa de verificação de assinatura ou token por conexão, limites de tamanho, proteção contra repetição e download de mídia restrito aos hosts do provedor (Especificação §15 e §19).
