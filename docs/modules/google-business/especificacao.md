# Especificação do módulo Google Meu Negócio — Agente GMN

- **Versão:** 0.2
- **Data:** 16/10/2026
- **Estado:** G0 aprovada; GB1a (onboarding "Adicionar local" e página de automação) e GB1b (saúde no Maps e sugestões da IA) implementadas. O que cada etapa construiu está marcado **[GB1a]** ou na subseção "Implementado na GB1b".
- **Chave do módulo:** `google-business` (hoje só manifesto "em breve", `src/modules/google-business/manifest.ts`).
- **Origem:** decisões do Marcelo em 15 e 16/10/2026 nesta conversa; telas do concorrente (Paige) e uma proposta do Google AI Studio enviadas por ele; [documento técnico da SoulLocal v2.11](../documento-tecnico-soullocal-v2_11.md) (§5.1, §5.1A, §7.7 e §9.1); o repositório `AgriciDaniel/claude-seo` (MIT) para a inteligência de mapa.
- **ADRs:** [0019](../../adr/0019-subagente-especialista.md) (subagente especialista), [0020](../../adr/0020-modo-de-servico-gerenciado.md) (modo de serviço gerenciado), [0011](../../adr/0011-camada-de-canais-no-nucleo.md) (canais), [0015](../../adr/0015-janela-de-edicao-gaveta-interna.md) (gaveta), [0017](../../adr/0017-sdk-dos-agentes-de-ia.md) (SDK) e [0018](../../adr/0018-configuracoes-em-cascata.md) (cascata).

Legenda: **[Decidido]** foi definido pelo Marcelo; **[Proposta]** é recomendação a aprovar neste PR; **[Em aberto]** ainda não foi definido e não deve ser preenchido por suposição.

## 1. Visão

Um agente especialista cuida das fichas do Google de cada empresa (uma ficha por unidade): analisa, sugere, aplica, responde e acompanha. É a base da escala do negócio **[Decidido]**: o mesmo agente serve o cliente que opera sozinho e a equipe da GUIDU ou do parceiro que gerencia muitas fichas.

Três princípios guiam o módulo:

1. **Quem opera vem primeiro.** Painel bonito que ninguém usa não vale. A tela principal é a de trabalho de quem gerencia (carteira, diagnóstico, aplicar na hora, agente na gaveta). O cliente que só acompanha recebe o essencial e aprova pelo WhatsApp **[Decidido]**.
2. **A GUIDU é a fonte da verdade.** Horários, endereço, serviços e tom vêm das unidades, do Portfólio e da base de conhecimento. O agente aponta onde a ficha diverge, em vez de pedir tudo de novo.
3. **Prova, não narrativa** (documento técnico, §1.1). Nada de "analisamos mais de 1.000 dados" nem "revertemos em segundos". Toda nota mostra a conta; todo resultado aparece no relatório com o antes e o depois.

O que diferencia do concorrente: aprovação pelo WhatsApp com o Assistente, a ficha alimentada pelos dados que o cliente já tem na GUIDU, a carteira de fichas do parceiro, avaliação ruim virando atendimento no CRM e a inteligência de mapa com ponto de partida.

## 2. Conceitos

| Termo                | Definição                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ficha**            | O perfil do Google Meu Negócio de uma unidade. Uma ficha por unidade (`workspace_locations`); um workspace pode ter várias **[Decidido]**      |
| **Modo de serviço**  | `padrao` (o cliente opera) ou `gerenciado` (a GUIDU ou o parceiro opera), definido por empresa ([seção 3](#3-modos-de-serviço), ADR 0020)      |
| **Quem opera**       | No padrão, owner e admin do workspace; no gerenciado, a equipe do parceiro (ou da GUIDU, no parceiro zero)                                     |
| **Agente GMN**       | O subagente especialista em fichas do Google (ADR 0019). Não conversa com o cliente; prepara, executa e relata                                 |
| **Assistente**       | O Assistente GUIDU (agente de conta) de cada parceiro. Conversa com o cliente, inclusive no WhatsApp, e aciona o agente GMN                    |
| **Skill**            | Habilidade empacotada do agente (gatilho, instruções, exemplos e ferramentas permitidas). Há skills da plataforma (travadas) e skills próprias |
| **Soul**             | A personalidade do agente: tom de voz, jeito de escrever, valores, o que nunca dizer e assinatura                                              |
| **Autonomia**        | Por skill: só sugerir, pedir aprovação ou automático                                                                                           |
| **Diagnóstico**      | Checklist verificável do que nós controlamos na ficha ("14 de 20 itens em ordem")                                                              |
| **Saúde no Maps**    | Nota de 0 a 100 da presença no mapa frente aos concorrentes, com a conta à vista ([seção 6.2](#62-saúde-no-maps))                              |
| **Ponto de partida** | O primeiro diagnóstico, o primeiro mapa e os concorrentes de referência, gravados com data no onboarding. Os relatórios comparam com ele       |

## 3. Modos de serviço

**[Decidido]** O modo é definido **por empresa** (o contrato) e decide quem paga o quê, de quem é a chave de IA e quem vê os dados. Detalhe e consequências na [ADR 0020](../../adr/0020-modo-de-servico-gerenciado.md).

|                                 | **Padrão** (o cliente paga a ferramenta)                                                                 | **Gerenciado** (o cliente paga gestão e consultoria)                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Quem opera                      | O cliente, com acesso total às ferramentas: conecta a ficha, configura, usa o agente                     | A equipe do parceiro ou da GUIDU, pela tela de trabalho do `/admin`                                    |
| Chave de IA                     | Por tipo de trabalho, não por modo (abaixo)                                                              | Por tipo de trabalho, não por modo (abaixo)                                                            |
| O que o parceiro e a GUIDU veem | Situação da ficha, sem os dados. Suporte só pelo acesso pontual que já existe (`partner_support_grants`) | **O workspace inteiro**: GUIDS, campanhas, avaliações, CRM e conversas                                 |
| Como entra                      | Padrão de quem chega pelo onboarding                                                                     | No contrato (aceite dos termos no primeiro acesso) ou por pedido formal aprovado pelo owner da empresa |
| Volta para padrão               | —                                                                                                        | O cliente pode pedir sozinho, a qualquer momento; o acesso de quem gerencia cai na hora                |

**Chave de IA por tipo de trabalho [Decidido, 16/10/2026]:** o que é inteligência e serviço nosso usa a **nossa chave** (a da plataforma, ou a do parceiro quando é ele quem presta o serviço), em qualquer modo: a análise do onboarding, os relatórios, o Assistente de conta e o agente especialista GMN (inclusive no modo padrão). Usa a **chave do cliente**: os GUIDS, a automação de respostas às avaliações e o agente no widget do site. Cliente sem chave com a automação de respostas ligada: as respostas ficam como rascunho para aprovar, com aviso pedindo a chave; a chave reserva continua só para terminar conversas dos GUIDS (regra da A2c). Detalhe na ADR 0019, item 5.

**[GB1a] Mínimo implementado:** tabela `organization_service_modes` (sem linha = padrão); o parceiro escolhe o modo ao cadastrar o cliente em `/admin` › Clientes (gerenciado por padrão; quem entra sozinho fica no padrão); uma função auxiliar única, `private.partner_manages_organization(org)`, usada nas políticas de `workspace_locations`, das tabelas `gb_*`, dos workspaces e das execuções `google-business.*`. **Fica para depois:** o pedido de troca por link seguro (`service_mode_requests`), a volta ao padrão pelo cliente, a cláusula de gerenciamento nos termos do primeiro acesso e a retrofit dos demais módulos (CRM, GUIDS, conversas) para aceitar o gerenciado pela mesma função.

**[GB1c] Completo (migration `20261211090000_gb1c_service_modes`):**

- **Pedido por link seguro** (`service_mode_requests`): o parceiro (`partner_owner`, `partner_admin`) em `/admin` › Clientes, ou a GUIDU (`owner`, `operations`) em `/platform` › Clientes para os clientes diretos (parceiro zero), pede o gerenciado. O owner da empresa recebe por e-mail um link de uso único que vale 7 dias; o token é sorteado no envio (`events.dispatch`) e só o hash fica no banco, nunca nos dados do evento. A página pública `/service-mode/[token]` (fora do shell, com a marca do parceiro do host, só funciona no host do parceiro da empresa) mostra o que muda e aprova ou recusa; também dá para decidir em Configurações › Modo de serviço. Ficam registrados quem decidiu, quando, por onde (`link` ou `app`), o IP e o navegador. Situações: `pending`, `approved`, `denied`, `expired` (marcado ao abrir, decidir ou pedir de novo) e `cancelled` (quem pediu cancela). Um pedido pendente por empresa.
- **Avisos pela Central de Eventos:** `service_mode.change_requested` (e-mail e sino ao owner), `service_mode.changed` (sino de quem pediu e dos owners; na volta ao padrão, dos `partner_owner`/`partner_admin` e dos owners) e `service_mode.change_denied` (sino de quem pediu), rota `explicit`, módulo `service_modes`.
- **Volta ao padrão:** só o owner da empresa (decisão: o consentimento é dele; o admin só lê), a qualquer momento, em Configurações › Modo de serviço. O acesso de quem gerencia cai na mesma transação. O parceiro só pode devolver ao padrão (fim do contrato, sem tela por enquanto); nunca liga o gerenciado sozinho numa empresa existente, só na transação que a cadastra.
- **Cláusula de gerenciamento** (documento legal `management`, versão e tradução como termos e privacidade): pedida no primeiro acesso só aos owners de empresa cadastrada como gerenciada pelo parceiro do host (`source = registration`); quem virou gerenciado por pedido já consentiu no link. A versão 1, com texto provisório marcado para o jurídico (D-PA-06), nasce para todo parceiro (gatilho em `partners`).
- **Gerenciado nos outros módulos:** CRM (contatos: ler e escrever), GUIDS (criar, alterar e excluir pelo caminho do workspace, com `updated_by_partner_id`), conversas dos GUIDS (ler e atualizar; mensagens seguem a conversa), leads e avisos de lead (ler), canais (conexões e rotas: ler e escrever; conversas, entregas e eventos recebidos: ler), portfólio (ler e escrever) e configurações do workspace (cascata). Ficam de fora: `credentials` (a chave de IA do cliente e as demais credenciais), as políticas internas da chave e do teste dos GUIDS, criar conversa de teste, enviar mensagem pelos canais (`channel_deliveries` insert/update e despacho de eventos recebidos), membros e convites, cobrança, exportação e exclusão, domínios e rotas públicas. Indicações e consumo já aceitavam o parceiro em qualquer modo. Toda escrita de quem gerencia nessas tabelas grava `audit_events` com origem `partner` (gatilho).
- **Telas:** `/admin` › Clientes (situação do pedido, "Pedir gerenciamento", "Cancelar pedido" e, nos gerenciados, o número de contatos do CRM), `/platform` › Clientes (mesma ação para os diretos), `/app` › Configurações › Modo de serviço e a página do link.

**Pedido de troca de padrão para gerenciado [Decidido]:** a GUIDU ou o parceiro faz o pedido; o owner da empresa recebe um e-mail com link seguro e aprova. **[Proposta]** O link é de uso único, vale 7 dias e registra quem aprovou, quando e de qual IP (prova de consentimento, LGPD). O link tokenizado é a mesma primitiva que o documento técnico prevê para onboarding, aprovações e relatório (§9.4).

**[Proposta]** No modo padrão, o agente GMN **não conta** no limite `ai-agents.max` dos GUIDS: ele vem com o módulo, que entra por plano de assinatura **[Decidido]**.

## 4. O agente GMN

### 4.1 Papel

- **Subagente do Assistente [Decidido]** (ADR 0019): o Assistente conversa com o cliente; o agente GMN recebe o pedido, prepara propostas e relatórios e executa o que foi aprovado. Ele também roda sozinho nos gatilhos e rotinas ([seção 8.5](#85-acionamento)).
- **Na gaveta [Proposta]:** em qualquer tela do módulo, quem opera conversa com o agente GMN diretamente ("troca o sábado para 8h–12h", "por que caímos nas buscas?"); a resposta vem com a proposta pronta para aplicar. O clique de quem opera conta como aprovação.
- **Chaves [Decidido, revisto em 16/10/2026]:** a chave é escolhida pelo tipo de trabalho, não pelo modo (seção 3). O agente especialista GMN, a análise do onboarding e os relatórios usam a nossa chave (plataforma, ou parceiro quando ele presta o serviço); a automação de respostas às avaliações usa a chave do cliente e, sem ela, deixa as respostas como rascunho para aprovar, com aviso pedindo a chave. A chave reserva da plataforma segue a regra da A2c (só termina conversas abertas dos GUIDS, depois pausa com aviso).
- **[GB1a] Na gaveta, só dúvidas:** nesta etapa o agente responde a dúvidas sobre a ficha, os achados e as áreas ("Preciso saber mais"), sem ferramentas e sem alterar nada. Tipo `specialist` mínimo no motor (`src/core/ai/specialist/`), com o modelo e a chave de administrador do Assistente do parceiro que atende o contexto.

### 4.2 Aprovação pelo WhatsApp

**[Proposta]** Quando a autonomia pede aprovação do cliente, o Assistente envia no WhatsApp do comerciante (canal do aviso de lead: webhook do parceiro, fora da Meta):

> Respondi assim a avaliação de 2 estrelas da Ana: "…". Posso publicar?
> **Aprovar** · **Ajustar**

- As aprovações pendentes são agrupadas num resumo, respeitando a janela de silêncio ([seção 8.5](#85-acionamento)).
- "Ajustar" abre a conversa com o Assistente, que repassa o pedido ao agente GMN.
- O mecanismo é o das propostas com aprovação humana da F4d.

## 5. O que o agente cuida

| Grupo                    | Faz                                                                                                                                                  | Fonte da verdade                                        | Vigia                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Informações da ficha** | Nome, categorias, descrição, telefone, site, links (agendamento, cardápio), atributos, área de atendimento, data de abertura                         | Unidade (`workspace_locations`) e cadastro da empresa   | Nome com palavra-chave, categoria errada, descrição curta ou com link, atributos faltando, divergência com a GUIDU |
| **Horários**             | Horário normal, especiais (feriados nacionais, estaduais e municipais), adicionais (delivery, retirada)                                              | Horários da unidade e calendário de feriados por cidade | Feriado chegando sem horário especial (14 dias antes), divergência, "temporariamente fechado" esquecido            |
| **Avaliações**           | Resposta por faixa de estrelas no tom da marca; escala 1 e 2 estrelas para uma pessoa (contato no CRM e aviso); marca suspeitas; link e QR de pedido | A avaliação, a base de conhecimento e o CRM             | Sem resposta há mais de X horas, queda de nota, pico de negativas, resposta com dado sensível                      |
| **Postagens**            | Novidades, ofertas e eventos; calendário mensal; pauta do Portfólio, datas, avaliações boas e sazonalidade; botão de ação                            | Portfólio, fotos do cliente e calendário                | Mais de X dias sem postagem, postagem recusada, oferta vencida no ar                                               |
| **Fotos e vídeos**       | **Só o que o cliente envia [Decidido]** (tela, link de envio ou WhatsApp do Assistente); classifica, descreve e publica aos poucos                   | Biblioteca de mídia do cliente                          | Mais de X dias sem foto, sem logo ou capa, baixa qualidade, pessoa identificável sem autorização                   |
| **Produtos e serviços**  | Leva os itens do Portfólio para a ficha                                                                                                              | Portfólio                                               | Item ou preço divergente                                                                                           |
| **Defesa da ficha**      | Detecta alteração feita pelo Google ou por terceiros, perda de gestor ou dono, duplicada, suspensão, verificação pendente                            | Última versão aprovada, guardada na GUIDU               | Telefone, endereço, site, nome, categoria e horário alterados de fora: aviso imediato com o desfazer pronto        |
| **Desempenho**           | Buscas, visualizações, ligações, rotas, cliques e palavras-chave (Performance API); comparação mês a mês                                             | API do Google                                           | Quedas fora do normal, palavras-chave que sumiram                                                                  |
| **Saúde no Maps**        | Mapa de posições, concorrentes, inteligência de avaliações, consistência em outras plataformas e nota de 0 a 100 ([seção 6.2](#62-saúde-no-maps))    | DataForSEO e Google Maps Platform                       | Queda de SoLV, concorrente novo no raio, ritmo de avaliações abaixo dos concorrentes                               |

**Fora, por limite do Google:** perguntas e respostas da ficha (a API foi desligada em 3/11/2025; o Google trocou por respostas de IA no Maps) e remoção de avaliação pela API (não existe; a denúncia é manual). **Fora por decisão:** imagens geradas por IA **[Decidido]**.

## 6. Diagnóstico e saúde no Maps

### 6.1 Diagnóstico

**[Proposta]** Checklist verificável dos itens que nós controlamos na ficha: categorias, descrição, horários e feriados, atributos, fotos recentes, logo e capa, postagem recente, avaliações sem resposta, telefone, endereço e site iguais aos da GUIDU, serviços do Portfólio. Resultado: "14 de 20 itens em ordem", com a lista do que falta, cada item virando uma sugestão com o valor atual e o sugerido.

### 6.2 Saúde no Maps

**[Decidido]** O módulo responde ao cliente "como estou no Maps em relação aos concorrentes", com dados da **DataForSEO** e do **Google Maps Platform**. Inspirado no `seo-maps` do `claude-seo` (MIT; as fórmulas reaproveitadas citam a origem).

- **Mapa de posições (geo-grid):** buscas simuladas a partir de uma grade de pontos ao redor da unidade (padrão 7x7, raio de 5 km) para cada palavra-chave. Resultado: mapa de calor, posição média e **SoLV** (parcela dos pontos em que a ficha aparece no top 3). A busca usa a DataForSEO por coordenada, não o Places: o Places não devolve negócio sem endereço físico, o que apagaria passeios, transfers e serviços em domicílio (documento técnico, §7.7).
- **Concorrentes num raio:** as 20 fichas mais fortes por palavra-chave, com nota, número de avaliações, categorias, fotos e atributos; densidade de concorrentes.
- **Inteligência de avaliações:** ritmo mensal (6 meses), intervalos sem avaliação, distribuição de estrelas, taxa de resposta, comparação com os concorrentes e sinais de avaliação falsa.
- **Consistência de nome, endereço e telefone** no Google, Bing, Apple e OpenStreetMap, com a gravidade de cada divergência.
- **Nota de 0 a 100**, composta pelas dimensões acima, sempre com a conta à vista. Separada do diagnóstico da seção 6.1.
- **Regra de entrega (documento técnico, §7.7) [Decidido]:** nenhum ponto fraco do mapa é mostrado sem a ação ao lado. Proximidade pesa e nenhum conteúdo resolve estar longe; o que é ação real é usar o vocabulário geográfico (bairros) no conteúdo e detectar concorrente novo.
- **Custo e cotas [Proposta]:** cada mapa 7x7 é 49 consultas por palavra-chave (referência do repositório: cerca de US$ 0,03 em fila e US$ 0,10 no modo imediato; o documento técnico estima R$ 1,60 por cliente por mês no regime 7x7). Palavras-chave monitoradas, frequência e tamanho da grade viram **cotas por plano** (catálogo da CF4). O Tier 3 do documento técnico prevê o mapa 7x7 quinzenal com alerta de concorrente novo.
- **Termos do Google Maps Platform:** só o `place_id` pode ser guardado por tempo indeterminado; latitude e longitude, no máximo 30 dias. O histórico guarda as nossas medições (posições, SoLV, notas) e o `place_id`, nunca os dados de ficha copiados do Places.
- **Prospecção [Proposta]:** como usa só dados públicos, o mapa e a nota rodam antes de o cliente conectar a ficha. Viram o diagnóstico que o parceiro leva a um potencial cliente (o Raio-X do documento técnico, §3), com cota própria.

#### Implementado na GB1b (16/10/2026)

- **Análises** (contrato com a GB1a em [contrato-analises.md](contrato-analises.md), código em `src/modules/google-business/analyses/intelligence/`): `ai-suggestions` (fase `blocking`), `maps-keywords`, `maps-competitors` e `maps-geo-grid` (fase `background`, uma medição só para as três). Só leem e sugerem: nada muda na ficha.
- **Sugestões da IA** com a **nossa chave** (decisão do Marcelo): a chave e o modelo do Assistente do parceiro que atende a empresa (o parceiro zero, para os clientes diretos), lidos pelas funções do motor (`private.ai_assistant_runtime`, `private.ai_admin_key`); nunca a chave do cliente, nem no modo padrão. Descrição (atual × sugerida, até 750 caracteres, sem link, contato nem promoção), nome sem palavra-chave, categorias e um rascunho para cada avaliação sem resposta (até 20). A resposta é validada por Zod e passa por filtros da seção 9: termo de saúde, jurídico ou financeiro, nome de funcionário citado na avaliação, valor pago ou discussão troca o rascunho por uma resposta segura da faixa de estrelas.
- **Palavras-chave:** o agente escolhe 3 a partir da categoria (categoria, categoria + "perto de mim" no idioma, categoria adicional ou categoria + cidade), dentro da cota; quem opera ajusta depois.
- **Grade:** 7x7, raio de 5 km, pontos pela fórmula do destino na esfera e conferidos por Haversine; centro pela ficha, pela unidade, pelo perfil da DataForSEO ou pelo Places (nesta ordem). Nenhuma coordenada é gravada: a medição guarda tamanho e raio da grade, as posições por ponto, SoLV, posição média, os 20 concorrentes mais fortes por palavra-chave e os bairros onde os concorrentes aparecem na frente.
- **Nota de 0 a 100** com a conta: visibilidade (35, média da visibilidade: top 3 vale 3, posições 4 a 10 valem 1), avaliações frente aos concorrentes (25: nota e quantidade contra a mediana do raio; sem concorrentes, referência fixa de 4,5 e 10 avaliações), ritmo e respostas (20: avaliações por mês contra 2 e taxa de resposta) e ficha completa (20: oito itens). Pesos e referências adotados por padrão, a confirmar.
- **Ponto de partida:** a primeira medição de cada unidade (`is_baseline`, uma por unidade), fora da cota mensal; os 5 concorrentes mais fortes da primeira palavra-chave viram concorrentes de referência (só o `place_id`), ajustáveis.
- **Regra de entrega:** todo ponto fraco traz a ação no mesmo achado (vocabulário de bairros, concorrente novo no top 10, pedido de avaliação igual para todos, responder as pendentes).
- **Cotas (catálogo da CF4)**, por unidade: `google-business.maps-keywords` (3), `google-business.maps-grid-size` (7) e `google-business.maps-scans-per-month` (1), com o teto da plataforma da CF4 e um teto no código (10, 9 e 4). Custo estimado gravado em cada medição (fila padrão da DataForSEO).
- **Dados:** `gb_maps_keywords`, `gb_maps_competitors`, `gb_maps_scans` e `gb_maps_scan_results`, ligados à unidade (`workspace_locations.id`), com FORCE RLS, leitura dos membros, escrita de owner e admin, medições só de inserção, auditoria e exportação e exclusão (F3e). Migration `20261124090000_gb1b_maps_intelligence.sql`.
- **Componente:** `MapsHealthPanel` (`src/modules/google-business/components/maps/`), alimentado por `loadMapsHealthView`; demonstração em Plataforma › Padrões de interface › Saúde no Maps.
- **Fica para depois:** consistência de nome, endereço e telefone em Bing, Apple e OpenStreetMap; ritmo de avaliações dos concorrentes (exige ler as avaliações de cada um); prospecção.

## 7. Onboarding e ponto de partida

**[Decidido]** A posição frente aos concorrentes é definida no primeiro onboarding. **[Decidido, 16/10/2026]** Todo local novo passa pelo fluxo "Adicionar local".

### 7.1 Fluxo "Adicionar local" [GB1a]

1. **Onde:** em `/admin` › Clientes (o parceiro ou a GUIDU, nas empresas que gerencia) e no `/app` › Google Meu Negócio (owner e admin do cliente no modo padrão), o botão **"Adicionar local"** abre uma **janela em tela cheia por cima do painel** (exceção própria à ADR 0015, registrada em `docs/architecture/ui-shell.md`).
2. **Conectar:** login no Google e escolha de **uma** ficha por vez. Se faltarem permissões, a janela mostra cada permissão, para que serve, que o agente não apaga a ficha nem altera nada sem permissão, e o botão "Voltar às permissões do Google". Sem selos que não temos.
3. **Ler e analisar:** passos à vista ("Lendo a ficha", "Criando ou ligando a unidade", um passo por análise `blocking` do registro, "Preparando a página de automação"); cada um marca concluído quando termina de verdade, sem barra fingida.
4. **Pronto:** "Encontramos X pontos para validar". O botão abre a **página de automação** daquele local e a janela fecha.
5. **Em segundo plano:** cria a unidade em `workspace_locations` com os dados da ficha (nome, endereço, telefone, coordenadas, fuso, horários e horários especiais) e liga a ficha a ela (`gb_locations`, uma ficha por unidade). Se já existir unidade com o mesmo endereço, a janela propõe ligar a ela em vez de duplicar. Grava a **versão inicial da ficha** (`gb_snapshots`, `initial`, base da defesa) com as avaliações públicas lidas.
6. **Análises:** todas começam no onboarding, com o agente ligado ou não, e só leem e sugerem. O registro `locationAnalyses` do contrato ([contrato-analises.md](contrato-analises.md)) é rodado por fase: as `blocking` terminam antes de a janela fechar; as `background` seguem num job do worker (`google-business.background-analyses`) e a área aparece "em andamento" até o resultado chegar, com aviso no sino ao concluir. Cada `AnalysisResult` fica em `gb_analysis_runs`.
7. **Análises determinísticas da GB1a** (sem IA): informações (categorias, descrição, link na descrição, telefone, site, atributos), horários e feriados nacionais dos próximos 45 dias (urgente a 14 dias), fotos, logo e capa (só o que o provedor informa) e o resumo das avaliações (nota, ritmo de 30 dias, distribuição, sem resposta, taxa de resposta). Cada item conta para "X de Y itens em ordem"; item sem dado do provedor fica fora da conta.

### 7.2 Página de automação [GB1a]

- Topo com as áreas em passos e **"X de 6 áreas configuradas"** (mede configuração, nunca "otimização"), o diagnóstico "X de Y itens em ordem" e os pontos para validar.
- À esquerda as áreas (Avaliações, Defesa da ficha, Informações, Horários, Postagens, Fotos), cada uma ligando as skills de base dela, com liga e desliga. À direita: o que a área faz, a escolha "Confiar no agente (automático)" ou "Revisar e aprovar antes", os números e as dicas que as análises encontraram, e os botões **"Preciso saber mais"** (o agente na gaveta, só dúvidas) e **"Aprovado, pode seguir"** (grava e vai para a próxima área). Serviços e saúde no Maps aparecem em "Outras análises", de forma genérica para qualquer análise do registro.
- Proibido na tela: "mais de 1.000 pontos de dados", "reverte em segundos", "geotagging", percentual de "otimização" e cidade sem dado real.
- **Trava [Decidido]:** enquanto ninguém aprovar todas as áreas pela primeira vez, o agente fica em "só sugerir", mesmo nas áreas em automático (`gb_locations.reviewed_at`).

### 7.3 Depois do fluxo (próximas etapas)

1. **Perguntas:** só as 3 ou 4 que mudam o resultado (postagens por semana, quem aprova, janela de silêncio, se já pode responder avaliações de 5 estrelas sozinho). O resto vem da cascata ([seção 8](#8-configurações-do-agente)).
2. **Palavras-chave:** o agente sugere de 3 a 5 a partir da categoria e do Portfólio; quem opera confirma.
3. **Primeiro mapa e primeira nota** por palavra-chave.
4. **Concorrentes de referência:** quem opera marca de 3 a 5 entre os mais fortes do raio.
5. **Ponto de partida:** tudo gravado com data. Os relatórios comparam sempre com ele ("em outubro você aparecia no top 3 em 12% do mapa; hoje, em 41%"). **[Proposta]** O ponto de partida entra no onboarding e não consome a cota mensal.
6. **Site:** se o cliente não tem site, o onboarding oferece o módulo `local-business-website` ([seção 15](#15-módulos-vizinhos)).

## 8. Configurações do agente

Configurações › Agente GMN, no layout de dois cards da ADR 0018. Tudo mora na cascata **[Decidido]** (o onboarding só preenche as mesmas chaves):

| Nível          | O que define                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| **Plataforma** | Padrões e tetos (por exemplo, diagnóstico semanal na segunda às 8h; no máximo 5 postagens por semana) |
| **Parceiro**   | Ajusta os padrões para os clientes dele, dentro dos tetos                                             |
| **Empresa**    | Ajusta dentro do que o parceiro liberou. No padrão, quem mexe é o cliente; no gerenciado, quem opera  |
| **Ficha**      | Sobrescreve o necessário numa unidade (por exemplo, uma loja que abre domingo)                        |

**[GB1a]** Chaves `google_business.skills` (liga e desliga e autonomia por skill de base; os níveis se somam skill a skill), `google_business.autonomy_ceiling` (teto da autonomia: a plataforma define, o parceiro só abaixa) e `google_business.triggers` (padrões de acionamento da seção 8.5) na tabela `settings`. O nível "ficha" é sobrescrita própria do módulo (`gb_area_settings`, por área), nunca acima do teto. Os tetos de volume entram no catálogo de cotas por plano (CF4). O editor completo de Agente, Soul e skills próprias é da GB7.

### 8.1 Agente, Soul e Skills

**[Decidido]** Um espaço para cadastrar e editar o agente, a personalidade e as skills, no editor de abas que já existe para os modelos de agente (A3a), com o "Testar agente" da A4b.

| Aba        | O que tem                                                                         | Quem edita                                                                         |
| ---------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Agente** | Nome, modelo de IA, instruções base, fontes de conhecimento ligadas               | A plataforma define; o parceiro ajusta para os clientes; no gerenciado, quem opera |
| **Soul**   | Tom de voz, jeito de escrever, valores, o que nunca dizer, assinatura             | Parceiro e empresa                                                                 |
| **Skills** | Lista com liga e desliga, autonomia e acionamento; criar e editar skills próprias | Ver as travas abaixo                                                               |

Cada skill tem nome, descrição, gatilho, instruções, exemplos (bons e ruins) e as ferramentas que pode usar.

**Travas [Proposta]:**

1. **Skills da plataforma travadas.** As de base e as regras fixas da [seção 9](#9-regras-fixas-e-pontos-de-atenção) não são editáveis nem desligáveis por nenhum nível. O parceiro pode duplicar uma skill da plataforma e ajustar a cópia.
2. **Skill não cria poder novo.** As ferramentas são uma lista fixa no código, como nos GUIDS; a skill só escolhe entre as permitidas. A autonomia continua valendo para skills próprias.
3. **Testar antes de ativar.** Skill nova ou editada só entra em uso depois de um teste com sucesso, com dados simulados. Cada versão fica guardada (quem, quando) e pode ser restaurada.
4. **Cota:** número de skills próprias por empresa entra no catálogo de cotas (CF4).

### 8.2 Skills de base

| Skill                      | O que faz                                          |
| -------------------------- | -------------------------------------------------- |
| Responder avaliações       | Rascunha ou publica respostas                      |
| Escalar avaliação negativa | Cria contato no CRM e avisa o responsável          |
| Pedir avaliações           | Link, QR e mensagens de pedido (regras da seção 9) |
| Escrever postagens         | Pauta, texto, imagem do cliente e botão            |
| Publicar fotos             | Classifica, descreve e publica aos poucos          |
| Cuidar dos horários        | Feriados e sincronia com a unidade                 |
| Sincronizar serviços       | Portfólio → ficha                                  |
| Otimizar informações       | Descrição, categorias e atributos                  |
| Defender a ficha           | Detecta e desfaz alterações de terceiros           |
| Saúde no Maps              | Mapa, concorrentes, avaliações e nota              |
| Relatórios                 | Monta e envia os relatórios                        |

### 8.3 Conhecimento do negócio

Fontes ligadas (unidades, Portfólio, base de conhecimento dos GUIDS, site); "sobre o negócio" (diferenciais, público, o que não fazemos); palavras e assuntos proibidos; termos da marca e região-alvo.

### 8.4 Autonomia

Por skill: **só sugerir**, **pedir aprovação** (padrão) ou **automático**. Quem aprova: quem opera (padrão no gerenciado), o cliente pelo WhatsApp, ou os dois. **[Em aberto]** O que acontece sem resposta do cliente em X horas: fica parado, ou segue para itens de baixo risco (como resposta a avaliação de 5 estrelas).

### 8.5 Acionamento

| Gatilho                | Padrão sugerido                                      |
| ---------------------- | ---------------------------------------------------- |
| Avaliação nova         | Rascunho em até 15 min                               |
| Alteração de terceiros | Imediato                                             |
| Diagnóstico completo   | Semanal (segunda, 8h) e ao conectar a ficha          |
| Mapa de posições       | Mensal por palavra-chave; quinzenal no Tier 3        |
| Postagens              | X por semana, em dias e horários escolhidos          |
| Fotos                  | X por semana, enquanto houver fotos na fila          |
| Feriados               | Mensal, olhando 45 dias à frente                     |
| Sincronia com a GUIDU  | Quando a unidade ou o Portfólio mudam                |
| Janela de silêncio     | Sem WhatsApp ao cliente das 20h às 8h e aos domingos |

### 8.6 Notificações, relatórios e limites

- **Notificações:** para quem (responsável da conta no gerenciado; owner e admin no padrão), canal (WhatsApp pelo Assistente, e-mail, sino) e o quê (urgente, resumo diário ou nada).
- **Relatório mensal do cliente:** link tokenizado sem login (documento técnico, §9.4) com a marca do parceiro: o que mudou (métricas e mapa frente ao ponto de partida), o que fizemos e o que vem. **[Em aberto]** Se vai também em PDF por e-mail.
- **Relatório semanal interno** (gerenciado): a carteira, com o que piorou e o que está pendente.
- **Limites:** postagens por mês, gasto de IA por mês (no padrão, avisa o cliente) e alterações automáticas por dia.

## 9. Regras fixas e pontos de atenção

### 9.1 Regras fixas (não desligáveis)

1. **Pedido de avaliação só dentro do horário comercial da unidade [Decidido]**, no fuso dela, já descontando feriados e horários especiais. Fora do horário, o pedido espera a próxima abertura. **[Proposta]** Depois de 7 dias na fila, expira. Unidade sem horário cadastrado: nenhum pedido sai, e o agente avisa.
2. **Política de reviews do documento técnico (§5.1A) [Decidido]:** **R1** o mesmo pedido para todos, sempre (sem pré-filtro humano ou automático); **R2** nunca sugerir conteúdo da avaliação (palavra-chave, serviço, nome de profissional); **R3** nenhum roteamento condicional por nota, nem como opção desligada. O pedido sai depois do atendimento sem pergunta prévia de satisfação.
3. **Nunca oferecer desconto ou brinde por avaliação**, nunca avaliar o próprio negócio nem pedir a funcionários.
4. **Nunca inventar** preço, horário, serviço ou promoção. O que não estiver na GUIDU é perguntado.
5. **Profissões reguladas** (CFM, CFO, OAB, CRP e outras): sem promoção de preço ou de resultado, conforme o conselho (documento técnico, §6.7).

### 9.2 Diretrizes do Google (risco de suspensão)

1. Nome igual ao nome real do negócio: sem palavra-chave, cidade ou slogan.
2. Endereço real com atendimento presencial; sem caixa postal. Quem atende na casa do cliente esconde o endereço e usa área de atendimento.
3. Uma ficha por local físico; não criar duplicadas.
4. Conteúdo proibido em postagens e fotos: enganoso, ofensivo, com dado pessoal de terceiros, foto de banco de imagens apresentada como própria.
5. Mudanças frequentes de nome, endereço ou categoria podem disparar nova verificação: o agente evita e avisa antes.

### 9.3 Dados sensíveis e LGPD

1. Nunca confirmar na resposta que a pessoa é cliente de algo sensível (saúde, jurídico, financeiro). "Que bom que o seu implante ficou ótimo" expõe um tratamento de saúde.
2. Nunca citar nome de funcionário, valor pago ou detalhe de atendimento que a pessoa não escreveu.
3. Avaliação negativa: reconhecer, não discutir, levar para um canal privado.

### 9.4 Limites técnicos

1. No máximo 10 edições por minuto por ficha (limite do Google, sem aumento); "aplicar tudo" vira fila.
2. Alterações podem ficar em análise no Google: cada ajuste mostra enviado → em análise → publicado ou recusado.
3. Postagens passam por moderação; recusa vira alerta com o motivo provável.
4. Conexão perdida (token revogado, perda de acesso) é alerta imediato.
5. Ritmo natural: postagens e fotos espaçadas, nunca em rajada; uma resposta por avaliação (editar, não duplicar).

## 10. Telas

| Onde        | Padrão (o cliente opera)                                                                                   | Gerenciado (parceiro ou GUIDU opera)                          |
| ----------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `/app`      | Tela de trabalho, configurações e agente na gaveta                                                         | Acompanhamento, relatórios e aprovações (se o cliente quiser) |
| `/admin`    | Situação da ficha, sem os dados                                                                            | Carteira e tela de trabalho completas                         |
| `/platform` | Skills de base, diretrizes, padrões e tetos; carteira das fichas do parceiro zero (gerenciadas pela GUIDU) |                                                               |
| WhatsApp    | Avisos e aprovações pelo Assistente                                                                        | Avisos e aprovações pelo Assistente                           |

**Tela de trabalho [Proposta]:**

- **Carteira** à esquerda (no `/admin`): todas as fichas, ordenadas por "precisa de atenção"; troca rápida por busca (⌘K) e atalhos para a ficha anterior e a próxima. Navegar entre contas sem entrar no `/app` de cada cliente **[Decidido]**.
- **Ficha** no centro: diagnóstico, sugestões com o valor atual e o sugerido (Aplicar, Editar, Descartar), saúde no Maps, linha do tempo com desfazer.
- **Agente na gaveta** à direita (ADR 0015).
- **Fila de aprovações**, **alertas** (defesa, queda de nota, suspensão, conexão perdida) e **linha do tempo** (quem fez: agente, operador, cliente ou Google).

Telas seguem o padrão do projeto: shell sidebar-08 (ADR 0014), componentes shadcn, retorno pelo `useStatus()` (ADR 0016), três idiomas.

## 11. Provedores

**[Proposta]** Duas portas, como a `PaymentProvider` da cobrança. Telas, agente e regras falam só com a porta; trocar o provedor não refaz nada. Testes e e2e usam o provedor falso.

| Porta                      | Adaptadores                                                                               | Observação                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GoogleBusinessProvider`   | `zernio` (agora, testes com conta própria **[Decidido]**), `google` (API oficial), `fake` | A Zernio cobre avaliações (listar, responder, webhook de nova ou alterada), postagens, serviços, métricas e OAuth hospedado. Horários, envio de fotos e aviso de alteração do Google ainda precisam ser confirmados na conta |
| `MapsIntelligenceProvider` | `dataforseo`, `google_maps` (Places), `fake`                                              | Mapa de posições e concorrentes pela DataForSEO; detalhes e geocodificação pelo Places                                                                                                                                       |

- **API oficial do Google:** o acesso é aprovado por projeto do Google Cloud (até 14 dias; antes disso, a cota é zero). O escopo `business.manage` é sensível e entra na verificação do app OAuth da GUIDU (CF6b), somado aos de Drive, Planilhas e Agenda.
- **Avisos do Google:** a Notifications API envia, via Pub/Sub, avaliação nova, avaliação alterada e alteração feita pelo Google. Dados de perfil em geral exigem checagem periódica.
- **Chaves e segredos** em variáveis de ambiente ou no cofre, nunca no chat nem no repositório (`ZERNIO_API_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `GOOGLE_MAPS_API_KEY`).
- **[GB1a]** Porta em `src/modules/google-business/provider/`: `GOOGLE_BUSINESS_PROVIDER=fake` nos testes e e2e (tela de consentimento falsa, recusada em produção); senão Zernio com `ZERNIO_API_KEY` e `ZERNIO_PROFILE_ID` (o perfil da Zernio onde as contas são conectadas). Todos os caminhos de endpoint ficam em `zernio-endpoints.ts`, tirados da referência pública da API da Zernio (SDK Go gerado do OpenAPI), pois docs.zernio.com não estava acessível; conferir com a conta real (pendências). O adaptador só lê: conexão em modo `headless`, lista de fichas, seleção de uma ficha, detalhes e avaliações. Endereço e número de fotos não vêm na resposta confirmada e ficam como "sem dado".
- **Operadores de dados:** Zernio e DataForSEO tratam dados dos clientes e entram como operadores no contrato e na política de privacidade (pendência LGPD).
- **`MapsIntelligenceProvider` (GB1b):** implementada em `src/modules/google-business/maps/provider/` com `dataforseo` (Maps SERP por coordenada, My Business Info e avaliações, fila padrão com até 100 tarefas por envio e espera limitada a 5 minutos), `fake` (testes e e2e) e o localizador do Places (só a coordenada do centro, sem guardar). Variáveis: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `GOOGLE_MAPS_API_KEY` (opcional), `MAPS_INTELLIGENCE_PROVIDER` (`dataforseo` ou `fake`) e `GB_SUGGESTIONS_PROVIDER=fake` para a IA falsa; a produção recusa os dois falsos ao subir.

## 12. Dados (proposta)

Nomes são propostas; as migrations saem em cada etapa. Toda tabela com FORCE RLS, `revoke` de `anon` e `authenticated`, consulta por Prisma dentro do contexto e auditoria.

| Tabela                            | Para quê                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `organization_service_modes`      | Modo de serviço da empresa e o parceiro que gerencia (ADR 0020) **[GB1a]**                  |
| `service_mode_requests`           | Pedidos de troca com o link seguro (hash do token, prazo, decisão, IP)                      |
| `gb_locations`                    | Ficha ligada a uma unidade: conta, `place_id`, provedor, situação da conexão **[GB1a]**     |
| `gb_snapshots`                    | Versões da ficha: a inicial do onboarding e as aprovadas (base da defesa) **[GB1a]**        |
| `gb_analysis_runs`                | Resultado de cada análise do registro por ficha, com fase e situação **[GB1a]**             |
| `gb_area_settings`                | Nível "ficha" das configurações (liga e autonomia por área) e aprovação da área **[GB1a]**  |
| `gb_changes`                      | Linha do tempo: proposta, quem, estado (enviado, em análise, publicado, recusado), desfazer |
| `gb_reviews`, `gb_review_replies` | Avaliações e respostas, com o contato do CRM quando escalada                                |
| `gb_posts`, `gb_media`            | Postagens e fila de fotos do cliente                                                        |
| `gb_review_requests`              | Pedidos de avaliação na fila do horário comercial                                           |
| `gb_keywords`, `gb_competitors`   | Palavras-chave monitoradas e concorrentes de referência (`place_id`)                        |
| `gb_maps_scans`                   | Medições do mapa (grade, posições, SoLV, nota) e o ponto de partida                         |
| `gb_reports`                      | Relatórios e o token do link                                                                |
| `ai_agent_skills`                 | Skills e versões, com escopo plataforma, parceiro ou empresa (no módulo de agentes)         |

As configurações ficam na `settings` (ADR 0018). Os dados do workspace entram na exportação e na exclusão (F3e).

## 13. Permissões (proposta)

- Workspace: `google_business.read` (acompanhar) e `google_business.manage` (operar, no padrão: owner e admin).
- Parceiro: `partner.google_business.manage` (operar no gerenciado: `partner_owner`, `partner_admin` e `partner_support`).
- Plataforma: `platform.google_business.manage` (skills de base, diretrizes, padrões e tetos: `owner` e `operations`).
- O acesso do parceiro ao workspace inteiro no gerenciado segue a ADR 0020. Toda ação de quem gerencia é auditada e aparece para o cliente na linha do tempo.

## 14. Privacidade

- Respostas e postagens seguem a seção 9.3.
- O pedido de avaliação usa só contatos com consentimento e respeita o opt-out.
- Relatórios por link tokenizado não mostram dados pessoais de quem avaliou além do que está público na avaliação.
- Zernio e DataForSEO são operadores (seção 11); a revisão jurídica de LGPD (D-PA-06) cobre o módulo antes de abrir para clientes de fora.

## 15. Módulos vizinhos

- **`local-business-website` [Decidido]:** o site do negócio do documento técnico (§6, "Ficha Viva"): ~14 URLs agent-first (home, sobre, serviços com até 4 páginas, perguntas frequentes, avaliações, área de atendimento, até 2 páginas de intenção, agendar), com a camada para IA (`.md`, `llms.txt`, sitemap, robots e JSON-LD). Entra no plano de assinatura (alugado) e o domínio do cliente vem no Setup, registrado no CPF/CNPJ dele (documento técnico, §7.3). Consome este módulo (ficha, avaliações), o Portfólio e o CRM. Especificação própria em etapa futura; o PRD do LBP é a base.
- **Perfil local:** outro módulo, a conversar depois **[Decidido]**.
- **Menu "Presença Digital" no `/app` [Proposta]:** Site, Perfil local, Quiz e, na v2, o Cartão (perfil digital), cada um como módulo liberado por plano. Rotas `/app/{workspace}/presenca/...`. Os endereços públicos vêm da CF2c (tipo `page`) e da CF2e; os caminhos fixos do site entram nos reservados da CF2e. A rota pública no contrato de módulos é a mesma ADR prevista na DP0 do perfil digital.

## 16. Decisões

**Decididas pelo Marcelo (15 e 16/10/2026):**

1. Agente dedicado à ficha do Google, subagente do Assistente GUIDU (agente de conta). No parceiro, o Assistente roda com a chave dele.
2. Modo gerenciado: chave da plataforma ou do parceiro; o cliente paga gestão na mensalidade. Modo padrão: chave do cliente; o cliente paga a ferramenta.
3. Módulo liberado por plano de assinatura.
4. Ordem: avaliações e defesa da ficha primeiro; depois postagens; depois fotos e horários. Testes com uma conta da Zernio.
5. Uma ficha por unidade; várias por workspace.
6. Fotos: só as que o cliente envia.
7. Tela de trabalho para quem opera; navegação rápida entre contas; gestão também no `/admin`.
8. Modos de serviço por empresa: padrão (cliente opera, acesso restrito de quem gerencia) e gerenciado (acesso total ao workspace). Onboarding entra em padrão; troca por pedido formal e link seguro aprovado pelo cliente; o cliente pode voltar sozinho.
9. Acionamento nas configurações, em cascata; o onboarding só preenche.
10. Pedido de avaliação só no horário comercial, como regra fixa.
11. Espaço para Agente, Soul e Skills nas configurações do agente.
12. Saúde no Maps com DataForSEO e Google Maps Platform, no roadmap.
13. Posição frente aos concorrentes definida no primeiro onboarding.
14. Site do negócio como módulo `local-business-website`, no plano de assinatura, conforme o documento técnico; perfil local fica para outro módulo.

**Em aberto:**

1. O que acontece sem resposta do cliente a uma aprovação (seção 8.4).
2. Relatório mensal também em PDF por e-mail (seção 8.6).
3. Concorrência pela API do Google Places além da DataForSEO: entra agora ou depois.
4. Valores das cotas por plano (palavras-chave, frequência do mapa, postagens, skills próprias).
5. Se a GB4 (saúde no Maps e prospecção) sobe para logo depois da GB1, por prioridade comercial.

## 17. Etapas

| Etapa | Entrega                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0    | Esta especificação, as ADRs 0019 e 0020 e as pendências (só documentação)                                                                                                                                                                                                                                                                                                              |
| GB1a  | Onboarding "Adicionar local" (janela em tela cheia, conexão com o provedor, unidade criada ou ligada, versão inicial), runner das análises por fase com as análises determinísticas, página de automação, agente na gaveta só para dúvidas (`specialist` mínimo), porta `GoogleBusinessProvider` (Zernio e falso), modos de serviço mínimos e as chaves `google_business.*` da cascata |
| GB1b  | Análises inteligentes do local (sugestões da IA por área, com a nossa chave) e a saúde no Maps, entregues pelo registro do [contrato](contrato-analises.md), com tabelas próprias ligadas à unidade                                                                                                                                                                                    |
| GB2   | Avaliações e defesa: respostas por estrela, escalonamento para o CRM, autonomia e aprovação pelo WhatsApp, alertas e desfazer; pedido de troca de modo por link seguro                                                                                                                                                                                                                 |
| GB3   | Tela de trabalho: carteira, aplicar na hora, linha do tempo, agente na gaveta com ações, troca rápida de ficha                                                                                                                                                                                                                                                                         |
| GB4   | Saúde no Maps completa: porta `MapsIntelligenceProvider`, mapa de posições, SoLV, concorrentes, consistência, nota, cotas e custo; ponto de partida no onboarding; diagnóstico de prospecção                                                                                                                                                                                           |
| GB5   | Postagens e pedido de avaliação (horário comercial)                                                                                                                                                                                                                                                                                                                                    |
| GB6   | Fotos (tela, link e WhatsApp), horários e feriados, serviços do Portfólio                                                                                                                                                                                                                                                                                                              |
| GB7   | Relatórios (mensal do cliente, semanal da carteira), editor de Agente, Soul e skills próprias com teste e versões                                                                                                                                                                                                                                                                      |
| GB8   | Troca da Zernio pela API oficial do Google (white label), quando o acesso for aprovado                                                                                                                                                                                                                                                                                                 |

Cada etapa começa com o "pode começar" do Marcelo e vira um PR com testes. O módulo `local-business-website` tem etapas próprias, depois da GB4.

## 18. Fontes

- [Documento técnico da SoulLocal v2.11](../documento-tecnico-soullocal-v2_11.md): §5.1 (gestão do GBP), §5.1A (política de reviews), §6 (LBP), §7.3 (domínios), §7.7 (geo-grid), §9.1 (planos) e §9.4 (relatório dinâmico).
- `AgriciDaniel/claude-seo` (MIT), `skills/seo-maps` e `skills/seo/references/` (geo-grid, checklist da ficha, sinais locais, custos da DataForSEO). Estatísticas de terceiros (Whitespark, Sterling Sky) entram marcadas como estudo de mercado, nunca como regra do Google.
- Google: [perguntas frequentes da Business Profile API](https://developers.google.com/my-business/content/faq) e [limites de uso](https://developers.google.com/my-business/content/limits).
- Zernio: [responder avaliação](https://docs.zernio.com/google-business/reply-to-google-business-review), [inbox de avaliações](https://docs.zernio.com/platforms/google-business/inbox) e [serviços](https://docs.zernio.com/platforms/google-business/services-menus).
