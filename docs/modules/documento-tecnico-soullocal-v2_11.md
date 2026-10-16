# SoulLocal — Documento Técnico
## Plataforma de Presença Digital Local: SEO Tradicional + SEO Agêntico (GEO)

**Versão:** 2.11 · **Data:** Julho 2026 · **Status:** Especificação consolidada da sessão de planejamento
**Novidades da v1.1:** widget de chat próprio (Chatwoot) + agente SDR como canal independente do WhatsApp; HugoBlox como referência de arquitetura de conteúdo; estratégia de dois trilhos (Markdown → Supabase).
**Novidades da v1.2:** produto **LBP — Perfil da Empresa Local ("Ficha Viva")** formalizado como núcleo da assinatura (§6); estrutura de páginas cravada como padrão; sistema de design em três camadas (esqueleto / pele / assinatura) com travas de premium; motor de paleta herdado do CartãoPro; componente **Troca de Contato** (captura + vCard) substituindo o "salvar contato"; camada de profissionais regulados (médico, dentista, advogado, psicólogo) com compliance de conselho; atualização de precificação, roadmap e KPIs.
**Novidades da v1.3:** **Motor de Frescor** (§5.4) — o LBP como organismo vivo, com campo `perecivel` no schema e o loop frescor↔WhatsApp; **Agente de Conteúdo Autônomo** (§5.5) ancorado no **pipeline de governança de agente herdado do CartãoPro** (MCP → proposta com ID de ponta a ponta → deny-by-default → policy engine por canal + vertical → human gate por exceção → executor); **Conversão em GEO / funil do zero-click** (§6.11) com cronograma de expectativa; compliance de conselho codificado como regra inegociável no policy engine; atualização de arquitetura, heranças e KPIs.
**Novidades da v1.4:** decisão de **plataforma única — tudo no Trilho 2, SoulLocal como tenant zero** (§7.5); **BYO-LLM** — a Mia e as automações rodam na chave do próprio comerciante, com fallback "sneak peek" ao modelo genérico como padrão e aviso de atualização de API (§5.2, §7.5); LLM da SoulLocal em credenciais próprias, bucket separado; nota de **escala do Supabase** (schema compartilhado; visitantes não são MAU; sobe-se compute, não se migra); **modelo econômico** infra × variável × mão de obra (§9.1); vertical **short stays** priorizado com variante **LBP Short Stay** (§6.12) e estratégia de reviews OTA→Google; **Quiz de Captação** integrado como motor inbound (§4.5, doc próprio); estrutura do **site da SoulLocal — Búzios v1** (§13).
**Novidades da v1.5:** **Fonte única de política** cravada como invariante de arquitetura (§5.5, §8) — políticas vivem em um só policy engine, orquestradores são intercambiáveis; **Paperclip e Multica** citados como candidatos a control plane interno (não-código com vigilância AAA / código), sem comprometer escolha; **DataForSEO** como camada de dados consolidada (§7.1, §7.6) — SERP/Local Pack, concorrentes, MCP oficial; **LLM Mentions API** fecha o serviço de **GEO mensurável** (§7.6, §6.11); separação explícita **dado interno (Search Console/Analytics/DataForSEO) × painel traduzido do cliente** (§7.6).
**Novidades da v1.6:** IA operacional renomeada de "Beca" para **Mia** (nome provisório — Joi/Beca/Anna são nomes internos do CartãoPro); início do PRD por serviço, começando pelo **GBP** (documento próprio: PRD — Serviço de Gestão de Google Business Profile).
**Novidades da v1.7:** PRDs de **Reviews** (serviço próprio que alimenta o GBP) e **LBP** (produto-âncora, recorte "cliente") criados como documentos próprios; `facts` ganha coluna **`idioma`** (multi-idioma PT/ES/EN — uma linha por idioma, cada versão vira página agent-first indexável); nota de dependência da Business Profile API (Fluxo B) para coleta/tempo real replicada nos PRDs.
**Novidades da v1.8:** PRD da **Mia** criado (Modo SDR + **Modo Operador** — o comerciante opera o negócio por voz no WhatsApp, config 100% interna, número+PIN, sempre confirmar); **Portfólio Multi-Vertical** registrado como componente de plataforma (herança CartãoPro; schema a preencher); **soft delete** como padrão de exclusão (30 dias, recuperável); **camada de LGPD de plataforma** (opt-in/opt-out, DPO, políticas versionadas) obrigatória e transversal, com fluxo de eliminação que bloqueia comunicação com o titular durante o processo.
**Novidades da v1.9:** **Enriquecimento por CNPJ via BrasilAPI** (§3.1A) — novo nó do pipeline do Raio-X entre coleta e LLM (porte, sócios, situação cadastral; gratuita); alimenta qualificação pré-abordagem, personalização e o **ranking de priorização** (nota alta + presença fraca + porte = topo da fila); mantido como bastidor interno — **não aparece no PDF/relatório** que o lead vê (só dados de presença aparecem, para preservar o tom consultivo).
**Novidades da v2.0:** **Tenant Fantasma** (§3.1B) registrado como **piloto controlado** — páginas de prospecção que nascem automaticamente (mecânica de "assumir empresa" do Google/Facebook aplicada à plataforma), com os três CTAs (CartãoPro, reivindicar LBP, avaliar no TrueBz); risco identificado de **scaled content abuse** (política de spam do Google) no volume potencial (~2.000 páginas/mês, ~8 mil empresas em Búzios); mitigado com lote piloto pequeno, curadoria multi-fonte, domínio separado e critério de decisão explícito (retorno positivo escala; negativo mantém o fluxo de prospecção original como plano B).
**Novidades da v2.1:** **Marca resolvida — "SoulLocal"** substitui "Sunset Labs" em todo o documento e nos PRDs (agência, domínio `soullocal.com.br`, SoulLocal Score); domínio do Tenant Fantasma confirmado como `business.begoo.com.br` — **Begoo é projeto de cidade inteligente** (com `begoo.chat`, conectado ao Hostse), distinto da SoulLocal, parte do "pacote de projetos para Búzios"; mapa do ecossistema de projetos registrado (SoulLocal / Hostse / Begoo) com a relação exata entre eles marcada como a esclarecer.
**Novidades da v2.2:** nova **§0 — Ecossistema do Grupo** — SoulLocal/Hostse/Begoo confirmados como **empresas do mesmo grupo, CNPJs e bases de dados separadas, sem restrição de domínio**; tabela de papel/momento da jornada/base por empresa; **correção técnica no Tenant Fantasma (§3.1B):** a reivindicação é **migração real via API** entre a base do Begoo e a base da SoulLocal (não mais "troca de status numa base compartilhada", como registrado anteriormente); flagada a necessidade de decidir se a fonte única de política se estende ao nível de grupo (Begoo consulta o policy engine da SoulLocal?) e a nota de atenção LGPD sobre transferência de dado entre controladores distintos do grupo.
**Novidades da v2.3:** **§9.2 — Projeção de crescimento** (o "efeito teto"/balde furado: 100 assinantes é inatingível no ritmo original de captação; corrigido com 10–20 leads/dia de canais calibrados, o teto sobe para 150+, e o gargalo migra para a **capacidade de onboarding/mês** — variável ainda não medida que decide entre 7 meses e 3+ anos até a meta); **§9.3 — P0 Sintonia operacional e Owner Success**: sintonia entre agentes/fluxos/regras/sistemas/políticas elevada a prioridade contínua (não tarefa única); human gate **mínimo viável e seguro**, com piso de segurança — **pelo menos um colaborador acompanha o onboarding de cada comerciante**; novo **painel Owner Success** (incidentes, chamados, humor no chat, alerta de intervenção da gerência) como mecanismo operacional de retenção, com schema e nota de consistência com a fonte única de política.
**Novidades da v2.4:** **§1.1 — Princípio "zero narrativa / prova de resultado"** cravado como par transversal (nenhuma feature existe para o cliente *sentir* trabalho; todo resultado entregue é tornado *visível*); refinamento da **§5.5** com a distinção **gate previsto × escalação imprevista** (chamar humano nunca é erro do agente; o que se mede não é "quantas vezes o humano foi chamado", é "quantas vezes pelo mesmo motivo evitável" — cada escalação repetida vira item de curadoria do livro de regras); nova **§9.4 — Relatório Dinâmico do cliente** (link tokenizado sem login, eixo de delta mês vs. mês anterior, três camadas o-que-mudou/o-que-fizemos/dinheiro, e o **modo "mês plano"** que preserva a honestidade da prova); nota de que o link tokenizado é **primitiva transversal** (onboarding, aprovação de agente, aprovação do cliente, relatório).
**Novidades da v2.5:** nova **§9.2.1 — Canal de indução** (entrada em lote com confiança emprestada): promovido de item solto da Fase 5 a **canal de primeira classe**, por atacar o gargalo real (capacidade de onboarding) e não o volume de lead — menos esforço de venda, menos atrito no Fluxo A do GBP e lote homogêneo/padronizável; candidatos mapeados (contadores como análogo mais direto, distribuidores, associações de Búzios, franqueadoras, Sebrae), ressalva de cadência vs. capacidade, e pendência de modelo de contrapartida ao indicador. Origem: análise competitiva Merchynt (documento próprio de Inteligência Competitiva).
**Novidades da v2.6 — arquitetura de domínios e correção do eixo de venda:** **§6.1A (nova)** — a metáfora "casa própria do cliente" é **corrigida**: não sobrevive à pergunta "e se eu parar de pagar?" num modelo de assinatura, e prometer "ativo próprio" no aluguel é a narrativa vazia que a §1.1 proíbe. Novo eixo: ***"você aluga a ferramenta; o resultado se acumula no que é seu"***, com a separação honesta do que fica (ficha, avaliações, domínio, contatos, histórico) e do que para (LBP, Mia, frescor, monitoramento), mais os três argumentos que dispensam alegar posse (de quem é o cliente · estrutura de custo percentual vs. fixa · ponto comercial). **§3.1B** — Tenant Fantasma migra de `business.begoo.com.br/{empresa}` para **`begoo.guide` (portal na raiz) + `begoo.guide/{cidade}/{negocio}`**, com justificativa de consolidação de autoridade (portal herda o peso das fichas), replicabilidade por cidade em subpasta e recusa explícita de subdomínio por negócio; **regra nova de uma única página por não-cliente** (proibidas subpáginas de produto — multiplicariam o risco, publicariam dado inferido sobre quem não pode corrigir e entregariam de graça o que se vende); **301 obrigatório na reivindicação**, com a entrada permanecendo no buscador e virando argumento de venda (histórico indexado transferido). **§7.3** — domínio do cliente **deixa de ser upsell do Tier 3** e passa a ser **incluído no Setup em todos os tiers**, obrigatoriamente registrado no **CPF/CNPJ do cliente** (domínio em nome da agência é coleira, não bônus); fallback de subdomínio mantido só para quem não puder registrar; nota de por que fallback é subdomínio e não subpasta. **§9.1** — Tier 3 renomeado de "Domínio" para **"Inteligência"**, refletindo o que de fato sustenta o preço.
**Novidades da v2.7 — Política de Reviews:** nova **§5.1A**, elevada a **regra do policy engine** (não recomendação), aplicável ao WhatsApp como canal principal: **R1** mesmo pedido para todos, sempre (proibido pré-filtro, humano ou automático — a política do Google não distingue automação de conversa 1:1); **R2** nunca sugerir conteúdo (palavra-chave, serviço, nome de profissional); **R3** nenhum roteamento condicional por nota, **nem como opção desligada por padrão** (em white-label quem configura é a SoulLocal, então a responsabilidade e o colateral são nossos). Resolve a tensão prática por **arquitetura, não disciplina**: o pedido dispara automático pós-atendimento, **sem pergunta prévia de satisfação** — sem o sinal na mão não há o que filtrar, *compliant por construção*. Registra por que o gating também é **má estratégia** independentemente da regra (a premissa "gostei ⇒ 5 estrelas" é falsa; filtrar reduz volume e **volume é a defesa**; 5,0 perfeito lê como fabricado; o rastro é estatístico — ausência de cauda) e o **risco recíproco de reputação**: atalho que penaliza o cliente volta como meia estrela na ficha da própria agência. Fixa o discurso de venda **"a estrela é sua; o resto é nosso"** (com a divisão de responsabilidade e o descarte explícito da versão "você que lute"), a ser dito **antes** da venda como filtro de cliente. Formaliza o **diagnóstico de sentimento por LLM** como a entrega que substitui o atalho — a SoulLocal não dá a estrela, mostra onde ela está vazando — com encaixe na camada 2 do Relatório Dinâmico (§9.4).
**Novidades da v2.8 — Geo-grid (varredura geográfica de visibilidade):** nova **§7.7**, que registra o instrumento que faltava por trás de duas promessas já vendidas. **Custo cravado** (DataForSEO Local Finder, fila padrão): ~R$ 0,03 por prospect no Raio-X 3×3 e ~R$ 1,60 por cliente/mês no regime 7×7 — **custo nunca foi a restrição**, com ressalvas de profundidade e parâmetros a validar em lote pequeno antes de fixar no modelo. **Restrição de stack cravada:** tem de ser DataForSEO com coordenadas, **não Places API** — Places não retorna negócio sem endereço físico, o que apagaria passeio, transfer e chef em casa (metade do mercado de Búzios). Quatro usos em ordem de retorno (venda no Raio-X · retenção na camada 1 do §9.4 · **substância do Tier 3**, que até aqui prometia monitoramento e alertas sem mecanismo por trás · trigger de ação, real mas limitado). **Reconciliação com a §1.1:** o heatmap continua sendo teatro quando entregue sozinho; o que o tira do teatro é a **regra de nunca publicar nó sem a ação ao lado** — proximidade é fator dominante e nenhum conteúdo resolve estar fisicamente longe, então vender "nossa IA detecta e corrige fraqueza geográfica" seria narrativa. O que é ação real: o grid **define o vocabulário geográfico do conteúdo** (bairro em FAQ, `areaServed` no JSON-LD, página de bairro no motor programático) e **detecta concorrente novo**.
**Novidades da v2.9 — Tipologia de páginas e analytics por URL:** nova **§6.5A**, que separa formalmente **página de local** (responde "onde/quem", já existente), **página de destino** (responde a decisão anterior à escolha, é ativo da SoulLocal no portal) e **página de intenção** (responde "o quê", organizada pela consulta e não pelo catálogo). O **princípio que governa as três**, e que resolve o problema do anúncio disfarçado: **a página não precisa ser completa sobre o inventário; precisa ser completa sobre o lugar.** Novo tipo de URL `/{intencao}` no conjunto da §6.5, **capado em 2 na assinatura**, com curadoria individual obrigatória e critério de existência por demanda medida — nunca por combinatória, sob pena de reproduzir no domínio do cliente pagante o `scaled content abuse` que a §3.1B já identificou. A página de intenção é o **destino do vocabulário geográfico do geo-grid (§7.7)**, o que torna a regra "nó sem ação ao lado não é publicado" operável em vez de aspiracional. Nova **§6.9A — analytics por URL**, aplicável a páginas de local e de intenção, como insumo da curadoria mensal. Detalhamento completo de páginas de destino e de intenção no documento companheiro **"Documento Técnico — Páginas de Destino e Páginas de Intenção v1.0"**.
**Novidades da v2.10 — Camada de conhecimento:** nova **§7.2A**, que parte de uma inversão: plataformas enterprise distribuem uma verdade que já existe, enquanto **nosso cliente não tem fonte a sincronizar** — a verdade precisa ser fabricada antes de distribuída, o que reposiciona o Setup (o entregável é a base de conhecimento, não o site). Separa **seis tipos de conhecimento** (declarado, operacional, restritivo, observado, derivado, de interação) com condições de verdade distintas: **declarado vence e revalida; observado nunca vence; derivado carrega procedência e nunca se apresenta como declarado**. Introduz a **dimensão de escopo** (global / vertical / cidade / tenant), que elimina a replicação de norma de conselho por tenant e **destrava a página de destino** — conhecimento de bairro é escopo cidade, logo sustenta o portal e o LBP sem duplicação. Crava as **regras de aterramento da Mia**: ausência é estado, não vazio; três estados, três comportamentos; nunca inventa — porque fato alucinado produz o cliente irritado na porta e a avaliação de uma estrela que vendemos para evitar. E três regras de governança: **R1** nenhum agente escreve conhecimento sem passar pelo pipeline; **R2** restritivo é o único tipo que o cliente não pode alterar, o que faz a conformidade descer da geração para o dado e sustenta a frase *estruturalmente incapaz de publicar fora da norma do seu conselho*; **R3** toda saída de agente é rastreável ao conhecimento que a gerou, valendo agora também para relatório e conteúdo.
**Novidades da v2.11 — Interface do portal, v1 exploratória:** nova **§3.1C**, registrada deliberadamente **sem o rigor das seções anteriores** — é fase de descoberta ("stalkear os players, criar as features"), não arquitetura travada. Modelo de referência: Google Travel Hotels — faixa curta de destaques + "ver tudo"; **Lista e Mapa deixam de ser opções paralelas e viram uma tela só**, lendo o mesmo resultado; a Mia é peça separada, plugada por cima quando pronta. Schema v1 mínimo (nome, categoria, bairro, coordenadas, contato, foto, nota), populado pelo que a prospecção da agência **já gera** — sem coleta nova. Card único, sempre "Ver detalhes". Nota de confirmação: a URL de metasearch da Booking analisada em sessão confirma o formato de parâmetro já especificado na §3 do documento companheiro e expõe que aquele modelo de referência é leilão pago por baixo — guardado para quando a regra de ordenação for escrita a sério, não aplicado agora.

---

---

## 0. Ecossistema do Grupo (contexto institucional)

**Três empresas do mesmo grupo, CNPJs separados, sem restrição de domínio entre elas.** A atenção arquitetural não é "domínio pode ou não pode" — é **onde encaixar cada parte para não virar caixa de Pandora** (identidade confusa pro cliente, ambiguidade de dono do dado, de faturamento, e risco de fragmentar a fonte única de política que o resto deste documento pressupõe).

| Empresa | Papel | Momento da jornada | Base de dados |
|---|---|---|---|
| **SoulLocal** | Presença digital + captação (GBP, LBP, Reviews, Mia, Quiz, CartãoPro) — este documento | **Antes** da reserva/venda (descoberta, decisão, captura) | Supabase próprio — multi-tenant por linha, SoulLocal é tenant zero (§7.5) |
| **Hostse** | Sistema operacional da estadia (check-in, concierge, upsell, jobs) — documento próprio | **Depois** da reserva confirmada (operação) | Base própria (Matrix, Kong — arquitetura própria) |
| **Begoo** | Projeto de cidade inteligente (`begoo.chat`, conectado ao Hostse); hospeda **`begoo.guide`** — portal de busca + páginas de Tenant Fantasma da prospecção SoulLocal (§3.1B). *(`begoo.co` é ativo do Begoo — não é endereço de cliente pagante da SoulLocal, ver §7.3.)* | Descoberta/existência pública do negócio na web, **antes de qualquer relação com a SoulLocal** | Base própria, separada |

**Fronteiras confirmadas (decisões de arquitetura de grupo):**
- **Bases separadas por empresa, integradas via API.** Não há banco único do grupo. Cada empresa é dona da sua própria infraestrutura.
- **CNPJs separados** — cada empresa é entidade jurídica distinta. **Implicação LGPD:** dado que nasce numa (ex.: página fantasma coletada/publicada pelo Begoo) e é usado por outra (SoulLocal, após reivindicação) atravessa uma fronteira real de controlador — não é "é tudo nosso mesmo" automaticamente. Base legal segue o mesmo princípio já usado no Raio-X (legítimo interesse B2B + dado público) para a coleta inicial no Begoo; a **transferência para a SoulLocal se dá no ato de reivindicação** (ação afirmativa do próprio dono do negócio), que também marca o início da relação controladora da SoulLocal a partir daquele ponto. *Recomenda-se formalizar isso com um acordo de compartilhamento/transferência de dados entre as empresas do grupo — não é orientação jurídica, é sinal de atenção.*
- **Migração real na reivindicação (não status interno):** como as bases são separadas, "reivindicar" não é uma troca de status numa mesma tabela — é uma **chamada de API que cria o tenant de verdade na base da SoulLocal**, a partir do dado que existia na página do Begoo. *(Corrige o registro anterior deste documento, que supunha uma única base compartilhada para o tenant fantasma — ver §3.1B.)*
- **Fonte única de política — pendente de decisão em nível de grupo:** o princípio "política vive num só policy engine" (§5.5) foi desenhado para os orquestradores *dentro* da SoulLocal. Com três empresas operando fluxos adjacentes, falta decidir: **o Begoo consulta o policy engine da SoulLocal para as regras que afetam a página fantasma (ex.: o que pode aparecer, compliance), ou o Begoo tem o seu próprio?** Se cada empresa tiver o seu, o grupo recria em nível corporativo o problema que a fonte única foi criada para evitar em nível de ferramenta. **A definir.**
- **Identidade coerente pro cliente (a definir):** o dono do negócio passa por até três empresas na jornada (Begoo → SoulLocal → possivelmente Hostse). Vale desenhar como a experiência sinaliza a afiliação do grupo sem confundir "quem está falando comigo agora" — decisão de marca/UX ainda em aberto.

---

## 1. Visão Geral

A SoulLocal oferece um serviço integrado de presença digital para negócios locais premium, combinando:

1. **Aquisição** via relatório personalizado ("Raio-X Digital Competitivo", outbound) e **Quiz de Captação** (motor inbound — ver §4.5 e documento próprio), ambos convergindo para o WhatsApp consultivo de baixo volume;
2. **Entrega** via **LBP (Perfil da Empresa Local / "Ficha Viva")** — gestão de Google Business Profile (GBP), automação de reviews, chatbot IA white-label (Mia) e páginas otimizadas para busca tradicional e busca agêntica (IA), embaladas em um produto único de marca premium;
3. **Retenção** via dashboard SaaS multi-tenant com monitoramento de concorrentes e histórico.

**Tese central:** o mesmo motor de dados alimenta o diagnóstico (relatório de venda), o serviço (automação) e a retenção (dashboard). Uma fonte de verdade, três saídas.

**Produto de venda ao comerciante local:** não se vende "um site". Vende-se **ser encontrado** (SEO tradicional + ficha Google), **ser citado pela IA** (GEO) e **atender/capturar 24h** (Mia). O LBP é o veículo que entrega os três. Pitch central: *"o site do seu negócio deixa de ser um panfleto e vira um funcionário — achado por gente e por IA, respondendo sozinho de madrugada."*

**Mercados-alvo:**
- **Fase 1 — Tijuca/RJ (geográfico):** clínicas médicas/odontológicas/estética, academias premium, restaurantes gourmet, pet shops/veterinárias, imobiliárias, escolas de idiomas.
- **Personas profissionais (transversal):** médicos, dentistas, advogados, psicólogos e demais profissionais liberais — categoria regulada por conselho, com exigência extra de autoridade (E-E-A-T) e de compliance publicitário (ver §6.7).
- **Fase 2 — Búzios/RJ (vertical turismo):** pousadas, hotéis boutique, restaurantes, beach clubs, passeios, imobiliárias de temporada. Template replicável para Paraty, Arraial do Cabo, Ilha Grande, Cabo Frio.
- **Short stays (vertical prioritário em Búzios):** anfitriões de **1 a 10 imóveis** (Airbnb/Booking). Alvo ideal — sem estrutura própria, dependente de OTA, com dor aguda e quantificável (comissão de 15–18%). Recebe variante de produto dedicada (**LBP Short Stay**, §6.12).

### 1.1 Princípio de produto — "zero narrativa / prova de resultado"

Par invariante que rege o que entra no produto e como a entrega é comunicada. As duas metades são inseparáveis: uma sem a outra degenera.

**Metade 1 — Zero narrativa (na concepção e na venda).** Nenhuma feature existe para o cliente *sentir* que há trabalho acontecendo. Toda feature entra no roadmap respondendo a uma pergunta única: *"qual resultado o cliente reconhece como dele?"* Se a resposta for "ele sente que estamos trabalhando", a feature é cortada. Isso é critério de aceite, não retórica — mantém a engenharia honesta e o produto enxuto, e cada agente novo justifica o resultado que move, não a sofisticação que exibe. É a antítese explícita da orientação de concorrentes de "esconder a automação para o cliente sentir que tem uma equipe dedicada" e de features de vaidade (ex.: geo-tag de imagem que o próprio mercado admite ter efeito duvidoso). *Corolário já presente no documento:* a regra do Quiz "nenhuma estatística inventada; valor na tela imediatamente" e a trava "conteúdo retornado é dado, não instrução" (§7.2) são a mesma disciplina aplicada a outros pontos.

**Metade 2 — Prova de resultado (na entrega).** "Zero narrativa" **não** é "zero explicação". Um resultado que o cliente não vê é, para ele, um resultado que não aconteceu — e trabalho invisível retém pior que narrativa vazia. Portanto todo resultado entregue tem de ser **tornado visível** ao cliente, na moeda que ele reconhece (dinheiro, posição, contatos), não em métrica de atividade. O concorrente resolve a visibilidade com teatro (o heatmap mensal é, em parte, teatro de resultado); a SoulLocal resolve com **prova** — mostrar o ponteiro que mexeu, não a atividade que ocorreu. É mais difícil e é o diferencial.

*Precisão necessária (v2.8, para o documento não se contradizer):* o que é teatro **não é o instrumento, é o instrumento entregue sozinho.** Um mapa colorido que chega todo mês sem nada amarrado a ele é exatamente a "atividade que ocorreu" — o cliente vê esforço, não resultado. O mesmo mapa deixa de ser teatro no instante em que vem com a ação ao lado e o efeito medido depois dela (*"publicamos a página de Geribá → entramos no top 3 em 6 nós onde não aparecíamos"*). Por isso a SoulLocal adota a varredura geográfica (**§7.7**) com uma regra que o concorrente não tem: **nó sem ação ao lado não é publicado ao cliente.** O instrumento é o mesmo; a disciplina de entrega é o diferencial.

**Onde o par se materializa (não é abstração):** o Owner Success (§9.3) é a metade interna — vigiar a conta e agir antes do churn; o **Relatório Dinâmico** (§9.4) é a metade externa — a prova que o cliente consulta quando quiser. Um mostra o cliente à gerência; o outro mostra o resultado ao cliente. Ambos falam a mesma moeda do Raio-X que abriu a relação (dinheiro na mesa), fechando o loop na mesma língua em que começou.

**A honestidade que sustenta o princípio (o teste do mês 7):** um instrumento que só sabe mostrar vitória não é medição, é propaganda — e o cliente sente. A prova de resultado precisa saber dizer "este mês estabilizou, e aqui está o porquê" sem soar como desculpa (o **modo "mês plano"** da §9.4). Mostra o número quando sobe, mostra o número quando não sobe, e em ambos mostra o que está sendo feito. É essa versão que sobrevive à sazonalidade e à maturação natural do SEO local.

---

## 2. Contexto de Mercado 2026 (premissas validadas)

| Premissa | Situação em 2026 | Impacto no projeto |
|---|---|---|
| Cold outreach WhatsApp em massa | Alto risco: Meta penaliza mensagens sem resposta; contas com disparo em massa sofrem queda de qualidade e ban | Abordagem 1:1 consultiva, 20–50/dia, opt-out automatizado |
| LGPD para prospecção B2B | Permitida via legítimo interesse (Art. 10), com relevância + opt-out imediato (processamento < 48h) | Opt-out automatizado no fluxo; rodapé de compliance no relatório |
| Google Places API | Novo modelo por SKU (10k Essentials / 5k Pro grátis); campos rating/reviews em tiers até US$40/1000; usar "Places API (New)" | Orçar custo real por lead; coletar apenas campos essenciais |
| Scraping Instagram (público, sem login) | Defensável (Meta v. Bright Data); LGPD ainda se aplica no Brasil | Manter via Apify; documentar base legal e finalidade |
| Google Business Profile API | Ativa, dividida em 5 APIs especializadas; requisitos de aprovação inalterados | Pedido formal após carteira inicial de fichas gerenciadas |
| Busca local | Dominada por "frescor" do perfil + extração por IA (GBP alimenta respostas de ChatGPT/Gemini/AI Overviews) | GEO vira serviço vendável e seção do relatório |
| Publicidade de profissões reguladas | CFM, CRO, OAB e CRP mantêm normas próprias de publicidade (restrições a "antes e depois", promessa de resultado, sensacionalismo) | LBP nasce conservador nesses nichos; checklist por conselho (§6.7) |

---

## 3. Produto 1 — Raio-X Digital Competitivo (isca de aquisição)

### 3.1 Estrutura do documento

1. **Capa** — nome da empresa, subtítulo, data/local, **SoulLocal Score** (0–100, selo colorido vermelho/amarelo/verde) e identificação comprimida em faixa de rodapé.
2. **Achado principal (primeira dobra)** — a dor mais aguda em destaque, quantificada em dinheiro/cliente perdido, não em métrica.
3. **Diagnóstico Local** — posição no Local Pack; quem são os 3 primeiros (nome + números, **sem** links para o Maps dos concorrentes); **mapa de visibilidade 3×3 do próprio bairro** (§7.7) — a peça de maior impacto visual do relatório: o dono vê o próprio entorno em vermelho antes de ler qualquer número; oportunidade explícita.
4. **Presença no Instagram** — seguidores, última postagem, frequência, bio.
5. **Tabela comparativa (momento de maior impacto)** — Nota Google · Reviews · **% de reviews respondidos** · Seguidores · Última postagem — empresa vs. 3 concorrentes.
6. **Visibilidade em IA (diferencial 2026)** — "Sua empresa aparece quando alguém pergunta ao ChatGPT/Gemini 'melhor [categoria] em [bairro]'?" Teste real por lead (1 chamada LLM).
7. **Análise de reviews via LLM** — 3 temas de reclamação recorrentes extraídos dos reviews reais (prova de personalização genuína; cada tema aponta para uma automação vendável).
8. **Diagnóstico Operacional** — WhatsApp no site? Chatbot? Reservas online? Fotos recentes?
9. **Melhorias imediatas** — cada recomendação acompanhada do dado que a justifica na mesma linha (nunca genérica).
10. **CTA com loop aberto** — 1–2 insights deliberadamente fora do relatório: "Quer ver os outros pontos que encontramos? Responda no WhatsApp." + QR Code + prazo ("automação ativa em 48h").
11. **Rodapé LGPD** — "Relatório gerado a partir de dados públicos. Não deseja contato? Responda SAIR."

### 3.1A Enriquecimento por CNPJ (BrasilAPI) — bastidor de qualificação, não conteúdo do relatório

**Achado (validação do repositório PROSPECTOR-DE-SITES):** a **BrasilAPI** (consulta pública, gratuita, por CNPJ) entrega data de abertura, porte (MEI/ME/LTDA), CNAE, situação cadastral e nome dos sócios.

**Onde entra no pipeline:** novo nó **entre a coleta** (Places/SerpApi/Apify/DataForSEO) **e o LLM** — parte da Fase 1 do motor do Raio-X.

**Três usos (todos internos, pré-abordagem):**
1. **Filtro de qualificação pré-abordagem** — porte pagante antes de gastar mensagem/tempo de contato.
2. **Personalização da abordagem** — nome do sócio no primeiro contato.
3. **Reforço da base legal LGPD** — dado cadastral público de PJ, finalidade B2B documentada (mesmo espírito do §7 Compliance).

**Ranking de priorização (o que a qualificação alimenta):** **nota alta + presença fraca + porte CNPJ = topo da fila** de abordagem — combina sinal de qualidade do negócio (nota), oportunidade (presença fraca) e capacidade de pagar (porte).

**Regra de exposição (importante — separar bastidor de relatório):** o dado do CNPJ serve à **qualificação e abordagem interna**, não ao conteúdo que o lead vê. O PDF/página mostra dados de *presença* (Google, Instagram, concorrentes, reviews); **porte e sócios ficam no bastidor**. Expor "sabemos quem são seus sócios" no relatório soaria vigilância, não diagnóstico — quebraria o tom consultivo do Raio-X.

### 3.1B Tenant Fantasma (páginas de prospecção que nascem sozinhas) — PILOTO CONTROLADO

**Conceito:** mesma mecânica de "assumir empresa" do Google/Facebook, aplicada ao ecossistema do grupo. A partir do dado já coletado (pesquisa própria + dados comprados de plataformas de geração de leads de Búzios + BrasilAPI, §3.1A), um comando gera uma **página pública pré-otimizada** para um negócio que ainda não é cliente, hospedada e com dado vivendo na **base própria do Begoo** (empresas do grupo com CNPJ e base separados — §0). **"Reivindicar" é uma migração real via API** — cria o tenant de verdade na base da SoulLocal a partir do dado do Begoo — não uma troca de status interna numa base compartilhada.

**Três CTAs por página:**
- "Essa empresa não tem Cartão de Visita Inteligente — solicitar agora" → funil CartãoPro.
- "Essa empresa é sua? Reivindicar agora" → formulário de leads → funil LBP/assinatura.
- "Essa empresa ainda não tem avaliação — avaliar agora" (popup TrueBz) → resolve a massa crítica do TrueBz sem depender de adesão prévia (cobre o mercado todo, não só carteira de clientes — condição de neutralidade para a estrelinha de terceiro genuíno).

**Escala potencial e o risco identificado:** Búzios tem ~8 mil empresas (última consulta); a ~2.000 páginas/mês, fecharia o mercado em ~5 meses. Base legal (dado público, legítimo interesse B2B) não muda com o volume — mas **o risco não é legal, é de política do Google:** geração de página em massa, com baixa curadoria individual e alto volume, se enquadra no que o Google nomeia como **"scaled content abuse"** — risco de penalização/desindexação do **domínio inteiro** (incluindo os LBPs de clientes pagantes, se hospedados no mesmo domínio). Some-se o risco reputacional de reação negativa de donos não avisados, em volume.

**Decisão: piloto controlado antes de escalar (não lançamento em massa).**
1. **Lote piloto pequeno** (não os 2.000/mês completos), priorizado pelo ranking de §3.1A (nota alta + presença fraca + porte).
2. **Enriquecer com outras fontes** (BrasilAPI + dados comprados + coleta própria) para elevar a curadoria por página, evitando concatenação idêntica de campos.
3. **Domínio e empresa separados — estrutura definida na v2.6:** `begoo.guide` (portal de busca na raiz) + `begoo.guide/{cidade}/{negocio}` (ficha), na base própria do **Begoo** (CNPJ e infraestrutura distintos da SoulLocal — §0). Isola o risco de spam do Google longe da autoridade dos LBPs pagantes — e, por serem empresas de fato distintas, o isolamento é estrutural, não apenas escolha de subpasta. *(Substitui `business.begoo.com.br/{nome-da-empresa}` das versões anteriores. Sobreposição de escopo entre Begoo e TrueBz ainda a esclarecer — §14.)*

   **Por que esta estrutura, e não subdomínio por negócio:**
   - **Portal na raiz + fichas em subpasta = consolidação.** O buscador herda o peso das milhares de fichas e é *ele* que ranqueia para "padaria em Búzios". Subdomínio por negócio criaria milhares de sites com autoridade zero cada, sem alimentar o hub — e geração em massa de subdomínio é, historicamente, assinatura de spam. *(O Google declara tratar subdomínio e subpasta de forma semelhante; o argumento aqui é de consolidação prática, não de penalização declarada.)*
   - **Cidade em subpasta = replicabilidade.** Paraty, Arraial, Ilha Grande e Cabo Frio (§11, Fase 5) nascem apoiados na autoridade que Búzios já acumulou, em vez de recomeçar do zero a cada domínio novo.
   - **Subdomínio pertence à outra camada.** O padrão de subdomínio/domínio próprio é do **produto pago** (§7.3), onde identidade e isolamento por cliente são desejáveis. Aplicá-lo ao diretório inverte a lógica.
   - **`.guide` é semanticamente honesto** — é literalmente um guia, o que reforça a tese de utilidade contra o enquadramento de *scaled content abuse*.

4. **Uma página por não-cliente — sem subpáginas de produto/serviço.** A ficha fantasma é **uma única URL**, com dado verificável de fonte pública (NAP, categoria, horário, nota, avaliações). **Nunca** gerar subpáginas do tipo `/{negocio}/{produto}`. Três razões:
   - **Escala do risco:** subpáginas multiplicariam ~8 mil páginas por 4–6, mudando a ordem de grandeza do risco dimensionado nesta seção.
   - **Regra de ouro (§5.5):** dado de produto não vem de forma confiável das fontes públicas; seria conteúdo inferido publicado sobre quem **não é cliente e não tem como corrigir**. "Conteúdo local errado não é errinho de SEO, é propaganda enganosa" — e vale ainda mais para não-cliente.
   - **Não entregar de graça o que se vende:** a árvore de ~14 URLs é o que aparece quando ele assina (§6). Se a ficha fantasma já tiver estrutura de subpáginas, a reivindicação perde o salto de valor.

5. **301 na reivindicação (obrigatório).** Ao reivindicar, o negócio passaria a ter duas URLs — a ficha fantasma e o LBP — que duplicam e competem entre si. A ficha fantasma faz **301 permanente para o destino do cliente** (§7.3), e a entrada permanece no **buscador e no índice da cidade**, apontando para fora. O guia não esvazia: o que sai é a ficha duplicada, o que fica é a listagem que o mantém completo.
   **Vira argumento de venda:** *"sua página no guia já está indexada há meses e já tem histórico no Google — quando você assume, esse histórico passa para o seu endereço."* (Redirecionamento a partir de subpasta é limpo; encerrar milhares de subdomínios deixaria DNS órfão em escala — mais um motivo para o item 3.)
6. **Acompanhar o retorno** (conversão nos 3 CTAs, reação/reclamação, comportamento de indexação do Google) antes de decidir escalar.
7. **Critério de decisão:** retorno **positivo** → segue e escala em lotes sucessivos; retorno **negativo** → mantém o **fluxo de prospecção original** (WhatsApp consultivo 1:1, §4) como estava planejado — o tenant fantasma não é substituto do funil existente, é um experimento paralelo com plano B garantido.

### 3.1C Interface do portal — v1 exploratória (Lista / Mia / Mapa)

> **Nota de tom, para quem ler depois:** esta seção é registrada de propósito com menos rigor que o resto do documento. O `begoo.guide` está em fase de descoberta — braço da agência, alimentado pelo que a prospecção já gera, sem precisar da arquitetura de escopo/governança que o resto do documento exige do produto pago. É anotação de direção, não especificação travada.

**Três formas de entrada, uma leitura de dado só.** Lista, Mia e Mapa não são três buscas — são três jeitos de ler o mesmo filtro (localização, categoria, atributos, data/hora quando a categoria tiver). A Mia é quem traduz texto livre para esse filtro quando o usuário escreve em vez de preencher campo.

**Modelo de referência: Google Travel Hotels.** Não é três abas paralelas — é uma faixa curta de destaques na entrada, e um **"ver tudo"** que abre a experiência completa, onde **Lista e Mapa são a mesma tela** (lado a lado, ou mapa como alternância no mobile), lendo o mesmo resultado. Passar o cursor num card destaca o pino correspondente. A Mia continua como peça separada, plugada por cima quando estiver pronta — v1 pode nascer só com busca de texto simples (categoria + bairro), sem IA nenhuma.

**Card, em qualquer view, é sempre o mesmo componente: "Ver detalhes".** Nada de botão que muda por categoria de negócio — evita erro de categorização e mantém uma coisa só para manter. A ação real (reservar, agendar, salvar contato, WhatsApp) mora na página do negócio, que já tem isso especificado.

**Confirmação vinda de uma URL real da Booking, analisada em sessão:** o formato de parâmetro (`checkin`/`checkout`/`group_adults`) bate com o que a §3 do documento companheiro já especifica — sai de hipótese para confirmado. A mesma URL trazia telemetria de metasearch pago (`utm_source=metagha`, `gclid`, `aid`+`label` de afiliado): o modelo de interface copiado é, por baixo, um leilão de posição. Guardado como munição para quando a regra de ordenação da Lista/Mapa for escrita a sério — **não aplicado agora**, por decisão explícita desta fase.

**Schema v1 — o mínimo para a tela existir:**

```
negocio: nome, categoria, bairro, coordenadas, telefone/whatsapp, foto, nota
```

Sem `attributes` sofisticado, sem dimensão de escopo, sem disponibilidade dinâmica — isso é fase 2, quando o Hostse estiver plugado (mesma dependência já registrada no documento companheiro, §1.9). Hospedagem entra na mesma tabela, com dois campos a mais quando existirem (preço/noite, link externo de reserva).

**De onde vem o dado, em v1:** o que a prospecção da agência já gera — Places, CNPJ, DataForSEO, quiz, Raio-X — vira entrada de diretório automaticamente. Não há coleta nova a fazer; é o mesmo dado que já se levanta para vender, reaproveitado para popular o portal.

**O que fica para quando o portal deixar de ser exploratório:** vocabulário controlado de comodidades (alimenta o filtro de atributos, §6.12 — a especificar), regra de ordenação sem posição paga (eco da T1, §1.10 do documento companheiro), URL canônica do resultado (com ou sem categoria no caminho — a decidir, ver §3.1B), e a decisão entre Lista/Mapa tratando "consta" como padrão para a maioria das categorias e exceção só em hospedagem (§1.6 do documento companheiro).

### 3.2 Formato de entrega
- **Primário:** página web personalizada (`soullocal.com.br/relatorio/{slug}`) — mede abertura (sinal para follow-up da Mia), evita atrito de anexo, botão WhatsApp clicável.
- **Secundário:** PDF para download/impressão dentro da página.

### 3.3 Variante Búzios (vertical turismo)
- Gancho central: **comissão de OTA** ("R$ X/ano pagos ao Booking em reservas que poderiam ser diretas").
- Métricas adicionais: nota/posição no **TripAdvisor**; tempo de resposta a mensagens; reviews em espanhol/inglês respondidos ou ignorados.
- Visibilidade em IA em contexto de viagem ("melhor pousada pé na areia em Búzios" no ChatGPT).

---

## 4. Motor de Aquisição — WhatsApp Consultivo

### 4.1 Regras operacionais
- Volume: **20–50 abordagens/dia**, mensagens individuais personalizadas (nunca template de massa via API para frios).
- Toda mensagem termina com **gancho de resposta** (pergunta) — resposta do lead zera o contador de "sem resposta" da Meta e abre a janela de conversa.
- Follow-up em **até 1 hora** após resposta positiva (maior alavanca do funil; automatizado pela Mia).
- Opt-out: palavra "SAIR" → tag automática + remoção do fluxo em < 48h (registro em Supabase para auditoria LGPD).
- Nutrição de não-convertidos: Raio-X atualizado trimestral (60% das vendas ocorrem após 5+ contatos).

### 4.2 Mensagem pós-envio (modelo)
> "Enviei o relatório! Dá uma olhada na página 3 — tem um dado sobre seus concorrentes que acho que você ainda não viu. Me conta o que achou?"

### 4.3 Funil de conversão de referência (por 100 leads raspados)

| Etapa | Conservador | Realista | Otimista |
|---|---|---|---|
| WhatsApp válido | 70 | 75 | 80 |
| Respondem | 7 (10%) | 13 (18%) | 24 (30%) |
| Conversa qualificada | 2,5 | 5 | 12 |
| Demo/reunião | 0,7 | 2 | 6 |
| **Clientes** | **0,2** | **0,6** | **2** |

**Conversão lead→cliente: 0,5%–2% (planejar por ~1%).** Com 600 abordagens/mês: 1–4 clientes novos/mês (Tijuca). Primeiros 3 meses = calibração instrumentada (A/B de abertura, taxa por nicho/horário, tudo registrado no Supabase).

### 4.4 Estratégia Búzios (mercado pequeno)
- Estoque total: ~300–600 negócios → **não** aplicar volume; penetração por reputação.
- 10–15 negócios âncora → fechar 3–5 → indicação orgânica (funil por indicação: 10%+).
- Canal institucional: associações locais (ex.: Búzios Convention & Visitors Bureau) — **tratar pelo desenho de canal de indução (§9.2.1)**, não como contato avulso: pauta coletiva de reserva direta, entrega em lote com cadência negociada.
- Janelas de venda: **mar–jun** e **ago–out** (nunca dez–fev). Visita presencial para fechar âncoras.
- Upsell de **exclusividade por categoria** (mercado pequeno torna a escassez real).

### 4.5 Quiz de Captação (motor inbound)

Par inbound do Raio-X (outbound). Especificação completa no **documento próprio "Quiz de Captação de Leads"**; aqui, o papel no funil:

- **O que é:** avaliação online (mini-Raio-X interativo) que entrega valor na tela na hora (nota, faixa, "dinheiro na mesa") **antes** de qualquer pedido de reunião. Responde o comerciante/anfitrião (o lead da SoulLocal).
- **Onde vive:** landing pública no site da SoulLocal + embeds nos portais geográficos.
- **Por que existe (o que o outbound não tem):** custo por lead qualificado menor (o pipeline caro só roda para quem se auto-identificou); zero risco Meta (lead que pede resultado no WhatsApp inicia a conversa); qualificação embutida (orçamento implícito + objetivo + obstáculo antes da 1ª conversa humana).
- **Roteamento por qualificação:** quente → agendar + Mia < 1h · morno → dispara pipeline do Raio-X · frio → PDF "7 ajustes" + nutrição.
- **É a espinha de conversão do site:** todo botão "descubra sua nota" das páginas aponta para o quiz — hub onde tráfego (busca, IA, ads, portais) vira lead roteado.
- **Derivação short stay (prioritária):** preset `short-stay-buzios` com a tradução financeira calculada sobre a **comissão de OTA** (diária × noites × %) — o gancho mais afiado do quiz. Ver §6.12.
- **Marca:** resolvida — **SoulLocal** é o nome da agência (afeta domínio `soullocal.com.br`, e-mails e nome do score — SoulLocal Score).

---

## 5. Produto 2 — Serviços Recorrentes (entrega)

### 5.1 Gestão de Google Business Profile
- Posts, fotos, horários, atributos (algoritmo de "frescor" exige recorrência).
- Resposta a 100% dos reviews (manual+IA); pedido automático de review pós-serviço com follow-up.
- Consistência NAP; otimização para extração por IA (o GBP alimenta respostas de LLMs).

**Onboarding de acesso — dois fluxos:**
- **Fluxo A (manual, fase inicial):** proprietário principal adiciona e-mail corporativo da SoulLocal (ex.: fichas@soullocal.com.br) como **Gerente** em Perfil → Pessoas e acesso. Vídeo de 60s no onboarding. Atenção: carência de 7 dias para novos gerentes; verificar quem é de fato o proprietário da ficha.
- **Fluxo B (OAuth via Business Profile API, fase SaaS):** pré-requisito de aprovação formal do Google (projeto GCP, site, política de privacidade, uso declarado). Botão "Conectar com Google" → escopo `business.manage` → armazenar refresh token → listar locations → vincular ao dashboard. Cliente pode revogar a qualquer momento.
- **Sequência:** 5–10 clientes no Fluxo A (gera histórico que fortalece o pedido de API) → depois Fluxo B.

### 5.1A Política de Reviews — regras inegociáveis e divisão de responsabilidade

**Status: regra do policy engine (§5.5), não recomendação.** O agente não contorna; não existe configuração que ligue o comportamento proibido. Vale para o canal principal de solicitação (**WhatsApp**), para QR/link impresso e para qualquer automação futura.

#### As três regras

**R1 — Mesmo pedido para todos, sempre.** O convite dispara para **todo** cliente atendido, pelo mesmo caminho, independentemente de satisfação presumida ou declarada. **Proibido qualquer pré-filtro**, humano ou automático. A política do Google veda "desencorajar ou proibir avaliações negativas, ou solicitar seletivamente avaliações positivas" — e não distingue automação de conversa 1:1 no WhatsApp.

**R2 — Nunca sugerir conteúdo.** Proibido induzir palavra-chave, menção a serviço, nome de profissional ou qualquer texto específico. A política é explícita: o comerciante não deve solicitar que conteúdo específico seja incluído. *(Concorrentes vendem "avaliações com palavras-chave dentro" como diferencial proprietário — é violação direta, sem zona cinzenta. Não replicar.)*

**R3 — Nenhum roteamento condicional. Nem como opção desligada por padrão.** Proibido construir a mecânica de "nota baixa vai para formulário interno / nota alta vai para o Google", ainda que com botão de escape para o Google. Feature que existe é feature que alguém liga — e, em white-label, quem configura é a SoulLocal, não o cliente final: a responsabilidade pela violação seria nossa, com a ficha do comerciante como colateral.

#### Desenho que resolve o desconforto (o "porquê" da R1)

A tensão prática é real: nenhum comerciante manda link espontaneamente para quem acabou de reclamar. **O gating não nasce do skip — nasce de perguntar antes.** Solução de arquitetura, não de disciplina:

> **O pedido dispara automático (ex.: 24h pós-atendimento), sem pergunta prévia de satisfação.** Sem o sinal na mão, não há o que filtrar: *compliant por construção*, e sem nenhum momento constrangedor.

Se houver conversa antes, o link vai **nos dois casos** — muda o tom, não o envio. Cliente que reclamou, foi ouvido e teve o problema resolvido costuma escrever a avaliação mais persuasiva que existe.

#### Por que o gating também é má estratégia (independe da regra)

- **A premissa é falsa.** "Gostei" não prediz estrela. Há quem reserve 5 para o excepcional e dê 4 para o ótimo; há quem dê 5 por educação. O filtro produz **falso positivo** (elogiou, deu 3 — não protegeu nada) e **falso negativo** (foi contido, daria 5 — perdeu-se uma avaliação boa). O segundo custa dinheiro e é invisível.
- **Filtrar reduz volume, e volume é a defesa.** Com 30 avaliações, uma nota 1 derruba a média; com 300, some no ruído. **O gating não protege a nota — torna a nota frágil.**
- **5,0 perfeito não é prêmio.** Nota perfeita com volume alto lê como fabricada, para o consumidor e para os sistemas antispam. Faixa alta com alguma variação converte melhor.
- **O rastro é estatístico, não conversacional.** O Google não lê o WhatsApp — mas ficha com volume alto e **ausência de cauda** é o padrão que a detecção procura. E a varredura, quando vem, derruba avaliações legítimas junto.
- **Risco recíproco de reputação (decisivo para a agência).** Sugerir atalho que leva o cliente a penalização volta como avaliação de meia estrela **na ficha da SoulLocal** — de um comerciante que perdeu anos de reviews por conselho nosso. Uma agência que vende reputação não pode ser a causa da destruição da reputação alheia.

#### Divisão de responsabilidade (o discurso de venda)

**"A estrela é sua; o resto é nosso."** Formulação honesta que não abandona o cliente com a parte difícil nem promete o que não se entrega:

| Do comerciante | Da SoulLocal |
|---|---|
| A experiência: atender bem, cumprir prazo, resolver problema | **Volume:** pedido a todo cliente, sempre, no momento certo |
| — | **Resposta a 100% das avaliações** (§5.1) |
| — | **Diagnóstico de sentimento** (abaixo) |
| — | **Alerta quando o padrão vira** |

⚠️ **Não usar a versão "você que lute".** Se a nota é 100% trabalho dele, o comerciante pergunta — com razão — o que está pagando. E seria falso: o volume, a resposta e a leitura de padrão são entrega real.

**Isto é filtro de cliente, e deve ser dito ANTES da venda.** O comerciante que quer *comprar* reputação em vez de merecê-la vai se incomodar e não fechar — e é exatamente o perfil que daria churn no mês 4 culpando a SoulLocal por uma nota que o serviço dele não sustenta. Dito antes, é contrato de expectativa; dito depois, vira desculpa.

#### Diagnóstico de sentimento — a entrega que substitui o atalho

É o que torna "a estrela é sua" compatível com "a gente faz você subir": **a SoulLocal não dá a estrela — mostra onde ela está vazando.** O comerciante não lê 200 avaliações nem enxerga padrão; o motor lê. Reutiliza a análise de reviews por LLM já existente no Raio-X (§3), agora aplicada de forma contínua ao cliente.

> **Exemplo do formato de saída:** *"Nas suas avaliações de 3 estrelas, 'demora' aparece em 8 das 12. Não é o produto — é o tempo de espera no sábado."*

Não é relatório: é **diagnóstico operacional acionável** que ele não conseguiria produzir sozinho, e que aponta para uma mudança concreta na operação. Encaixa direto na **camada 2 do Relatório Dinâmico** (§9.4 — ação amarrada a efeito): *"você ajustou a escala de sábado → reclamação de demora caiu de 8 para 2 → nota subiu de 4,3 para 4,6"*.

**Coerência com §1.1:** nota 5,0 fabricada por filtro é narrativa. Uma 4,6 com críticas bem respondidas e causas-raiz corrigidas é prova de resultado.

#### Nota de compliance (sinal de atenção, não orientação jurídica)

A regra da FTC de 2024 sobre supressão de avaliações é jurisdição americana e não alcança a operação brasileira. O ângulo local é o **CDC** (filtrar publicamente o descontentamento tem leitura possível como informação enganosa) e, em nicho de conselho, soma-se o risco de publicidade irregular (§6.7). Confirmar com o jurídico antes de desenhar o fluxo — mesmo padrão de cautela já usado para OTA e LGPD.

### 5.2 Mia — Agente IA white-label (multicanal: Widget + WhatsApp + Instagram)

**Princípio: um cérebro, N canais.** A Mia é um agente único (n8n AI Agent + tool `buscar_fatos` → tabela `facts`) conectado a múltiplas inboxes do Chatwoot. Adicionar canal não duplica lógica.

**Canais:**
- **Widget de chat no site (canal próprio — prioridade estratégica):** inbox "Website" do Chatwoot embutida nas páginas do LBP e no site do cliente. Único canal 100% sob controle da SoulLocal: sem custo por conversa, sem template aprovado, sem janela de 24h, sem risco de quality rating.
- **WhatsApp:** via API oficial (BSP), para conversas iniciadas pelo cliente (inbound) e follow-up opt-in.
- **Instagram DM:** via inbox Chatwoot.

**Vantagens específicas do widget:**
1. Custo zero por conversa; abertura proativa contextual sem custo Meta.
2. Contexto de navegação: o SDR sabe em que página o visitante está e abre a conversa de forma específica (ex.: página "Automação para clínicas na Tijuca" → abordagem para donos de clínica).
3. Captura no pico de intenção: converte o tráfego vindo de busca tradicional e de citações em IA no momento mais quente, sem troca de app.
4. **Ponte widget → WhatsApp opt-in:** o SDR qualifica no widget e pede o WhatsApp para continuar. A conversa no WhatsApp nasce inbound (iniciada pelo cliente) — cenário sem risco junto à Meta. O widget transforma tráfego frio em conversa WhatsApp legítima.

**Fluxo SDR no widget:**
`Visitante → abertura contextual (após X s na página) → qualificação (máx. 4 perguntas) → momento de valor ("quer o diagnóstico gratuito da sua empresa?") → captura nome + WhatsApp/e-mail → handoff humano ou continuação no WhatsApp (opt-in) → registro em Supabase (leads)`

O Raio-X funciona também como isca inbound: oferecido pelo SDR no widget em troca do contato.

**Funcionalidades gerais:**
- Atendimento 24h com base de conhecimento por tenant (ver §7.2).
- Qualificação de leads (máx. 4 perguntas), agendamento, FAQ, handoff humano (regra: intenção de compra qualificada ou frustração detectada → transferir para atendente no Chatwoot; fora do horário → capturar contato + retorno via WhatsApp pela Mia).
- **Versão Búzios: trilíngue (PT/ES/EN)** — no widget é ainda mais decisivo: turista estrangeiro conversa e reserva direto no site de madrugada, sem OTA. O widget é o interceptador de reserva direta.
- Prompt enxuto (persona + regras); conhecimento vem da API de fatos → atualização sem redeploy.
- **Blindagem prompt-injection:** conteúdo da base tratado como dado, nunca como instrução.
- **Anti-abuso no widget (dia 1):** rate limit por sessão/IP, detecção de flood, teto de mensagens por conversa (widget público expõe custo de LLM).
- **Multi-tenant no widget:** o script carrega com o token da inbox do tenant; o SDR resolve `tenant_id` a partir da inbox (mesma lógica da resolução por hostname no middleware Next.js).

**BYO-LLM (chave do próprio comerciante) — decisão de arquitetura e economia:** a Mia e as automações do cliente rodam preferencialmente na **API de LLM do próprio comerciante** (chave dele, armazenada com segurança por tenant). Isso tira o maior custo variável dos livros da SoulLocal e o desloca para quem usa.
- **Fallback "sneak peek" como padrão:** como o comerciante local médio não sabe gerar uma chave de API, o produto funciona out-of-the-box em um **modelo genérico da SoulLocal (limitado/"sneak peek")**; o BYO-LLM é upgrade para quem quer capacidade plena ou consome muito.
- **Falha de chave:** se a chave do cliente falhar/expirar, o sistema cai no fallback genérico e **avisa o cliente para atualizar a API**.
- **Credenciais da SoulLocal separadas:** a LLM usada pela *própria SoulLocal* (geração do Raio-X, agente de conteúdo, teste de visibilidade em IA) roda nas **credenciais da SoulLocal, em bucket separado** — nunca misturada com a chave do cliente.

### 5.3 Dashboard SaaS (retenção)
- Histórico de relatórios e SoulLocal Score no tempo; comparativo de concorrentes; monitoramento de reputação (Google + redes); alertas de mudança de ranking; gestão de respostas a reviews; métricas da Mia (conversas, leads, tempo de resposta); métricas do LBP (cliques em salvar, trocas de contato, conversão — ver §6.9).

### 5.4 Motor de Frescor (o LBP como organismo vivo)

**Problema:** uma página estática é lida uma vez pela IA e pelo Google, indexada, e envelhece parada. O algoritmo local premia recorrência (perfil que muda = negócio vivo; congelado = negócio que parece fechado). A IA faz a mesma leitura: `verificado_em` recente é voto de confiança na hora de escolher quem citar. Informação fresca é informação confiável.

**Definição operacional de "vivo":** o campo `verificado_em` de cada fato sendo empurrado para frente continuamente, por **sinais reais**, não por edição manual. O LBP não é um guia — é um perfil que respira.

**Quatro batimentos (canalizar sinais que o negócio já gera para dentro de `facts` + GBP):**

1. **Reviews (o batimento mais forte).** Cada avaliação nova é conteúdo fresco, gerado pelo cliente do cliente, de graça. O motor de pedido automático pós-atendimento (§5.1) não serve só para melhorar a nota — bombeia frescor: review novo → resposta da equipe (mais texto fresco) → sinal de "lugar movimentado" para Google e IA.
2. **Posts no GBP + FAQ que respira.** A IA da SoulLocal transforma perguntas reais que chegam na Mia em novas entradas de FAQ e em posts. Toda pergunta de lead no widget vira matéria-prima de um fato novo — que atualiza site + GBP + GEO sem redeploy. O atendimento *vira* conteúdo.
3. **Fatos com data de validade (`perecivel`).** Preço, horário, "aberto agora", promoção da semana, disponibilidade de agenda. São os fatos que a IA mais cita (acionáveis) e os que mais envelhecem. Marcados no schema como perecíveis, entram em ciclo de reverificação — a IA cita com confiança e o lead chega com informação correta.
4. **Sinais externos.** Menção nova, foto nova, item de serviço adicionado — cada um empurra o `verificado_em`.

**O loop frescor ↔ WhatsApp (fecha a meta de manter o WhatsApp do lead movimentado):** o fato fresco não é só sinal técnico — é **isca de conversa**. Um fato perecível e recente dá à Mia um motivo para abrir a boca: `fato fresco (vaga na agenda) → IA cita com confiança porque é recente → lead chega ao LBP ou pergunta → Mia usa o mesmo fato como gancho ("tenho 15h livre na terça, quer que eu segure?") → captura → WhatsApp`. E o inverso roda: toda conversa vira FAQ nova, todo atendimento vira pedido de review, todo review vira frescor. **Loop auto-alimentado:** mais atendimento → mais frescor → mais citação → mais atendimento.

**Input vs. output (distinção importante):**
- **Manter vivo = input.** Empurrar frescor para dentro (reviews, posts, fatos, FAQ). É o que a SoulLocal *faz*.
- **Verificar GEO = output.** Medir se virou citação (o Gemini/ChatGPT passou a recomendar o cliente?). É o que a SoulLocal *checa* — contínuo, com ferramentas ainda amadurecendo (§6.11).

**Por que é assinatura e não venda única:** "vivo" custa esforço recorrente real (gerar posts, transformar perguntas em FAQ, disparar reviews, reverificar perecíveis). É exatamente o trabalho que o comerciante nunca faz sozinho — ele abre a loja e esquece a ficha. A SoulLocal é o batimento cardíaco terceirizado.

**Ajuste de schema:** `facts` ganha `perecivel` (boolean) e `revalidar_em` (data-alvo da próxima reverificação). Ver §7.2.

### 5.5 Agente de Conteúdo Autônomo (o LBP se atualiza)

**O que é:** um agente que planeja e redige atualizações do LBP a partir do calendário do comércio (datas, promoção da semana, novo serviço, calendário fiscal, feriados, sazonalidade de nicho), propõe FAQs novas e estrutura tudo em fato/post real. Possível porque, na arquitetura do LBP, **conteúdo é dado, não código** — o agente lê o que existe, decide o que falta e escreve de volta, sem tocar em programação e sem redeploy. O mesmo desenho que deixa a IA *ler* o LBP deixa a IA *manter* o LBP.

**Regra de ouro:** conteúdo local errado não é errinho de SEO — é cliente perdendo dinheiro (horário de feriado errado), propaganda enganosa (promoção inexistente) ou sanção de conselho (§6.7). A IA é ótima em *rascunhar* e péssima em *garantir fato*. Portanto o agente **nunca executa; só propõe.** A segurança é estrutural (por design), não procedural (por disciplina).

**Pipeline de governança — herança direta do CartãoPro (reuso, não adaptador).** O padrão do CartãoPro é genérico o bastante para receber atores externos; o que muda por integração é apenas **os endpoints e as regras do policy engine, que são por canal (CartãoPro, LBP) + vertical.** Fluxo:

1. **Tudo passa pelo MCP.** O agente não tem mão direta na base; só fala com o MCP. Não existe caminho agente→dado que não passe por aqui.
2. **Agente propõe, nunca executa.** Separação dura entre quem sugere e quem aplica.
3. **Proposta com ID de ponta a ponta.** Cada sugestão é rastreável do nascimento à execução (ou recusa) — auditoria nativa.
4. **Deny-by-default.** Nada acontece a menos que explicitamente permitido; o default é "não".
5. **Policy engine + regras inegociáveis, por canal + vertical.** A proposta é avaliada contra regras que o agente não contorna. **É aqui que o compliance de conselho da §6.7 vira código:** proposta para um dentista que fira norma do CRO é negada pelo motor — nem chega ao human gate. Vira argumento de venda: *"nosso sistema é estruturalmente incapaz de publicar fora da norma do seu conselho."* **As três regras de review (§5.1A — sem pré-filtro, sem sugestão de conteúdo, sem roteamento condicional) vivem aqui**, não na camada de preferências do cliente: são restrição de segurança, não configuração.
6. **Tudo certo → passa; ficou dúvida → human gate.** O humano não revisa tudo — só o que o motor não chancelou sozinho. Humano é exceção, não gargalo (revisar 5 sugestões prontas leva minutos; criá-las levaria horas).
7. **Executor finaliza.** Só depois de aprovado, um componente separado aplica na base (grava em `facts` → atualiza site + `.md` + GBP + GEO → entrega o fato fresco para a Mia usar como gancho).

**Ciclo de quatro tempos (rodando dentro do trilho acima):** `calendário de contexto (gatilho) → agente propõe → gate (policy engine / human) → executor publica`.

**Níveis de autonomia = configurações do policy engine (não modos paralelos):**
- **A — Sugere + human gate para tudo.** Mais seguro; padrão inicial.
- **B — Autonomia graduada por risco.** Baixo risco ("feliz Dia das Mães") flui mais solto; perecível ou regulado (horário, preço, nicho de conselho) sempre exige gate. Meio-termo maduro.
- **C — Cliente aprova pelo WhatsApp.** O agente manda a sugestão ao cliente ("semana que vem é feriado — publico horário especial? Responda SIM"). Aprovação do bolso; vira toque de relacionamento e sensação de comando (recurso premium Tier 3).
- **D — Calendário editorial pré-aprovado.** Cliente aprova o *plano do mês*; o agente executa cada item na data sem gate item a item. Corta aprovações repetitivas quando a operação amadurece.

Recomendação: começar em **A**, evoluir para **B**, ofertar **C** no Tier 3, adotar **D** com volume.

**Chamar humano nunca é erro do agente — mas há dois eventos diferentes sob o mesmo nome.** Autonomia não é "o agente faz o que quiser": é operar dentro do envelope de regras sem humano *a cada passo*. O guardrail não é o oposto da autonomia — é o que a torna possível. Consequência: quando o sistema convoca um humano, isso é comportamento correto por design, não falha. Mas convém distinguir dois casos que parecem iguais e pedem tratamento oposto:

- **Gate previsto** — o motor encontrou exatamente o que foi desenhado para encontrar (ex.: proposta para dentista que toca norma do CRO cai no gate de conselho). É o design **funcionando com sucesso**. Não gera trabalho; tratar isso como falha sabotaria o mecanismo (a equipe começaria a "otimizar" para reduzir gates e furaria a trava por vaidade de métrica).
- **Escalação imprevista** — o agente travou porque encontrou algo que *ninguém desenhou resposta*: um caso que não é nem "permitido" nem "proibido", só "não sei". Também **não é erro do agente** (ele acertou ao não adivinhar) — mas é **sinal de lacuna no livro de regras**. Não gera culpa; gera item de curadoria.

**O que se mede não é "quantas vezes o humano foi chamado" — é "quantas vezes foi chamado pelo mesmo motivo evitável".** Cada escalação imprevista *repetida* é uma regra faltando escrever; uma vez codificada, para de chamar humano. É exatamente esse fluxo (escalação repetida → nova regra) que alimenta a curadoria do livro de regras e permite a subida graduada de autonomia (A→B→D). Sem essa distinção, a métrica de human gate vira ou fonte de culpa (trata gate previsto como erro) ou fonte de complacência (ignora a escalação evitável). *Nota de arquitetura:* o painel que separa os dois tipos e conta a recorrência é o mesmo instrumento operacional que encolhe o gargalo de mão de obra do §9.2 — não é relatório, é ferramenta de trabalho.

**Calendário de contexto reaproveitável:** datas comerciais e sazonalidade de nicho servem a *todos* os clientes do segmento → construir como base compartilhada ("calendário por nicho") e sobrepor só o específico do cliente. Escala melhor que montar do zero por cliente.

**O que é herança vs. o que é novo (nota honesta):** o **pipeline** (MCP → policy engine → executor) é reuso direto do CartãoPro, já validado. O **livro de regras** do domínio LBP (o que é "baixo risco", o que cada conselho proíbe, o que é perecível) é novo e específico — trabalho de **curadoria**, não de engenharia. Motor pronto; regras a escrever.

**Status da camada de agente (validado — não reprojetar):** presets, configurações e integração com n8n **já foram exaustivamente validados** em operação. Os documentos tratam o agente como componente pronto; a documentação ponta a ponta (presets, configs, fluxos n8n) será anexada quando a equipe liberar o acesso, substituindo os placeholders de detalhe. O trabalho aberto é apenas integração e curadoria do livro de regras — não redesenho do agente.

**Posicionamento:** "seu perfil se atualiza sozinho com as datas do seu comércio, e você só aprova" é pitch que nenhum concorrente local tem — justifica Tier 3 e a assinatura de uma vez.

**Fonte única de política (invariante de arquitetura — não negociável).** As regras de negócio e compliance (conselhos profissionais, risco de conteúdo, perecibilidade, limites de autonomia) vivem em **um único policy engine**, externo aos orquestradores. Qualquer executor — pipeline próprio (n8n), control plane de operação não-código ou de código — **consulta essa fonte antes de agir**; nenhum mantém cópia própria de regra. Atualiza-se a regra uma vez e ela vale para toda a operação, em qualquer canal, por qualquer agente. Consequência estratégica: **orquestradores são intercambiáveis por design; a governança é o ativo que não se fragmenta e não se substitui** — o que preserva liberdade de trocar de ferramenta sem custo de governança.

**Control planes candidatos (avaliação, sem escolha comprometida).** Para tocar a *frota de agentes internos* da SoulLocal com equipe enxuta (um humano supervisiona muitos agentes, em vez de operar agente a agente), dois projetos open-source estão em avaliação, divididos por natureza do trabalho:
- **Paperclip** (MIT) — operações **não-código com vigilância AAA** (agente de conteúdo, SDR, aprovações de nicho regulado). Traz organograma, orçamento, gates de aprovação, versionamento e rollback, e isolamento multi-empresa — ecoa o padrão de governança já herdado do CartãoPro.
- **Multica** — trabalho de **código** (construção/manutenção da plataforma, blocos, ajustes de LBP), integrando agentes de código (Claude Code/Codex/Cursor).
- **Regra de fronteira:** a natureza da tarefa é definida pelo *artefato final*, não pelos passos — resultado de conteúdo/aprovação → Paperclip (que *convoca* o Multica quando precisa de código); um manda, o outro é ferramenta. Ambos **consultam a fonte única de política** acima; nenhum vira segundo dono de regra.
- **Cautela:** ambos são v0.x, novos e em movimento rápido → **pilotar, não migrar tudo**; o ganho só compensa quando o volume de agentes/clientes faz a supervisão manual doer. No dia 1, n8n + policy engine podem bastar.

---

## 6. Produto 3 — LBP (Perfil da Empresa Local / "Ficha Viva")

### 6.1 Conceito e posicionamento

O LBP é a **produtização** das páginas agent-first + gestão de GBP + Mia sob um nome único, de marca premium e reconhecível. É o principal entregável da assinatura (núcleo do Tier 2/3).

**Metáfora de venda (revista na v2.6 — ver §6.1A):** a ficha do Google é um **quarto alugado na casa do Google** — grátis, mas quem manda na decoração, nas regras e no que aparece é o Google, e todo concorrente tem uma igual. O LBP faz tudo o que a ficha faz, com cara premium, sob controle do cliente, e **ainda alimenta a casa do Google** (e a do ChatGPT, e a do Gemini).

⚠️ **Correção da v2.6:** a formulação anterior chamava o LBP de "casa própria do cliente". **Isso não sobrevive à pergunta óbvia — "e se eu parar de pagar?"** — porque o modelo é de assinatura: se as páginas somem no cancelamento, não era propriedade. Dizer "ativo próprio" num modelo de aluguel é a mesma promessa vazia que o documento critica nos concorrentes (§1.1, zero narrativa). A retórica correta está na §6.1A.

### 6.1A Eixo de venda — "aluga a ferramenta, o resultado é seu"

**Frase-guia:** *"você aluga a ferramenta; o resultado se acumula no que é seu."* Segura o mesmo peso persuasivo da versão anterior e não quebra sob a pergunta difícil.

**Separação honesta (usar na objeção, não esconder):**

| Fica com ele mesmo se cancelar | Para se ele cancelar |
|---|---|
| Ficha do Google otimizada + avaliações acumuladas (sempre foram dele) | Páginas do LBP |
| **Domínio** (registrado no CPF/CNPJ dele — §7.3) | Mia (atendimento 24h) |
| Contatos de clientes capturados | Manutenção do frescor |
| Histórico de busca construído no nome dele | Monitoramento e alertas |

**Os três argumentos que substituem "propriedade"** — nenhum exige alegar posse do site, e os três continuam verdadeiros num modelo de assinatura:

1. **De quem é o cliente (o mais afiado, imune à objeção).** O hóspede que reserva pela OTA é cliente da OTA — ela tem o e-mail, o histórico, e é ela quem manda a oferta no ano seguinte. O que reserva direto é dele. Isso não muda se ele cancelar amanhã: os contatos já capturados continuam com ele.
2. **Estrutura de custo (o mais quantificável — base do gancho de Búzios).** Comissão é percentual: cresce com o faturamento e nunca termina. Assinatura é fixa. Ele dobra a receita, a OTA dobra a mordida, o valor da SoulLocal continua o mesmo. Não alega posse nenhuma — é aritmética.
3. **Ponto comercial (o mais intuitivo).** *"Você aluga o ponto, mas a freguesia é sua. Se mudar de rua, o freguês te acha. No aplicativo, a freguesia é do aplicativo."*

**Consistência obrigatória:** todo material de venda (Raio-X, Quiz, site, scripts de WhatsApp) usa esta formulação. Material que prometa "ativo próprio"/"casa própria" contradiz a resposta que a equipe daria se o cliente perguntasse direto — e é exatamente o tipo de narrativa que a §1.1 proíbe.

**Regra crítica de posicionamento:** o LBP **não abandona a ficha do Google — a absorve**. O cliente continua com o GBP (a SoulLocal gerencia); ele passa a ser apenas uma das saídas de um ativo maior que o cliente controla. "Substituição" é no *modelo mental* do cliente, não na infraestrutura.

**Nome:** categoria = **LBP (Local Business Profile / Perfil da Empresa Local)**; nome comercial = **"Ficha Viva"** (contrasta com a ficha estática e grátis do Google). A estratégia de nomear a categoria replica o que o CartãoPro faz: transformar o produto em um gênero reconhecível.

### 6.2 Paridade + camada premium

**Regra de ouro:** iguala tudo o que a ficha do Google oferece e adiciona o que o Google não dá.

| Recurso | Ficha do Google | Ficha Viva (LBP) |
|---|---|---|
| NAP (nome/endereço/telefone), horários, categoria | ✅ | ✅ |
| Fotos, mapa, atributos | ✅ | ✅ |
| Avaliações e nota | ✅ (só exibe) | ✅ **+ 100% respondidas + pedido automático** |
| Posts/novidades, perguntas e respostas | ✅ | ✅ |
| Lista de serviços | ✅ | ✅ **+ página própria por serviço** |
| Propriedade e marca | ❌ (do Google, padronizada) | ✅ **endereço próprio, design premium, marca do cliente** |
| Citável por IA (GEO) | ❌ | ✅ **otimizada para ChatGPT/Gemini/AI Overviews** |
| Atendimento 24h | ❌ (mensagens fracas) | ✅ **Mia no widget + WhatsApp** |
| Frescor mantido | ❌ (dono não mexe) | ✅ **gestão recorrente pela SoulLocal** |
| Histórico + painel + concorrentes | ❌ | ✅ **dashboard** |
| Multilíngue (Búzios) | ❌ | ✅ **trilíngue PT/ES/EN** |
| Captura de lead do visitante | ❌ | ✅ **Troca de Contato (§6.8)** |

### 6.3 Mecânica de assinatura + âncora de valor

**Princípio:** um ativo pode ser vendido de uma vez; um serviço vivo, não. Se o cliente comprar o LBP à vista, leva o *site montado e otimizado* — mas a Mia respondendo, as avaliações gerenciadas, a ficha mantida fresca e o monitoramento de concorrentes **não cabem num pagamento único**, por serem recorrentes. Essa é a realidade do produto — e é ela que empurra o cliente racional para a assinatura.

- **Preço de compra à vista (âncora, não oferta a fechar): R$ 5.000–10.000.** Usado como referência de valor, não como venda que se busca converter.
- **Discurso:** *"Montar essa presença e ser dono dela custaria de R$ 5 a 10 mil. A gente não vende assim — ela vem incluída na sua assinatura, e a gente mantém ela viva pra você."*
- **Efeito:** a mensalidade deixa de ser comparada com "um site" (que o cliente estima em ~R$ 500) e passa a ser comparada com "um ativo de R$ 5–10k + gestão contínua". Remove a objeção da mensalidade: o cliente não paga aluguel de site — mantém vivo algo que, sozinho, apodrece.
- **Ancoragem final:** 1 paciente/reserva/cliente recuperado paga o mês.

### 6.4 Estrutura cravada da Home (ordem de blocos padrão)

A home responde quem/o quê/onde já na primeira dobra e aprofunda depois. Ordem fixa (esqueleto — igual para todos):

1. **Herói** — nome + especialidade + bairro/cidade em uma frase + botão **Agendar**. É a frase que a IA lê primeiro.
2. **Barra de confiança** — nota Google, nº de avaliações, anos de atuação, **registro profissional (CRM/CRO/OAB/CRP)** quando aplicável. Fatos com números = altamente citáveis.
3. **Serviços/especialidades** — resumo com links para as páginas de cada serviço.
4. **Sobre o profissional/negócio** — foto, formação, credenciais (autoridade / E-E-A-T).
5. **Como funciona / primeira consulta** — reduz atrito, responde à dúvida nº 1.
6. **Prova social** — depoimentos + avaliações reais.
7. **FAQ resumida** — 4–5 perguntas, com link para a página completa.
8. **Localização + área de atendimento + horários** — NAP consistente.
9. **Bloco de agendamento** — seção de agenda (§6.6).
10. **Rodapé** — dados estruturados, registro profissional, LGPD.

### 6.5 Conjunto de páginas cravado (padrão da assinatura)

O padrão são **9 tipos de URL**. Fecha "100% de SEO + GEO" sem inchar. Princípio: cada URL é uma **resposta inteira e citável** pela IA.

| Rota | Função | Inclusa na assinatura |
|---|---|---|
| `/` | Home (§6.4) | ✅ |
| `/sobre` | Autoridade / E-E-A-T (formação, credenciais, registro) | ✅ |
| `/servicos` | Hub que lista tudo e distribui link | ✅ |
| `/servicos/{serviço}` | 1 página por serviço-âncora (motor de escala, padrão superdev) | ✅ **até 4** |
| `/perguntas-frequentes` | FAQ própria (JSON-LD FAQPage) — a mais citada por IA | ✅ |
| `/avaliacoes` | Depoimentos + avaliações trabalhadas | ✅ |
| `/area-de-atendimento` | Bairros/cidades atendidos (combustível de GEO local) | ✅ |
| `/{intencao}` | 1 página por intenção de busca medida (§6.5A) — organizada pela **consulta**, não pelo catálogo | ✅ **até 2** |
| `/agendar` | Contato + agenda + mapa + WhatsApp/Mia | ✅ |

**Camada técnica invisível (embutida no padrão, igual para todos):** versão `.md` de cada página (para robôs de IA), `/llms.txt`, `sitemap.xml`, `robots.txt` liberando GPTBot/ClaudeBot/PerplexityBot/Google-Extended, e **JSON-LD por página** (LocalBusiness/tipo profissional + Service + FAQPage + BreadcrumbList, com `areaServed`, `aggregateRating` quando aplicável e `speakable`).

**Total:** Home + 7 páginas fixas + até 4 páginas de serviço + até 2 páginas de intenção = **~14 URLs**. Este é o pacote "Ficha Viva" da assinatura.

### 6.5A Tipologia de páginas — local, destino e intenção

Distinção que faltava ao conjunto da §6.5. Os 8 tipos originais respondem bem a **quem** e a **onde**; não respondem a **o quê** — e é aí que está o volume de busca.

| Tipo | Dono | Pergunta que responde | Onde vive | Exemplo |
|---|---|---|---|---|
| **Local** | Cliente | "Onde fica / quem é / o que oferece" | LBP do cliente | `/servicos/clareamento-dental` |
| **Destino** | **SoulLocal** | A decisão *anterior* à escolha do fornecedor | Portal (não é entregável de cliente) | "Onde ficar em Búzios" |
| **Intenção** | Cliente **ou** portal | "O quê" — a consulta como a pessoa digita | Depende do eixo (abaixo) | "Dentista que atende domingo na Tijuca" |

**A confusão a evitar:** `/servicos/{serviço}` se organiza pelo **catálogo do cliente**; a página de intenção se organiza pela **consulta do usuário**. "Clareamento dental" é o que ele vende. "Dentista que atende domingo na Tijuca" é o que a pessoa procura. São páginas diferentes e a segunda é a que capta.

**Nota sobre `/area-de-atendimento`:** uma única página listando bairros é a versão mais fraca possível de intenção geográfica e **não tem capacidade de absorver o output do geo-grid** — um parágrafo com dez nomes de bairro não é dez respostas citáveis. Ela permanece no conjunto como hub de `areaServed`; o trabalho geográfico de verdade migra para as páginas de intenção.

#### Princípio que governa os três tipos

> **A página não precisa ser completa sobre o inventário. Precisa ser completa sobre o lugar.**

É o que resolve o problema do anúncio disfarçado. Uma página cujas opções são, por acaso, exatamente os clientes que nos pagam não é resposta — é anúncio, o Google tem política para isso e a IA descarta a fonte. Mas o risco, formulado com precisão, **não é "só aparecem clientes"**: é **fingir que a lista é o mercado quando não é**.

A saída é mudar o eixo da completude. "Onde ficar em Geribá" se responde inteira com bairro, distâncias, ruído, praia com criança, o que muda entre alta e baixa — **sem um único imóvel na página**. As opções entram depois, com **escopo declarado**: são as que representamos, não um levantamento do mercado. Uma imobiliária lista só os imóveis dela e ninguém chama de enganoso, porque a moldura está declarada.

Isso vale para os três tipos e é especialmente restritivo no eixo geográfico da página de intenção, onde a tentação de listar é maior.

#### Onde vive a página de intenção

- **Intenção que só o cliente resolve** ("dentista que atende domingo na Tijuca", quando ele é o único que atende domingo) → **LBP do cliente**.
- **Intenção que exige comparação ou não pertence a ninguém** ("onde ficar em Geribá") → **portal**, com escopo declarado.

Critério: se a resposta legítima à consulta é "depende, veja as opções", ela não cabe na página de um único negócio.

#### Eixos de intenção e fonte do vocabulário

| Eixo | Fonte | Exemplo |
|---|---|---|
| Geográfico | **Geo-grid (§7.7)** | "casa de temporada em Geribá" |
| Característica | Vocabulário controlado de comodidades (§6.12 — a especificar) | "pousada com piscina aquecida" |
| Ocasião | Sazonalidade | "onde ficar no réveillon em Búzios" |
| Restrição | Perguntas recorrentes da Mia | "hospedagem que aceita pet" |

**Isto fecha o ciclo da §7.7.** O geo-grid produz o vocabulário geográfico e a regra manda não publicar nó sem ação ao lado; a página de intenção é onde essa ação materializa. Nó fraco em Geribá com demanda medida → página de intenção de Geribá → a varredura seguinte mede o efeito → o par (ação, delta) entra na camada 1 do Relatório Dinâmico (§9.4). A regra deixa de ser aspiracional.

#### Teto e travas (não negociáveis)

Página de intenção em volume é exatamente o **`scaled content abuse`** identificado na §3.1B — com o agravante de que lá o risco morava no domínio do Begoo e aqui moraria **no domínio do cliente pagante**.

- **Capada em 2 na assinatura.** Adicional é projeto pago (§6.10). Número calibrado no primeiro lote e revisável.
- **Curadoria individual obrigatória** — cada página passa pelo pipeline de governança (§5.5) com gate humano. Não há geração em lote.
- **Critério de existência é demanda medida**, nunca combinatória. Não se gera a matriz bairro × comodidade; gera-se o que o grid e a Mia apontaram.
- **Resposta inteira e citável.** Combinação de eixos que produz página magra vira bloco dentro de outra página, não URL nova.

#### Documento companheiro

Páginas de destino (posse, escopo declarado, camadas de dinamismo, papel da Mia no portal, travas, componente de reserva) e o detalhamento completo das páginas de intenção estão em **"Documento Técnico — Páginas de Destino e Páginas de Intenção v1.0"**. Este documento registra apenas o que impacta o produto LBP; o portal é ativo da SoulLocal e não entregável de cliente.

### 6.6 Seção de agenda (fixa, fornecedor plugável)

Crava-se **que existe** um bloco de agendamento e a página `/agendar`; o **que** o preenche varia conforme o que o cliente já usa.

- **Provedores aceitos via incorporação:** Calendly, Google (Agenda/Reservas), HubSpot Meetings, ou o software próprio da categoria (ex.: iClinic/Doctoralia para saúde).
- **Mia como ponte, não substituta:** o visitante que não quer clicar no calendário conversa com a Mia no widget, é qualificado, e ela entrega o link de agendamento ou faz handoff.
- **Fallback sempre:** sem provedor ou em caso de falha, o bloco vira "solicitar horário via WhatsApp" — nunca um beco sem saída.
- **Padrão:** a assinatura inclui **1 provedor de agenda integrado**. Provedor adicional ou integração com sistema clínico/jurídico específico → projeto pago.

### 6.7 Camada de profissionais regulados (médico, dentista, advogado, psicólogo)

Categoria que o Google trata com rigor extra (páginas que afetam "vida ou dinheiro" — YMYL). Muda dois pontos do padrão:

**1. Autoridade reforçada (E-E-A-T).** `/sobre` e a barra de confiança exigem credenciais reais e registro profissional visível. O JSON-LD usa o **tipo específico** (`Physician`, `Dentist`, `LegalService`, `Psychologist`/`MedicalBusiness` conforme o caso) em vez de negócio genérico — aumenta a chance de citação correta.

**2. Compliance publicitário de conselho (checklist obrigatório antes de publicar).** Publicidade médica, odontológica, advocatícia e de psicologia é regulada pelos respectivos conselhos (CFM, CRO, OAB, CRP), com restrições sobre "antes e depois", promessa/garantia de resultado, sensacionalismo de preço e concorrência. O LBP nasce **conservador** nesses nichos: melhor entregar dentro das regras do conselho do cliente do que um site bonito que o exponha a sanção. Vira, inclusive, argumento premium: *"a gente faz sua presença dentro das regras do seu conselho."* **Codificação:** essas regras entram como **regras inegociáveis no policy engine, por vertical** (§5.5) — proposta de conteúdo que as fira é barrada pelo motor antes do human gate, tornando a publicação fora da norma estruturalmente impossível.

> **Nota:** este item é sinal de alerta, não orientação jurídica. As resoluções vigentes de cada conselho devem ser verificadas por profissional habilitado antes de padronizar o checklist por categoria.

### 6.8 Sistema de design — três camadas (esqueleto / pele / assinatura)

O paradoxo a resolver: **reconhecível como LBP** (gênero) **e** único por cliente (marca) **ao mesmo tempo** — exatamente o que o CartãoPro já entrega (um card verde e um laranja são visivelmente o mesmo produto *e* de donos diferentes). A solução são três camadas empilhadas:

- **Esqueleto (fixo — é a assinatura do produto):** ordem dos blocos da home, estrutura de páginas, padrões de interação. Nunca muda entre clientes. É o "dá pra ver que é um LBP". Tecnicamente = blocos React fixos, na ordem fixa (padrão HugoBlox).
- **Pele (variável — é a marca do cliente):** cor, logo, foto, fonte. Única coisa que muda de um cliente para outro. É o "isso é MEU". Tecnicamente = tokens por tenant no Supabase.
- **Assinatura (fixa — é o DNA da SoulLocal):** 3–5 marcadores de design inconfundíveis que aparecem em *todo* cliente, independentemente da cor (ex.: foto circular no topo, fileira de três círculos Ligar/E-mail/WhatsApp, barra inferior fixa Contato/QR/Salvar/Compartilhar, crédito discreto). Fazem reconhecer não só "um site", mas "um site DA SUNSET".

**Erro a evitar:** tentar que a *pele* carregue a identidade do produto. A pele é do cliente; quem carrega a identidade do produto são o esqueleto + a assinatura.

**Onboarding de cliente novo = preencher só os tokens da pele.** Esqueleto e assinatura vêm de graça. É isto que faz escalar, manter premium e parecer único ao mesmo tempo.

#### Travas de premium (premium vem de restringir, não de liberar)

1. **Paleta — o cliente escolhe a semente, não a paleta.** O cliente informa até 3 cores-semente; o sistema gera o JSON completo (escala e contraste por card). O cliente nunca digita a paleta inteira nem estraga o próprio site. **Motor existente — portado do CartãoPro** (já validado em produção); no LBP em Next.js, o JSON de paleta é mapeado para as variáveis de estilo que os blocos leem (idealmente cores em variáveis, nunca cravadas em cada card). *Esta é a trava mais importante — a peça mais difícil já está pronta e é herdada, não construída.*
2. **Fonte — cardápio curado.** 3–5 pares (título + corpo) profissionais e testados; o cliente escolhe *um par*, não "qualquer fonte".
3. **Foto — tratamento padronizado.** Corte, proporção e leve ajuste iguais para todos; o esqueleto define *como* a foto aparece, o cliente só fornece o arquivo. Foto ruim é o que mais destrói o premium.
4. **Logo — regra de encaixe.** Posição e tamanho máximo definidos, para não quebrar o layout.

Premium aqui é **menos, e melhor**: espaçamento generoso, hierarquia clara, restrição de cores, boa foto — nunca "mais elementos".

**Herança do CartãoPro (base de componentes, não só produto ao lado):** além do motor de paleta, avaliar reaproveitar a barra inferior fixa, o "salvar/trocar contato", o bloco de mapa e demais componentes já validados, em vez de recriar.

### 6.9 Componente "Troca de Contato" (captura + vCard)

Evolução do "salvar contato" do CartãoPro (mão única → mão dupla). No LBP, o visitante quer salvar o contato do negócio → aparece um formulário curto → ele deixa nome + WhatsApp/e-mail → recebe o vCard. A captura vem **antes** da entrega; o visitante anônimo vira lead identificado no pico de interesse. É o **principal ponto de captura passiva** da ficha (24h, sem a Mia puxar conversa).

**Regra de ouro (não quebrar o premium):** o vCard **sai de qualquer jeito**, mesmo sem preenchimento. Caminho de escape sempre visível ("baixar direto" / "pular"). Quem preenche → vira lead + recebe o vCard; quem pula → recebe o vCard e registra-se ao menos o evento anônimo. Obrigar o preenchimento vira captura à força — mata o premium e afasta gente.

**Campos mínimos:** nome + (WhatsApp **ou** e-mail). Manter enxuto; cada campo extra derruba conversão.

**Métrica (instrumentação, §7.4):** registrar três eventos separados — (1) **cliques em salvar** (intenção total, inclui quem pulou); (2) **formulários preenchidos** (leads); (3) **taxa de conversão** entre os dois.

**Automação:** formulário preenchido → grava em `leads` (com `tenant_id` + origem `troca_contato`) → dispara fluxo no n8n → **Mia inicia follow-up**. Como o contato foi deixado voluntariamente, o primeiro WhatsApp nasce **opt-in/inbound** — cenário limpo com a Meta. É mais uma "ponte para WhatsApp legítimo", passiva.

**Compliance:** como agora se coleta dado do *visitante* (não só dado público do negócio), o formulário exige aviso de privacidade + consentimento ali mesmo (linha discreta: "ao trocar contato você concorda…"), dentro da LGPD desde o clique.

### 6.9A Analytics por URL (páginas de local e de intenção)

A instrumentação atual mede **componente** (§6.9: cliques em salvar, formulários, conversão) e **cliente** (§9.4, Relatório Dinâmico). Falta a camada do meio: **desempenho por URL**.

Num pacote de ~14 URLs com até 4 páginas de serviço e até 2 de intenção, saber **qual delas se paga e qual deve ser substituída** é decisão real de curadoria mensal — e hoje não temos o dado.

**Registrar por URL:** impressões, cliques, entradas orgânicas, e as ações da §6.9 e §6.4 atribuídas à página de origem (troca de contato, clique em agendar, abertura da Mia, clique em reservar via slug próprio).

**O que se faz com isso:**
- **Páginas de serviço (até 4):** a que não converte em dois ciclos entra na fila de substituição. O teto de 4 deixa de ser arbitrário e passa a ser rotativo.
- **Páginas de intenção (até 2):** o teto baixo só é defensável se as duas forem as certas. Sem medição por URL, "as certas" é palpite — e o critério de demanda medida da §6.5A perde a metade de trás.
- **Insumo do geo-grid:** página de intenção geográfica publicada por causa de um nó fraco precisa ser avaliada nas duas pontas — posição nos nós (§7.7) **e** conversão na própria página. Uma pode subir sem a outra.

**Distinção importante:** o Yext usa esse dado para **comparar locais** de uma mesma marca — irrelevante aqui, já que o cliente tem um. O valor para nós é **comparar páginas** dentro do mesmo cliente.

**Nota de honestidade (§1.1):** analytics por URL é instrumento interno de curadoria. No relatório do cliente, entra sob a mesma regra do geo-grid — número de página só aparece **acompanhado da decisão que ele gerou** ("a página de X não converteu em dois ciclos; substituímos por Y"). Métrica de página entregue solta é atividade que ocorreu, não ponteiro que mexeu.



- **Incluído na assinatura (igual para todos):** os ~14 URLs, 1 provedor de agenda, a Mia, o design premium por blocos, toda a camada agent-first, a pele self-service (paleta por semente, par de fonte, foto, logo), a Troca de Contato.
- **Projeto pago (âncora R$ 5–10k / preço sob projeto):** páginas de serviço além das 4 inclusas, **páginas de intenção além das 2 inclusas**, blog/conteúdo recorrente, integração com sistema clínico/jurídico específico, design fora do padrão de blocos (quebra do esqueleto), idiomas extras fora do trilíngue de Búzios, funcionalidades sob medida.

A trava técnica e a trava comercial são a **mesma linha**: mexer na *pele* é self-service incluído; mexer no *esqueleto* é projeto pago.

### 6.11 Conversão em GEO — o funil do zero-click

**Premissa a corrigir:** a visita ao site nunca foi o prêmio — o prêmio sempre foi a **ação** (ligação, WhatsApp, rota, agendamento, cliente na porta). No SEO tradicional o clique era só um degrau até a ação. Logo, o "zero-click" da IA só é problema para quem achava que o clique era o destino; para o negócio local, nunca foi.

**A recompensa do GEO é ser a resposta recomendada.** Aparecer quando alguém pergunta "melhor dentista na Tijuca" e a IA responde com o *seu* cliente é mais forte que ser o 1º do Google: não é uma lista onde a pessoa escolhe entre dez — é um **endosso**. É o boca-a-boca, automatizado e em escala. Para negócio local, ser o nome recomendado no momento da decisão vale mais que um clique frio, mesmo sem abertura do site.

**Como capturar o lead sem o clique — duas camadas da arquitetura:**
1. **A IA carrega a ação junto com a resposta.** WhatsApp, telefone, link de agenda e "aberto agora" são dados de primeira classe em `facts`/`.md`/JSON-LD. Quando a IA cita, cita com o botão de ação embutido — a pessoa liga/agenda dali. Zero-click, mas com captura.
2. **Recomendação respondível, transação não.** A IA diz "a Clínica X faz clareamento a partir de R$ Y"; ela **não** checa horário de terça nem fecha a avaliação. Isso empurra o próximo passo para o canal do cliente — a Mia no widget/WhatsApp. **A Mia é o ponto onde o lead agêntico é capturado.** "Site como API de fatos + canal conversacional" é a rede que pega o peixe que a IA trouxe.

**Cliente sem processo ativo — isto é o produto.** O GEO traz a recomendação; quem **captura** é a camada ativa que a SoulLocal instala e que o comerciante não tem sozinho: Mia 24h, Troca de Contato, ponte para WhatsApp, motor de reviews que puxa walk-in. GEO sem camada ativa é visibilidade que vaza; camada ativa sem GEO é rede sem peixe. O diferencial é entregar os dois juntos — resposta direta à objeção do "site bonitinho".

**Cronograma de expectativa (contrato de expectativa com o cliente):**

| Fase | Prazo | O que acontece |
|---|---|---|
| Presença + captura ativa | **Semana 1** | LBP no ar e otimizado; Mia, Troca de Contato e reviews gerando lead desde já (não dependem do GEO amadurecer) |
| Primeiras menções em IA | **2–6 semanas** | Marca aparece em respostas de IA; buscas pelo próprio nome; efeito imediato do schema/FAQ |
| Citação competitiva | **3–6 meses** | Passa a ser recomendado em "melhor [categoria] no [bairro]" |
| Autoridade + monitoramento | **Contínuo** | Consolidação; cenário de citação muda mês a mês → verificação contínua |

> **Cuidado de venda:** a promessa das 48h é sobre o LBP **no ar e otimizado**, não sobre resultado de GEO. Vender "em 48h apareço no Gemini" cria frustração garantida. A camada ativa **cobre o vão**: o cliente sente resultado na semana 1 (mais WhatsApp/agendamento) enquanto o GEO sobe por baixo como bônus composto.

**Vantagem do local/nicho:** o GEO é mais meritocrático que o SEO — a IA valoriza estrutura e expertise específica acima de autoridade de domínio. Um especialista local é citado mais facilmente que uma agência generalista grande; o dentista da Tijuca não briga com hospital nacional.

**Não pode parar:** desempenho de GEO cai se o esforço é pausado — o que é o próprio argumento da recorrência (mesma lógica do frescor, §5.4).

**Medição — KPIs de sentido para o comerciante (não métrica de GEO no vácuo):** o que fecha a conta do comerciante é o que ele sente: volume de WhatsApp/ligação, pergunta "como nos achou", crescimento de reviews. Do lado do dado interno, a **LLM Mentions API** (DataForSEO, §7.6) fornece a tendência de citação em IA — usada como sinal de progresso e comparação com concorrente, nunca como contagem exata (respostas de IA variam por sessão). Amarrar os KPIs do LBP nesses sinais (ver §12).

### 6.12 Variante LBP Short Stay (anfitriões de 1 a 10 imóveis)

Não é o LBP genérico com outro texto — é uma **variante dedicada** ao vertical prioritário de Búzios. O anfitrião de 1 a 10 imóveis é o cliente "sem processo ativo" arquetípico: não tem estrutura, depende de OTA e tem dor quantificável (comissão de 15–18%).

**O que muda no esqueleto:**
- **Página por imóvel (ou portfólio do anfitrião)** com o que o hóspede decide: fotos, comodidades, localização/praia, regras, disponibilidade.
- **Reserva direta como ação central** — o "agendar" do LBP vira "consultar disponibilidade / reservar direto". A **Mia trilíngue (PT/ES/EN)** no widget é o interceptador: turista estrangeiro conversa de madrugada e reserva sem OTA.
- **Bloco de confiança que substitui o selo da OTA** (ver reviews abaixo).

**Reviews + link com Airbnb/Booking — estratégia (com cautela de compliance):** trazer e *republicar* o texto das avaliações de OTA é território cinzento (termos de uso das plataformas + LGPD). Abordagem em três camadas, da mais segura à construção de ativo próprio:
1. **Prova social por síntese, não cópia:** exibir "Nota 4.9 no Airbnb · Superhost" **com link** para o perfil na OTA — mostra o *sinal* de reputação e manda quem quer ler para a fonte.
2. **Migrar a reputação para o terreno do cliente:** usar o motor de captação de reviews (§5.1) para gerar avaliações **novas no Google** — tirar o anfitrião da reputação-refém da OTA e construir reputação *dele*, onde a IA lê com mais peso. **É o objetivo estratégico.**
3. **Depoimento com autorização:** a Mia pede ao hóspede pós-checkout um depoimento publicável (nasce com consentimento).

Decisão: v1 usa (1) para não deixar o card vazio + inicia (2) desde o dia 1. Não amarrar o produto a raspar OTA — amarrar a *migrar* a reputação.

> **Nota:** sinal de cautela, não orientação jurídica — verificar os termos de uso vigentes das plataformas e a orientação jurídica antes de qualquer coleta automática.

**Precificação:** por número de imóveis (1 imóvel vs. até 10). O gancho de venda é a comissão de OTA recuperada (o quiz `short-stay-buzios`, §4.5, calcula o "dinheiro na mesa").

**Distinção de público:** "imobiliária de temporada" (gere carteira de terceiros) e "anfitrião short stay" (gere o próprio) são públicos diferentes → páginas e presets separados.

---

## 7. Arquitetura Técnica

### 7.1 Stack

| Camada | Tecnologia | Observações |
|---|---|---|
| App web / páginas | **Next.js** (multi-tenant por Host header via middleware) | Rewrite para `/_tenants/[tenant]/...`; conteúdo em Markdown/front matter (padrão HugoBlox) na fase inicial; blocos React fixos = esqueleto do LBP |
| Design tokens | **Motor de paleta (herança CartãoPro)** + tokens por tenant | 3 cores-semente → JSON de escala/contraste → variáveis de estilo lidas pelos blocos; fonte (par curado), logo, fotos como tokens |
| Banco / auth / API | **Supabase** (Postgres + Edge Functions) | Tabelas `tenants`, `facts`, `leads`, `metrics`, `optouts`; RLS por `tenant_id` (isolamento de dados = item de compliance) |
| Domínios de clientes | **Cloudflare for SaaS (Custom Hostnames)** | Fallback origin `clientes.soullocal.com.br`; CNAME + TXT do cliente; SSL automático; 100 hostnames grátis, depois ~US$0,10/mês |
| Orquestração | **n8n** | Coleta de dados, geração de relatório, fluxos da Mia (AI Agent node + tool HTTP), automação da Troca de Contato, onboarding de hostname via API Cloudflare |
| Governança de agente | **Pipeline MCP → policy engine → executor (herança CartãoPro)** | Genérico e multi-canal; agente propõe (nunca executa); proposta com ID de ponta a ponta; deny-by-default; regras do policy engine **por canal (CartãoPro, LBP) + vertical**; human gate por exceção; executor separado aplica. Base do Agente de Conteúdo Autônomo (§5.5) |
| Atendimento | **Chatwoot** (inbox omnichannel: **Website widget** + WhatsApp + Instagram) + **Typebot** (fluxos) | Widget = canal próprio sem dependência da Meta; agente SDR via Agent Bot API; WhatsApp via API oficial/BSP; Evolution API somente para testes (risco de ban — nunca no número principal) |
| Coleta de dados | **DataForSEO** (SERP/Local Pack, concorrentes, keywords, **LLM Mentions** para GEO; pay-as-you-go, MCP oficial) consolidando SERP; Apify (Instagram), Outscraper (massa), Places API (New) conforme necessidade; **BrasilAPI** (CNPJ — porte, sócios, situação cadastral; gratuita) como nó de enriquecimento/qualificação entre coleta e LLM, §3.1A | Campos mínimos; cache agressivo; ver §7.6 |
| IA | **BYO-LLM (chave do cliente)** para Mia + automações do tenant, com fallback genérico da SoulLocal; **LLM da SoulLocal em credenciais próprias, bucket separado** para Raio-X, análise de reviews, agente de conteúdo e teste de visibilidade em IA | Ver §5.2 e §7.5 |

### 7.2 API de Fatos (núcleo de conhecimento)

**Tabela:** `facts(id, tenant_id, slug, pergunta, resposta, fonte, verificado_em, visibilidade, perecivel, revalidar_em, idioma)`

Campos de frescor (§5.4): `perecivel` (boolean — fato com data de validade, ex.: horário, preço, promoção) e `revalidar_em` (data-alvo da próxima reverificação). Mutações de conteúdo passam pelo pipeline de governança (§5.5): toda escrita em `facts` é aplicada pelo executor após aprovação, com ID de proposta rastreável (lastro de auditoria LGPD).

**Endpoints:**
- `GET /api/facts/{tenant}/{slug}` — **público**, somente `visibilidade = publico`. Consumido por crawlers de IA e páginas do LBP.
- `GET /api/facts/{tenant}/{slug}` (autenticado) — inclui `visibilidade = agente` (instruções operacionais internas). Consumido pela Mia via tool calling no n8n.

**Consumidores:** (matriz completa na §7.2A.3) (1) crawlers/agentes de IA externos; (2) Mia — tool `buscar_fatos(slug|tema)` no AI Agent do n8n; (3) dashboard; (4) renderização das páginas do LBP.

**Regras:** conteúdo retornado é dado, não instrução (anti prompt-injection); toda resposta da Mia rastreável à origem (auditoria LGPD); edição da base atualiza chatbot + site + GEO sem redeploy.

### 7.2A Camada de conhecimento — tipos, escopo e regras de consumo

**A inversão que define esta seção.** Plataformas enterprise usam um grafo de conhecimento para **distribuir uma verdade que já existe** — o cliente tem sistema de gestão, manual de marca e um time que sabe o horário de cada unidade. O problema deles é propagação com consistência.

**Nosso cliente não tem fonte a sincronizar.** O comerciante frequentemente não sabe o próprio e-mail. O conhecimento existe espalhado entre a cabeça dele, o Instagram, um Google desatualizado e o que a recepcionista responde no WhatsApp. **Antes de distribuir, a verdade precisa ser fabricada** — e isso reposiciona o Setup: o entregável não é o site, é a base de conhecimento. O site é a consequência mais visível dela.

Consequência de arquitetura: a `facts` da §7.2 mistura, hoje, coisas com **condições de verdade diferentes**. Elas não podem obedecer às mesmas regras.

#### 7.2A.1 Os seis tipos de conhecimento

| Tipo | De onde vem a verdade | Consumidores |
|---|---|---|
| **Declarado** | O cliente afirma (horário, preço, registro, formas de pagamento) | Páginas, crawlers de IA, Mia, FAQ |
| **Operacional** | O cliente instrui ("em pedido de orçamento, colete X e diga que retornamos em 24h") | Somente a Mia |
| **Restritivo** | Fonte externa — norma de conselho (CFM, OAB, CRO, CRP) | Policy engine, agente de conteúdo, Mia |
| **Observado** | Medição — nós do geo-grid (§7.7), menções em IA (§7.6), analytics por URL (§6.9A), reviews | Relatórios (§9.4), alertas do Tier 3, curadoria |
| **Derivado** | Inferência de LLM sobre o observado (ex.: diagnóstico de sentimento, §5.1A) | Relatórios, agente de conteúdo |
| **De interação** | Comportamento do visitante — o que perguntaram à Mia, o que buscaram no widget | FAQ, decisão de página de intenção (§6.5A), lead |

**As três condições de verdade que precisam ser respeitadas:**

- **Declarado vence e revalida.** Exige `fonte`, `verificado_em` e `revalidar_em` — mecânica já existente em `perecivel` (§5.4). Fato declarado sem procedência não entra.
- **Observado nunca vence.** É registro datado de uma medição. O que envelhece é a *leitura*, não o dado. Por isso não se aplica `revalidar_em` a medição — aplica-se nova varredura, que gera outra linha.
- **Derivado carrega procedência e confiança, e nunca se apresenta como declarado.** Esta é a regra de honestidade da camada: inferência vendida como fato é exatamente como se produz "sua visibilidade em IA subiu 30%" sem nada por trás. Saída derivada é rotulada como tal em qualquer superfície voltada ao cliente (§1.1).

**Consequência para o tipo de interação:** toda pergunta que a Mia não soube responder é, ao mesmo tempo, (a) um lead com intenção declarada, (b) uma lacuna na base e (c) frequentemente um sinal de que outros tenants do mesmo vertical têm a mesma lacuna. É o mesmo princípio já cravado para escalonamento: **o que se mede não é quantas vezes o agente não soube, mas quantas vezes não soube pela mesma razão evitável.**

#### 7.2A.2 Dimensão de escopo — nem todo conhecimento é do tenant

A base assume `tenant_id` em tudo, por RLS. Mas boa parte do que os agentes precisam **não pertence a cliente nenhum**. Sem uma dimensão de escopo explícita, ou replicamos a mesma norma do CFM dentro de cada tenant — e atualizar a norma vira migração —, ou os agentes simplesmente não têm acesso a ela.

| Escopo | Exemplos | Quem edita |
|---|---|---|
| **Global** | Como funciona avaliação no Google; o que é `areaServed` | SoulLocal |
| **Vertical** | O que o CFM proíbe; o que a OAB restringe; vocabulário de comodidades por mercado | SoulLocal (curadoria + fonte oficial) |
| **Cidade** | Bairros de Búzios e para quem servem; sazonalidade; troca de audiência semanal; conjunto de concorrentes locais | SoulLocal |
| **Tenant** | Horário, preço, catálogo, instruções operacionais | Cliente (via pipeline) |

**Isto é o que destrava a página de destino (§6.5A e documento companheiro):** o conhecimento sobre bairros de Búzios é **escopo cidade**, não de cliente. Por isso ele pode sustentar o portal da SoulLocal e, ao mesmo tempo, alimentar o LBP de cada anfitrião **sem duplicação de conteúdo** — é a mesma linha de conhecimento, renderizada em superfícies diferentes.

**Regra de precedência:** em conflito, **restritivo > global > vertical > cidade > tenant**. Cliente que declara algo que a norma do conselho dele proíbe tem o fato barrado, não publicado com ressalva.

#### 7.2A.3 Matriz de consumo por agente

| Consumidor | Declarado | Operacional | Restritivo | Observado | Derivado | Interação |
|---|---|---|---|---|---|---|
| **Mia** (atendimento) | ✅ | ✅ | ✅ (como trava) | — | — | grava |
| **Agente de conteúdo** (§5.5) | ✅ | — | ✅ (como trava) | ✅ | ✅ | ✅ |
| **Páginas / crawlers de IA** | ✅ (só `visibilidade = publico`) | — | — | — | — | — |
| **Relatório Dinâmico** (§9.4) | ✅ | — | — | ✅ | ✅ (rotulado) | ✅ |
| **Policy engine** | — | — | ✅ | — | — | — |
| **Curadoria humana** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Nota: `visibilidade = agente` (§7.2) permanece como está — o tipo operacional é, por definição, invisível ao público e aos crawlers.

#### 7.2A.4 Regras de aterramento da Mia

O objetivo não é a Mia saber tudo; é ela **saber o que não sabe**. Hoje, fato inexistente é linha inexistente, e ela não distingue *"nunca perguntamos isso ao cliente"* de *"o negócio não oferece isso"* — que são opostos, com respostas certas diferentes.

**Ausência precisa ser um estado, não um vazio.** Três estados, três comportamentos:

| Estado | Comportamento |
|---|---|
| Presente e fresco | Responde. |
| Presente e vencido (passou de `revalidar_em`) | Responde com ressalva explícita e dispara revalidação. |
| **Ausente ou desconhecido** | **Nunca inventa.** Diz que não tem a informação, oferece o contato humano, captura o lead e grava a lacuna na fila de curadoria. |

**Por que a rigidez aqui não é preciosismo:** a Mia inventar um preço, um horário ou um "aceitamos pet" produz o cliente que chega na porta e se irrita. Isso vira avaliação de uma estrela. Estaríamos **causando** o problema de reputação que vendemos para resolver — com o nosso nome na ferramenta.

#### 7.2A.5 Três regras de governança do conhecimento

**R1 — Nenhum agente escreve na base sem passar pelo pipeline.** Já vale para conteúdo (§5.5: MCP → proposta → deny-by-default → policy engine → gate humano → executor); passa a valer para **conhecimento**. Agente que aprende sozinho e grava é agente que corrompe a fonte da verdade — e a corrupção é silenciosa.

**R2 — Conhecimento restritivo é o único que o cliente não pode alterar.** Ele edita horário, preço e catálogo; não edita o que o conselho dele proíbe. É a mesma separação já cravada entre tabela de preferências e regras de governança da Mia — o cliente não desativa uma restrição achando que é preferência.

> **O que isso destrava comercialmente:** hoje a conformidade mora na geração (o agente evita escrever fora da norma). Com o restritivo na camada de dado, ela desce um nível — **o fato não pode existir**. Deny-by-default no dado, não só na escrita. É a diferença entre "nosso agente evita" e a frase que a §1.1 nos permite vender: *estruturalmente incapaz de publicar fora da norma do seu conselho*.

**R3 — Toda saída de agente é rastreável ao conhecimento que a gerou.** Já vale para a Mia (§7.2). Passa a valer igual para **relatório e conteúdo** — senão o relatório afirma e ninguém sabe de onde saiu, o que quebra a §1.1 e o lastro de auditoria LGPD ao mesmo tempo.

#### 7.2A.6 Pendências desta seção

1. **Forma de implementação do escopo** — coluna de escopo em tabela única com RLS ajustada, ou tabelas separadas por escopo com resolução na leitura. Tem impacto direto em performance e em complexidade de política RLS; não decidido.
2. **Fonte e cadência do conhecimento restritivo.** Norma de conselho muda. Quem monitora, com que frequência, e qual o procedimento quando uma norma muda e há conteúdo publicado sob a regra antiga.
3. **Curadoria do escopo cidade.** É o conhecimento que sustenta a página de destino e não tem dono definido — mesma pendência 7 do documento companheiro, vista de outro ângulo.
4. **Nível de confiança do derivado** — se é escala, rótulo qualitativo ou apenas procedência. Sem isso, R3 fica cumprida na forma e vazia no conteúdo.


**Política de domínio do cliente (revista na v2.6 — domínio deixa de ser upsell):**

| Situação | Endereço |
|---|---|
| Cliente já tem domínio | O domínio dele, via Custom Hostname |
| Cliente não tem (caso comum) | **Domínio `.com.br` incluído no Setup como bônus**, registrado no **CPF/CNPJ dele** |
| Cliente não quer / não consegue registrar | Fallback: subdomínio `{cliente}.soullocal.com.br` (zero configuração) |

- **Por que o domínio sai do Tier 3 e entra em todos os tiers.** Um `.com.br` custa ~R$ 40–60/ano no Registro.br — cerca de R$ 4/mês, absorvido pelo Setup (R$ 497–997). Cobrar ~R$ 600/mês de diferença por ele é vender como feature o que é custo de rodapé, e **contradiz o eixo de venda da §6.1A**: não se pode dizer "o resultado é seu" e cobrar upgrade para que o endereço seja dele. O Tier 3 se sustenta pelo que de fato é recorrente (monitoramento de visibilidade em IA, alertas de concorrente, relatório executivo, exclusividade por categoria em Búzios — §9.1).
- **Registro obrigatoriamente no CPF/CNPJ do cliente.** Domínio "de cortesia" no nome da agência não é bônus, é coleira — e é exatamente o comportamento criticado nas OTAs (§6.1A). Se o cliente cancelar, ele **sai com o domínio na mão**. Isso é o que torna a frase "o resultado se acumula no que é seu" verificável, e é coerente com a decisão já existente de **não usar fidelidade contratual** (§9.1): cliente que pode sair e escolhe ficar é prova de retenção melhor que cliente preso. *(O Registro.br exige CPF/CNPJ do titular — o registro em nome dele é o caminho natural, não concessão extra. É fricção da mesma ordem do acesso ao GBP no Fluxo A, §5.1.)*
- **Destino do 301 vindo do Tenant Fantasma (§3.1B):** `begoo.guide/{cidade}/{negocio}` → domínio do cliente (ou, na exceção, o subdomínio de fallback). Nunca para domínio do Begoo: após a reivindicação, o controlador do dado e o faturamento são da SoulLocal, e hospedar o produto pago em domínio de outra empresa do grupo reabre a fronteira fechada na §0.
- **Nota de arquitetura — por que o fallback é subdomínio, e não subpasta:** em subpasta compartilhada, todos os clientes dividem a reputação de um mesmo host e um problema em uma ficha respinga nas demais. Subdomínio por tenant isola — é o padrão de SaaS multi-tenant (`myshopify.com`, `wixsite.com`) e é o que o fallback origin `clientes.soullocal.com.br` do Cloudflare for SaaS já pressupõe (§7.1).
- **Trilho único (decisão v1.4): tudo no Trilho 2, SoulLocal como tenant zero.** Todo conteúdo — inclusive o site da própria SoulLocal — vive na tabela `facts` do Supabase, por `tenant_id`, na mesma engine de renderização (ver §7.5). Isso resolve a ambiguidade dos dois trilhos: um só modelo de conteúdo, editável por painel/agente sem redeploy. (O Trilho 1 — Markdown no repositório — permanece disponível apenas como fallback de arranque para a Fase 0, se necessário.)
- **Tokens de pele por tenant:** paleta (JSON gerado da semente), par de fonte, logo, fotos — carregados por hostname/inbox e injetados como variáveis de estilo nos blocos fixos.
- Requisitos: canonical/sitemap/robots/llms.txt gerados **por hostname**; 301 do subdomínio antigo ao ativar domínio próprio; ativação somente após validação TXT; apex sem CNAME → redirect www ou A records.
- Atenção de hosting: Cloudflare proxy + Vercel conflitam (SSL duplo) — usar domains da Vercel ou servir via Cloudflare Workers/OpenNext.

### 7.4 Instrumentação (desde a 1ª mensagem)
Registrar em Supabase: taxa de resposta por nicho/variação/horário; abertura da página do relatório; tempo até follow-up; qualificação; demo; fechamento; opt-outs; **e, no LBP:** cliques em "salvar", formulários de Troca de Contato preenchidos, conversão entre os dois, conversas iniciadas no widget. Dobrar a taxa de resposta da 1ª etapa dobra todo o funil.

### 7.5 Plataforma única, tenant zero e escala do Supabase

**Uma plataforma só** (Next.js + Supabase + pipeline de governança + blocos + Mia) serve múltiplos tenants. **A SoulLocal é o tenant zero** — primeiro inquilino do prédio que ela construiu (dogfooding: se o motor de GEO funciona para a SoulLocal, funciona para o cliente). Componente escrito uma vez é herdado por todos os tenants.

**Separação de credenciais de IA:** a LLM do cliente (BYO-LLM, §5.2) roda por tenant; a LLM da SoulLocal roda em **bucket de credenciais separado**. Nunca se misturam.

**Escala do Supabase (schema compartilhado — a decisão que sustenta o custo):**
- **Multi-tenant por linha, não por projeto.** Todos os tenants são *linhas* nas mesmas tabelas, isolados por RLS (`tenant_id`). Um tenant novo é só mais algumas linhas de texto — quase nada de armazenamento. ⚠️ Se cada cliente virasse um *projeto* Supabase separado, o modelo quebra e encarece — **o design tem que ser tenant-por-linha**.
- **Visitantes não são MAU.** Hóspedes/pacientes só navegam; leads entram por formulário, não por login. O limite de 100 mil MAU do Pro é praticamente irrelevante (MAU = só equipe SoulLocal + clientes no painel).
- **Páginas em cache (SSG/ISR).** O Supabase é chamado para a API de fatos e a Mia, não para renderizar cada página — segura egress e compute.
- **Sobe-se compute, não se migra.** O que cresce com o número de clientes é ínfimo; o que cresce com *tráfego agregado* é o compute. Escada real: **Small (US$15) → Medium (US$60) → Large (US$110) → XL (US$210)**. Um único projeto Supabase serve confortavelmente **milhares** de tenants desse perfil. A conversa de migrar/shardar só aparece em dezenas de milhares de tenants ou se um cliente virar muito pesado — fora do horizonte. (O 4XL de US$960 que aparece na calculadora do Supabase é exagero grosseiro para este perfil.)

### 7.6 Camada de dados e medição (interno × cliente)

**Princípio:** o comerciante não monitora SEO. Há dois planos que **nunca se misturam** — o dado bruto que a SoulLocal consome e o painel traduzido que o cliente vê.

**Dado interno (insumo da SoulLocal — nunca exposto cru ao cliente):**
- **Google Search Console + Analytics (grátis, da fonte):** tráfego e busca reais do cliente (impressões, cliques, consultas, sessões). São a verdade da fonte — conectar sempre. Mas são "painel de mecânico": jargão que o comerciante não quer ver.
- **DataForSEO (pago, por uso):** o que o Google *não* entrega mastigado — posição no Local Pack, comparação com concorrentes, keywords nicho-bairro. Consolida a coleta de SERP (mais barato e sem assinatura que alternativas de uso irregular). Alimenta o motor do Raio-X e o dashboard. Tem **MCP oficial** → consultável como ferramenta pelos agentes.
- **Medição de GEO (a peça que faltava):** a **LLM Mentions API** do DataForSEO rastreia menção/citação de marca, páginas e concorrentes dentro de ChatGPT e Google AI Overviews, com tendência histórica (~US$1/1.000 linhas). Transforma o "monitoramento de visibilidade em IA" do Tier 3 de promessa vaga em número real — é o **output** do funil de GEO (§6.11).

**Painel do cliente (o que ele vê — sentido, não métrica):** nada dos dados acima cru. Tudo traduzido para linguagem de dono de negócio: quantas pessoas te acharam no Google (não "impressões"); quantas ligaram/pediram rota/mandaram WhatsApp (a ação, não o clique); nota e avaliações novas; "você agora aparece quando perguntam ao ChatGPT" (LLM Mentions traduzido).

**Cuidados honestos:**
- **Custo por uso escala com clientes.** DataForSEO é barato por request, mas monitorar 100+ clientes continuamente vira linha real no variável por tenant (§9) — orçar, não assumir grátis. *Números cravados para a varredura geográfica na §7.7 (~R$ 159/mês a 100 clientes no regime 7×7), com as ressalvas de profundidade e parâmetros que ainda precisam de lote piloto.*
- **Medição de GEO é aproximação, não verdade absoluta.** Respostas de IA variam por usuário/sessão; usar como *tendência* e comparação com concorrente ("sua presença em IA está subindo"), nunca como contagem exata.

### 7.7 Geo-grid — varredura geográfica de visibilidade

**O que é.** Uma malha de coordenadas sobre o território do negócio (3×3 para prospecção, 7×7 para cliente). Em cada nó, roda-se a consulta como se o usuário estivesse fisicamente ali e registra-se a posição do negócio naquele ponto. O resultado é um mapa de posição por localização — não uma posição média, que é a métrica que engana. Um negócio pode ser primeiro na porta e invisível a 800 metros, e é essa diferença que o número único esconde.

**Por que entra agora.** O Tier 3 já promete "monitoramento de visibilidade" e "alertas de concorrente" (§9.1). Até esta versão, as duas promessas não tinham mecanismo por trás — a LLM Mentions API (§7.6) cobre a visibilidade em **IA**, não a geográfica. O geo-grid é o mecanismo que faltava.

#### Stack — restrição cravada

**Tem de ser DataForSEO (Google Local Finder SERP API) com coordenadas por nó. Não Places API.**

O motivo não é preço, é cobertura: a **Places API não retorna negócio sem endereço físico**. Em Búzios, isso apagaria passeio de escuna, transfer, chef em casa, instrutor de kite e prestador que atende no endereço do cliente — aproximadamente metade do mercado endereçável, e justamente a metade em que a busca local decide a venda. Um instrumento que só enxerga quem tem loja de rua mediria o mercado errado.

#### Custo real (não é a restrição)

Fila padrão da Local Finder SERP API a **US$ 0,0006/requisição** (prioritária dobra; *live* a US$ 0,002). Câmbio de referência do documento: US$ 1 = R$ 5,40.

| Uso | Requisições | Custo |
|---|---|---|
| Raio-X 3×3 (1 keyword) | 9 | **~R$ 0,03 por prospect** |
| 600 prospects/mês | 5.400 | ~R$ 17/mês |
| Cliente 7×7 (5 keywords, 2 varreduras/mês) | 490 | **~R$ 1,60 por cliente/mês** |
| 100 clientes nesse regime | 49.000 | ~R$ 159/mês |

**Leitura:** três centavos por prospect e um real e sessenta por cliente/mês não são linha de decisão em nenhum cenário do §9.1. **O custo nunca foi a restrição** — a restrição era não ter mecanismo para uma promessa já vendida.

**Ressalvas honestas (validar em lote pequeno antes de fixar no modelo econômico):**
- A Local Finder cobra **a cada 20 resultados**. Negócio que ranqueia além da 20ª posição num nó exige profundidade extra — e é exatamente o perfil do prospect fraco, que é a maioria da base de prospecção. O custo do Raio-X pode subir acima da estimativa justamente onde ela mais se aplica.
- **Parâmetros opcionais multiplicam o custo** por requisição. Fixar o conjunto mínimo de parâmetros antes de escalar.
- Portanto: rodar um lote piloto (~50 prospects), medir custo real por relatório e só então cravar a linha no variável por tenant (§9.1, §7.6).

#### Os quatro usos, em ordem de retorno

1. **Venda (maior retorno).** O 3×3 no Raio-X (§3.1). Mapa do próprio bairro em vermelho converte mais que nota numérica — o dono não discute um mapa do lugar onde ele mora. É argumento visual, não métrica.
2. **Retenção.** Varredura no início e no fim do mês, lado a lado. Alimenta diretamente a **camada 1 do Relatório Dinâmico** (§9.4) — é o par de comparação que transforma dado em prova, com o delta como herói.
3. **Substância do Tier 3.** É o mecanismo por trás de "monitoramento de visibilidade" e "alerta de concorrente" (§9.1). Sem ele, o tier cobra por uma promessa sem instrumento — o que a §1.1 proíbe.
4. **Trigger de ação (real, mas limitado — ver abaixo).**

#### Honestidade sobre o trigger (a parte que não pode ser vendida como é)

O trigger é fácil de detectar; **a ação disponível é fraca.** Proximidade é fator dominante no ranqueamento local, e **não existe conteúdo que resolva estar fisicamente longe.** Vender "nossa IA detecta a fraqueza geográfica e a corrige" seria narrativa vazia — viola a §1.1 diretamente, e é o tipo de promessa que o cliente descobre no mês 7.

**O que é ação real:**
- **O grid define o vocabulário geográfico do conteúdo.** Fraqueza persistente nos nós de Geribá vira insumo concreto: FAQ que nomeia o bairro, `areaServed` no JSON-LD, **página de intenção geográfica (§6.5A)** — que é onde essa ação materializa como URL própria —, menção nos fatos perecíveis (§5.4). Não corrige a distância — melhora a elegibilidade do negócio para a consulta feita dali.
- **Detecção de concorrente novo.** Um concorrente que aparece de uma varredura para a outra em nós onde não estava é sinal acionável e verificável — é o "alerta de concorrente" do Tier 3 deixando de ser figura de linguagem.

#### Regra de entrega (a que impede o instrumento de virar teatro)

**Nenhum mapa é entregue ao cliente sem a ação ao lado.** O nó vermelho entra no relatório acompanhado do que foi feito por causa dele e do efeito medido na varredura seguinte. Formato aceito: *"publicamos a página de Geribá em 12/03 → na varredura de 31/03 entramos no top 3 em 6 nós onde não aparecíamos."* Formato recusado: o mapa sozinho, com legenda explicando as cores.

Isso é aplicação direta da §1.1 e não é opcional: mapa mensal sem ação amarrada é a definição de "o cliente sente que estamos trabalhando" — o critério que corta features do roadmap.

---

## 8. Compliance

- **LGPD (prospecção):** base legal de legítimo interesse (B2B, dados públicos, finalidade documentada); opt-out automatizado < 48h; rodapé de transparência no relatório; contrato de prestação com cláusula de operador de dados desde o cliente 1; scraping de perfis públicos com finalidade e minimização documentadas.
- **LGPD (visitantes — camada de plataforma, herdada do CartãoPro):** com formulário de contato + chat + Troca de Contato + cupom-reserva, a plataforma coleta dado de terceiro (visitante do cliente) em escala → camada de LGPD **obrigatória e transversal** (LBP, Reviews, Mia, Quiz): registro de **opt-in/opt-out**, **DPO**, **políticas de privacidade versionadas**. Responsabilidade multi-tenant: **tenant = controlador; SoulLocal = operadora** (cláusula de operador no contrato desde o cliente 1). **Pedido de eliminação de dados:** encaminhado ao **responsável do comerciante — DPO dele, se houver; senão o proprietário** (controlador decide). A SoulLocal (operadora) faz **bloqueio imediato dos dados e da comunicação com o titular** e mantém até o comerciante realizar/autorizar a exclusão — não decide por conta própria. Ponto a validar juridicamente: garantir fim no prazo legal mesmo se o comerciante demorar (notificação/escalonamento ou exclusão assistida). Exceção ao soft delete de 30 dias.
- **Exclusão — soft delete (padrão de plataforma):** toda exclusão marca como excluído, some das consultas na hora e purga após **30 dias** (recuperável no período). Rebaixa "excluir" de alto risco para risco médio na governança. Exceção: pedido de eliminação LGPD do titular fura os 30 dias (acima).
- **Isolamento multi-tenant:** RLS por `tenant_id` no Supabase; cliente A nunca acessa dado do cliente B — tratado como item de compliance, não só técnico.
- **Meta/WhatsApp:** API oficial para atendimento em escala; prospecção fria fora de disparo em massa; toda mensagem com gancho de resposta; captura via widget e Troca de Contato gera WhatsApp inbound/opt-in; monitorar quality rating do número.
- **Google:** Business Profile API somente após aprovação formal; até lá, acesso manual como Gerente; nunca declarar scraping no pedido de API.
- **Governança — fonte única de política (invariante):** todas as regras de negócio/compliance vivem em um só policy engine, externo aos orquestradores (§5.5). Qualquer executor consulta a fonte antes de agir; nenhum mantém cópia. Uma atualização de regra vale para toda a operação — evita a fragmentação que multiplicaria o trabalho de curadoria e abriria brechas.
- **Conselhos profissionais (CFM/CRO/OAB/CRP):** checklist de publicidade por categoria antes de publicar o LBP (§6.7), codificado como regra inegociável no policy engine; verificar resoluções vigentes com profissional habilitado.
- **Licenças open source:** verificar AGPL antes de embutir código de terceiros no SaaS; **HugoBlox (MIT)** — copiar conceitos, não templates (Hugo/Go não migra para React); **superdev-seo-pages é proprietário ("all rights reserved")** — apenas referência de padrão, nunca código.

---

## 9. Precificação

**Custo variável por cliente (revisado com BYO-LLM):** com a LLM da Mia deslocada para a chave do cliente (§5.2), o variável que resta nos livros da SoulLocal cai para ~**R$ 45–110/mês** (WhatsApp BSP ~R$15–30 · dados DataForSEO/Apify — SERP, concorrentes, LLM Mentions ~R$20–50 · LLM da SoulLocal para Raio-X/agente de conteúdo ~R$10–30 · infra ~0). Margem de software forte a partir de ~R$ 400.

### 9.1 Modelo econômico — infra × variável × mão de obra

Modelo demonstrativo (planilha ajustável em anexo). **Câmbio assumido US$1 = R$5,40; ticket médio R$800/tenant** (ajustáveis).

| Cenário | Tenants | MRR (R$) | Infra Supabase+servidor (R$/mês) | Infra / receita |
|---|---|---|---|---|
| Semente | 10 | 8.000 | ~378 | 4,7% |
| Crescimento | 50 | 40.000 | ~729 | 1,8% |
| Escala | 100 | 80.000 | ~1.242 | 1,6% |
| Maduro | 300 | 240.000 | ~2.052 | 0,9% |

**Leitura correta (e honesta):**
- **Infra (Supabase + servidor) é ruído** — nunca passa de ~5% da receita e vira <1% na escala. A receita cresce por tenant (linear); o compute sobe em degraus. O multi-tenant faz a margem de infra explodir.
- **Isso NÃO significa margem quase pura.** O modelo acima é só infra. Fora dele: (1) o **variável por tenant** revisado (§9, WhatsApp + dados + LLM da SoulLocal); (2) **mão de obra** (onboarding, human gate do agente de conteúdo, atendimento) — **o maior custo real conforme escala**.
- **Conclusão para planejamento:** o gargalo do negócio é **gente, não servidor**. Escalar exige planejar contratação/automação do human gate, não capacidade de banco.

| Plano | Preço/mês | Conteúdo |
|---|---|---|
| **Setup** (única vez) | R$ 497–997 | Construção do LBP (Ficha Viva) — a promessa das 48h; **âncora dos R$ 5–10k aparece aqui** ("normalmente custaria X, no setup sai por Y"). Grátis para 5 fundadores (troca por depoimento) |
| **Tier 1 — Presença** | R$ 497 | Gestão GBP + pedido automático de reviews + resposta a reviews + mini Raio-X mensal |
| **Tier 2 — Ficha Viva** (núcleo da base) | R$ 897–997 | Tier 1 + **LBP completo** (~14 URLs agent-first + design premium por blocos + Troca de Contato) + **canal de atendimento IA completo** (Mia: widget + WhatsApp + Instagram, mesma inbox) + 1 provedor de agenda + dashboard com 3 concorrentes |
| **Tier 3 — Inteligência** | R$ 1.497–1.997 | Tier 2 + monitoramento de visibilidade em IA (LLM Mentions, §7.6) + **varredura geográfica 7×7 quinzenal com alerta de concorrente novo** (geo-grid, §7.7) + relatório executivo + (Búzios) exclusividade por categoria |

⚠️ **Mudança da v2.6 — domínio deixou de ser diferenciador de tier.** O domínio próprio (registrado no CPF/CNPJ do cliente) passa a ser **incluído no Setup em todos os tiers** (§7.3): custa ~R$ 4/mês e cobrá-lo como upgrade contradiz o eixo de venda da §6.1A. O tier foi renomeado de "Domínio" para "Inteligência", refletindo o que de fato sustenta a diferença de preço — monitoramento, alertas e exclusividade, que são recorrentes.

✅ **Fechamento da v2.8 — o Tier 3 ganhou mecanismo.** Até aqui, "monitoramento de visibilidade" e "alertas de concorrente" eram promessas sem instrumento por trás, o que é exatamente a narrativa que a §1.1 proíbe cobrar. A **§7.7 (geo-grid)** é o instrumento: varredura 7×7 quinzenal, detecção de concorrente novo por nó, e o par de varreduras que alimenta o delta do §9.4. **Custo marginal ~R$ 1,60/cliente/mês** contra uma diferença de tier de R$ 500–1.000 — o que sustenta o preço não é o custo do dado, é a leitura e a ação que vêm com ele (regra de entrega da §7.7).

**Compra à vista do LBP (âncora):** R$ 5.000–10.000 — referência de valor, não oferta a fechar (§6.3). O que não cabe em pagamento único (Mia, gestão de reviews, frescor, monitoramento) empurra naturalmente para a assinatura.

**Princípios:** ancoragem no valor do cliente recuperado (1 paciente/reserva recuperada paga o mês); sem fidelidade contratual (retenção estrutural: base de fatos + histórico + bot treinado + LBP mantido vivo); desconto ~15% no anual como opção; reajuste IGP-M/IPCA em contrato; preço de fundador vitalício por tier. **Búzios:** considerar sazonalidade no contrato (valor variável ou anual desenhado) + exclusividade por categoria no Tier 3.

**Projeção de referência:** 20 clientes Tier 2 em 6–9 meses ≈ R$ 18–20k MRR com ~R$ 3k de custo variável.

### 9.2 Projeção de crescimento e o efeito teto — meta de 100 assinantes (R$800 ticket médio)

**Achado central: com aquisição e churn constantes, o número de assinantes converge a um teto — não cresce indefinidamente ("balde furado": ganhos brutos entram, churn vaza).** Teto assintótico ≈ `ganhos_brutos/mês ÷ taxa_de_churn`.

**Primeira rodada (pré-canais calibrados, captação modesta):** com o ritmo original do funil outbound (§4.3, 1–4 clientes novos/mês) e churn-alvo de até 5% (§12), o teto fica em **~40–75 clientes** — **100 é matematicamente inatingível** nesse regime, não importa quanto tempo se espere.

**Correção (canais de entrada calibrados, sem ads):** uma vez os canais calibrados (Quiz, Tenant Fantasma, referral, portais), a captação sobe para **10–20 leads/dia**, sem nenhum investimento em ads. Isso muda o teto radicalmente:

| Conversão lead→cliente (a validar) | Clientes novos/mês (10–20 leads/dia) | Teto (churn 3–4%) |
|---|---|---|
| Conservadora (2%) | 6–12 | 150–400 |
| Média (5%) | 15–30 | 375–1000 |
| Otimista (10%) | 30–60 | 750–2000 |

**Mesmo no cenário mais conservador, o teto passa a 150+ — a meta de 100 deixa de ser limitada pela demanda.** A geração de lead deixa de ser o gargalo.

**O gargalo se move — não desaparece.** Com lead sobrando, a velocidade passa a depender inteiramente da **capacidade de onboarding/mês da equipe enxuta** (conversão + Fluxo A manual do GBP + setup do LBP + human gate). Essa variável ainda não foi medida:

| Capacidade de onboarding | Tempo até 100 assinantes |
|---|---|
| 5 clientes/mês (travado) | ~38 meses (3,2 anos) |
| 8 clientes/mês (moderado) | ~16 meses (1,3 ano) |
| 15 clientes/mês (folgado) | ~7 meses |

**Ads:** testar com verba modesta, acompanhar ROI; se fechar a conta, vira canal principal — mas como a demanda já deixa de ser o gargalo com os canais orgânicos calibrados, o valor do ads é **acelerar a curva de calibração e compensar a sazonalidade de Búzios** (mar–jun/ago–out), não resolver um problema de volume que os canais orgânicos já resolvem.

**Cuidado com o mix de verticais:** R$ 800 de ticket médio só se sustenta se a maioria dos 100 vier de comércio estabelecido (Tier "Completo", ticket mais alto); o Short Stay tem ticket proposto bem menor (~R$200–300) e puxaria a média para baixo se for fatia relevante do total.

**Recomendação:** não tratar "100 assinantes" como data — tratar como checkpoint após medir a **capacidade real de onboarding** no piloto de 5–10 clientes fundadores (§11, Fase 2). É o número mais importante ainda não medido do projeto.

### 9.2.1 Canal de indução — entrada em lote com confiança emprestada

**O que é:** parcerias com terceiros que já têm relação de confiança recorrente com o comerciante e o indicam à SoulLocal. Difere dos demais canais (Quiz, Tenant Fantasma, referral, portais) por não competir por atenção — o lead chega **pré-aquecido e pré-qualificado por quem ele já ouve**. Registrado a partir da análise competitiva da Merchynt, onde é o canal de maior escala documentado do playbook deles (um único parceiro de indução gerou 1.000+ clientes em um ano — nenhum outro número do material chega perto).

**Por que é canal de primeira classe, e não item de fase.** Hoje "associações locais" aparece como item solto na Fase 5 (§11). Isso subdimensiona o mecanismo: os outros canais entregam *volume* de lead — que, conforme a própria §9.2, deixou de ser o gargalo. O canal de indução ataca o gargalo real (**capacidade de onboarding/mês**) por três vias que os demais não têm:

1. **Menos esforço de venda por cliente.** A confiança já vem emprestada do indicador; encurta o ciclo consultivo do WhatsApp (§4.3) e reduz a etapa que mais consome hora humana.
2. **Menos atrito no ponto exato onde o onboarding trava.** O gargalo do setup é o Fluxo A do GBP (§5.1) — convencer o dono a conceder acesso, com a checagem de quem é de fato o proprietário. Cliente que chega indicado por quem ele já confia resiste menos a esse passo. É o item de maior alavanca porque atua na etapa mais lenta, não no topo do funil.
3. **Entrada em lote e padronizável.** Um parceiro entrega N clientes do *mesmo* nicho, o que permite reusar preset de quiz, calendário de contexto (§5.5), livro de regras de vertical e template de LBP — onboarding repetido é onboarding mais rápido. Lote homogêneo é o que efetivamente sobe a curva de capacidade.

**Ressalva honesta:** o canal de indução **não substitui** a medição da capacidade de onboarding — ele a torna mais favorável, não infinita. Um parceiro que entregue 20 clientes num mês contra uma capacidade de 8/mês vira fila, não crescimento. Combinar com o critério de §9.2: negociar cadência de entrega com o parceiro, não volume bruto.

**Candidatos mapeados (do mais óbvio ao mais potente):**

| Parceiro | Por que funciona | Nicho que destrava |
|---|---|---|
| **Contadores** | O análogo mais direto: relação mensal, confiança absoluta, e já sabe quem fatura bem, quem está formalizado e quem tem porte para assinar | Transversal (Tijuca e Búzios) |
| Distribuidores de insumos | O fornecedor de material odontológico/estético conhece as clínicas do bairro pelo nome | Clínicas, estética, pet |
| Associações e sindicatos de Búzios | Hotelaria, gastronomia, receptivo — pauta coletiva de reserva direta (§6.12) cai como luva | Turismo e short stay |
| Franqueadoras | Um contrato, N unidades, onboarding padronizado — o lote mais homogêneo possível | Multi-unidade |
| Sebrae RJ | Autoridade emprestada; porta de entrada para o comerciante cético | Transversal |

**Compatibilidade com o enriquecimento por CNPJ (§3.1A):** o ranking de priorização já existente (nota alta + presença fraca + porte) se aplica igualmente à carteira que o parceiro apresenta — a indicação define a *entrada*, o ranking define a *ordem de atendimento* dentro do lote, respeitando a capacidade de onboarding.

**Atenção de estrutura (a definir antes do primeiro acordo):** modelo de contrapartida ao indicador (comissão recorrente, valor fixo por cliente ativado, ou reciprocidade de indicação), e se há qualquer implicação de conselho quando o indicador é profissional regulado. Formalizar por escrito antes de escalar — inclusive para não fragmentar a relação de titularidade do cliente.

### 9.3 P0 — Sintonia operacional e Owner Success

**P0: sintonia entre agentes, fluxos, regras, sistemas e políticas.** Conforme o ecossistema cresce (mais agentes, mais tools no catálogo da Mia, mais verticais, e potencialmente mais empresas do grupo — §0), o risco de deriva entre peças que deveriam estar alinhadas cresce junto. Isso não é tarefa de setup único — é **disciplina operacional contínua**: toda tool, fluxo ou empresa nova conectada ao ecossistema precisa ser checada contra a fonte única de política (§5.5) antes de ir ao ar; auditorias periódicas de consistência entre as políticas de GBP/Reviews/LBP/Mia; um responsável nomeado por capturar deriva antes que vire incidente.

**Human gate: mínimo viável e seguro — nunca um ou outro sozinho.** Mínimo viável significa não travar com aprovação onde o risco é baixo (a hierarquia de risco já desenhada, §5.12 do PRD da Mia); seguro significa **nunca sacrificar a trava por velocidade**. Requisito adicional (piso de segurança, não otimização): **pelo menos um colaborador humano acompanha a jornada de onboarding de cada comerciante**, do início ao "no ar" — onboarding nunca é 100% mãos-livres, mesmo com todo o pipeline automatizado. Isso dá cara humana ao momento mais vulnerável da relação (o onboarding) e é, ao mesmo tempo, controle de qualidade e alavanca de retenção.

**Painel Owner Success (novo).** Painel interno de acompanhamento da saúde de cada conta, com foco em:
- **Incidentes** — problemas técnicos/operacionais por cliente.
- **Chamados** — solicitações de suporte.
- **Humor no chat** — sentimento detectado nas conversas (Mia/Assistente de Conta), sinalizando insatisfação antes que vire cancelamento.
- **Aviso de intervenção da gerência** — quando incidentes/chamados/sentimento cruzam um limiar, dispara alerta para a **gerência** intervir diretamente — não fica só com a linha de frente.

**Por que isso é P0, não "nice to have":** é o mecanismo operacional que sustenta a segunda alavanca do balde furado (§9.2) — churn baixo (3% vs. 5%) não vem só do produto (Motor de Frescor, retenção estrutural); vem de **pegar cliente infeliz cedo**. O Owner Success é a peça que transforma "esperamos que o produto retenha" em "vigiamos ativamente e agimos antes do churn acontecer".

**Schema (a somar à plataforma):**
```sql
create table owner_success_signals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) not null,
  tipo text,                    -- incidente | chamado | sentimento | onboarding_status
  severidade text default 'baixa', -- baixa | media | alta
  origem text,                  -- chat_mia | suporte | onboarding | monitoramento
  detalhe text,
  status text default 'aberto', -- aberto | em_acompanhamento | resolvido
  detectado_em timestamptz default now()
);

create table owner_success_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) not null,
  motivo text,
  nivel text default 'aviso',   -- aviso | intervencao_gerencia
  notificado_em timestamptz default now(),
  responsavel text,
  resolvido_em timestamptz
);
```

**Nota de consistência:** os limiares de escalonamento do Owner Success (o que dispara "aviso" vs. "intervenção da gerência") também são regra — vivem no mesmo policy engine (§5.5), não em um segundo lugar próprio. Mantém o princípio da fonte única mesmo para uma ferramenta interna de operação.

### 9.4 Relatório Dinâmico do cliente (a metade externa da prova de resultado)

Materializa a Metade 2 do princípio §1.1: a prova que o cliente **vê**. Enquanto o Owner Success (§9.3) é a vigilância interna, este é o instrumento voltado ao cliente — e é o que fecha a lacuna reconhecida de que a camada visível ao cliente ficou para trás do desenho de estrutura e serviços.

**Link dinâmico, não relatório enviado.** Relatório empurrado por e-mail nasce velho, é ignorado, e reintroduz o tom "olha como trabalhamos" que o §1.1 expulsa. O relatório é **puxado**: um link que o cliente acessa quando desconfia, quando o contador pergunta, quando vai decidir renovar — e encontra o número vivo, não o retrato do mês passado. É a diferença entre "confie em mim" e "veja você mesmo".

**Reuso de primitiva (zero infra nova):** é o **quarto uso do link tokenizado sem login** — a mesma primitiva de onboarding de acesso, aprovação de conteúdo pelo agente e aprovação do cliente pelo WhatsApp (§5.5, nível C). Registrar o link tokenizado como **componente transversal**, não amarrado a uma feature.

**Três camadas, nesta ordem (o delta é o herói):**

1. **O que mudou** (topo, legível em 3 segundos) — posição no mapa (**par de varreduras geo-grid início/fim do mês, §7.7** — é o que dá o par de comparação desta camada), reviews, visibilidade em IA, contatos capturados pela Mia. **Sempre mês vs. mês anterior.** Número isolado ("você tem 47 reviews") é vaidade; delta ancorado ("42 → 47") é prova. Indicador sem par de comparação ainda é *dado*, não prova.
2. **O que fizemos que causou isso** (a ponte — onde o §1.1 mais protege de recair em narrativa) — amarrar ação a efeito, nunca listar atividade. "Respondemos 100% dos reviews → nota subiu de 4,3 para 4,6", não "publicamos 12 posts e respondemos 30 reviews". Ação sem delta ao lado não entra.
3. **Dinheiro** (o fecho) — mesma moeda do Raio-X: "os contatos que a Mia capturou este mês, no seu ticket, representam ~R$ X". Começar e terminar a relação na mesma língua é o que faz o cliente reconhecer o resultado como *dele*.

**Modo "mês plano" (requisito de honestidade, não opcional).** SEO local tem meses planos, sazonalidade e maturação. Um relatório que só sabe celebrar crescimento vira narrativa no primeiro mês fraco — ou pior, esconde o mês fraco e queima a credibilidade que os meses bons construíram. A tela precisa saber dizer *"este mês estabilizou, e aqui está o porquê"* sem soar como desculpa: mostra o número quando sobe, mostra quando não sobe, e em ambos mostra o que está sendo feito. É a versão que sobrevive ao mês 7 (§1.1). *Este é o item mais difícil de desenhar e o que mais distingue prova de propaganda — priorizar no design.*

**Casamento com o Owner Success (o par completo dos dois lados do balcão):** delta fraco no Relatório Dinâmico + sentimento em queda detectado pelo Owner Success **na mesma conta, no mesmo mês** = o sinal de churn mais acionável que existe, com ~30 dias de antecedência. Dispara intervenção da gerência (§9.3) *antes* da renovação, com o relatório em mãos mostrando o que já melhorou e o que está em curso. Um mostra o resultado ao cliente; o outro mostra o cliente à gerência — mesmo par §1.1 visto de dentro e de fora.

**Dependências:** consome os mesmos dados já coletados (DataForSEO — posição/LLM Mentions; `facts`/GBP — reviews; Mia — contatos capturados). É camada de *apresentação de delta* sobre dado que já existe, não nova coleta. Guardar histórico mês a mês por tenant para o par de comparação existir.

---

## 10. Referências Open Source (aproveitamento)

| Projeto | Uso | Licença/atenção |
|---|---|---|
| claude-seo (AgriciDaniel) | Pipeline de auditoria GBP, geo-grid rank tracking, geração de PDF (WeasyPrint + matplotlib) — base do motor do Raio-X | Verificar licença antes de derivar |
| Chatwoot | Inbox omnichannel da Mia (widget + WhatsApp + Instagram) | OSS maduro |
| Typebot | Fluxos conversacionais (BR, integra n8n/WhatsApp) | OSS |
| SerpBear | Rank tracking self-hosted para o dashboard | OSS |
| Repos de review-request automation | Base do serviço de pedido automático de reviews | Verificar cada licença |
| Reviewskits | Coleta de depoimentos self-hosted | AGPLv3 |
| Evolution API | Somente testes de WhatsApp | Não-oficial; risco de ban |
| HugoBlox/kit | Referência de padrões de conteúdo (Markdown + front matter tipado, blocos, CLAUDE.md) traduzidos para Next.js — inspira o **esqueleto** do LBP | MIT — código Hugo/Go não migra para React; copiar conceitos, não templates |
| superdev-seo-pages | **Referência de arquitetura apenas** (SEO programático: 1 fonte de dados → N páginas) — inspira o motor de páginas de serviço/nicho | Proprietário ("all rights reserved") — não usar código |
| DataForSEO | Camada de dados: SERP/Local Pack, concorrentes, keywords, **LLM Mentions** (GEO) — alimenta Raio-X e dashboard | Pay-as-you-go (US$50 mín.); MCP oficial; orçar por uso |
| Paperclip | **Candidato** a control plane interno de operações não-código com vigilância AAA (gates, orçamento, rollback, multi-empresa) | MIT — v0.x, pilotar; consulta a fonte única de política |
| Multica | **Candidato** a control plane interno de trabalho de código (agentes de dev) | Open-source — v0.x, pilotar; consulta a fonte única de política |
| CartãoPro (interno) | **Base de componentes herdada:** motor de paleta (semente → JSON), barra inferior, salvar/trocar contato, bloco de mapa, **pipeline de governança de agente** (MCP → policy engine → executor; genérico multi-canal; §5.5) | Ativo próprio — portar para Next.js / reusar |

---

## 11. Roadmap

**Fase 0 — Fundação (semanas 1–2)**
**Marca decidida: SoulLocal** (agência) · site Next.js como **tenant zero no Trilho 2** (Supabase `facts`) + `CLAUDE.md` + política de privacidade · **widget Chatwoot no site com SDR desde o lançamento** · tabela `facts` (com `perecivel`/`revalidar_em`) + endpoint (Edge Function) · **landing do Quiz de Captação** · e-mail corporativo de fichas · contrato com cláusula LGPD · separação de credenciais de LLM (SoulLocal vs. BYO-cliente).

**Fase 1 — Motor do Raio-X (semanas 2–4)**
Pipeline n8n: Places (New) + SerpApi + Apify → **BrasilAPI (enriquecimento CNPJ — porte/sócios/situação, §3.1A)** → LLM (score, análise de reviews, teste de visibilidade em IA) → página web + PDF · ranking de priorização (nota alta + presença fraca + porte CNPJ = topo da fila) · simulação de custo real por lead · template visual SoulLocal.

**Fase 1.5 — Especificação e MVP do LBP (semanas 3–5)**
Cravar esqueleto (ordem de blocos + ~14 URLs) como componentes React fixos · **portar motor de paleta do CartãoPro** (semente → JSON → variáveis de estilo) · cardápio de fontes + regras de foto/logo · marcadores de assinatura SoulLocal · componente **Troca de Contato** (captura + vCard + escape + métrica + gatilho n8n) · 1 provedor de agenda plugável · camada agent-first (`.md`, llms.txt, JSON-LD por tipo profissional).

**Fase 2 — Aquisição Tijuca (meses 1–3)**
20–50 abordagens/dia em 1 nicho piloto · instrumentação completa · A/B de abertura · Mia interna multicanal (widget + WhatsApp, tool → /api/facts) · fluxo widget→qualificação→WhatsApp opt-in · **primeiros LBPs em produção** · meta: 5–10 clientes fundadores no Fluxo A do GBP.

**Fase 3 — Entrega e API oficial (meses 2–4)**
Chatwoot + Typebot em produção · automação de reviews (motor de frescor, §5.4) · primeiras Mias white-label (incluindo widget no site do cliente) · checklist de compliance por conselho para nichos regulados · pedido formal da Business Profile API (com carteira de fichas como lastro).

**Fase 3.5 — Agente de Conteúdo Autônomo (meses 3–5)**
Portar pipeline de governança do CartãoPro (MCP → policy engine → executor) para o canal LBP · calendário de contexto por nicho · níveis de autonomia A→B no policy engine · regras de vertical (conselhos) codificadas · human gate no dashboard · loop frescor↔WhatsApp instrumentado.

**Fase 4 — Plataforma (meses 4–7)**
Dashboard sobre boilerplate SaaS + Supabase · LBP multi-tenant com tokens de pele por tenant · Cloudflare for SaaS + onboarding de domínio via n8n · OAuth GBP (Fluxo B) · painel de edição da pele self-service (semente de cor, fonte, foto, logo) · BYO-LLM self-service (cliente pluga a própria chave; fallback genérico como padrão) · **componente de link tokenizado sem login** (primitiva transversal: acesso/aprovação/relatório) · **Relatório Dinâmico do cliente** (§9.4 — delta mês vs. mês, três camadas, modo "mês plano") · **painel Owner Success** (§9.3) + painel de escalações imprevistas (§5.5) · histórico mês a mês por tenant (par de comparação do delta).

**Fase 5 — Vertical turismo + short stays: Búzios (janela ago–out)**
Site da SoulLocal Búzios v1 (~18 páginas, §13) · Raio-X + Quiz versão turismo (OTA + TripAdvisor + trilíngue) · **variante LBP Short Stay** (página por imóvel + reserva direta + reviews OTA→Google, §6.12) · preset de quiz `short-stay-buzios` · LBP trilíngue com widget interceptador de reserva direta · mapa de 15 âncoras · visita presencial · **primeiro acordo de canal de indução** (§9.2.1 — associações/receptivo, com contrapartida formalizada e cadência ajustada à capacidade de onboarding) · template replicável (Paraty, Arraial, Ilha Grande, Cabo Frio).

---

## 12. KPIs

| Área | Métrica | Meta inicial |
|---|---|---|
| Aquisição | Taxa de resposta 1ª mensagem | ≥ 15% |
| Aquisição | Conversão lead→cliente | ~1% (calibrar 3 meses) |
| Canal de indução | Conversão lead indicado→cliente **vs. lead frio** | Esperado múltiplo do frio — medir o diferencial (§9.2.1) |
| Reviews | **Cobertura do pedido** (clientes atendidos que receberam convite) | 100% — qualquer valor abaixo sinaliza filtro (§5.1A/R1) |
| Reviews | Volume de avaliações novas/mês por cliente | Crescente (volume é a defesa da nota) |
| Reviews | **Distribuição de notas** (existência de cauda) | Monitorar — ausência de cauda com volume alto é sinal de gating |
| Reviews | Causas-raiz identificadas no diagnóstico de sentimento → corrigidas | Rastrear par ação↔efeito para a camada 2 do §9.4 |
| Canal de indução | Tempo até "no ar" de cliente indicado vs. frio | Menor (tese: menos atrito no Fluxo A do GBP) |
| Canal de indução | Parceiros ativos e clientes ativados por parceiro | Monitorar; cadência ≤ capacidade de onboarding |
| Operação | Follow-up pós-resposta | < 1h |
| Compliance | Processamento de opt-out | < 48h |
| Entrega | Reviews respondidos (clientes) | 100% |
| Entrega | Setup completo (LBP no ar) | ≤ 48h |
| Retenção | Churn mensal | < 5% |
| Receita | MRR mês 9 | R$ 18–20k |
| WhatsApp | Quality rating do número | Alto (verde) |
| Widget | Conversão visitante→conversa iniciada | ≥ 3% |
| Widget | Conversa widget→contato capturado (WhatsApp/e-mail) | ≥ 30% |
| LBP | Visitante→clique em "salvar" | ≥ 8% (calibrar) |
| LBP | Clique em salvar→Troca de Contato preenchida | ≥ 40% (calibrar) |
| LBP | Onboarding de cliente novo (só pele) | ≤ 1 dia útil |
| Frescor | Fatos perecíveis revalidados no prazo (`revalidar_em`) | ≥ 95% |
| Frescor | Atualizações de frescor por cliente/mês (posts, FAQ, fatos) | ≥ 4 |
| Agente | Propostas auto-aprovadas vs. human gate | Calibrar (subir com confiança) |
| Agente | Tempo médio de aprovação no human gate | < 24h |
| Agente | Propostas barradas pelo policy engine (compliance) | Monitorar (nicho regulado) |
| Agente | **Escalações imprevistas repetidas pelo mesmo motivo** (§5.5) | Tendência de **queda** (cada uma vira regra nova) |
| Relatório Dinâmico | Clientes que acessam o link/mês | Monitorar (proxy de confiança/engajamento) |
| Relatório Dinâmico | Indicadores exibidos com par mês-anterior (delta) | 100% (sem delta ≠ prova, §9.4) |
| GEO (sentido) | Crescimento de volume WhatsApp/ligação do cliente | Tendência de alta |
| GEO (sentido) | Leads que citam "IA/Google me indicou" ("como nos achou") | Crescente |
| GEO (técnico) | Menção de marca em IA — tendência (LLM Mentions, §7.6) | Crescente em 2–6 semanas |
| GEO (técnico) | Citação competitiva ("melhor X no bairro") | 3–6 meses |
| Geo-grid (§7.7) | Nós no top 3 — delta entre varredura inicial e final do mês | Tendência de alta; **par obrigatório**, nunca valor isolado |
| Geo-grid (§7.7) | Nós vermelhos entregues **com ação amarrada** ao lado | 100% (regra de entrega, não meta a perseguir) |
| Geo-grid (§7.7) | Custo real por Raio-X após lote piloto (~50 prospects) | Confirmar ≤ R$ 0,05; recalibrar variável por tenant se estourar |
| Geo-grid (§7.7) | Concorrente novo detectado → prazo até o cliente ser avisado | < 48h da varredura |
| Crescimento | **Capacidade de onboarding (clientes novos/mês sustentável)** | **Medir no piloto — a variável mais crítica do projeto (§9.2)** |
| Crescimento | Churn mensal real (vs. meta <5%) | Medir; alvo revisado 3% para viabilizar teto de 100+ |
| Owner Success | Cobertura: onboarding com colaborador acompanhando | 100% |
| Owner Success | Tempo de resposta a alerta de intervenção da gerência | < 24h |
| Owner Success | Sinais de "humor no chat" negativo tratados antes do churn | Monitorar (proxy de retenção) |
| Tenant Fantasma (piloto) | Reivindicações / páginas publicadas | Medir no lote piloto |
| Tenant Fantasma (piloto) | Reclamações/denúncias por lote | Monitorar (critério de decisão) |
| Tenant Fantasma (piloto) | Indexação normal no Google (sem sinalização de spam) | Confirmar antes de escalar |

---

## 13. Site da SoulLocal — Búzios v1 (tenant zero)

O site da agência tem missão dupla: **vender** e ser a **prova viva** do que vende (se a SoulLocal prega SEO+GEO e não aparece quando perguntam ao Gemini "agência de presença digital em Búzios", o pitch morre). Roda como **tenant zero no Trilho 2** (§7.5). Meta v1: conjunto mínimo já completo para SEO+GEO em Búzios — não explodir em páginas programáticas antes de provar tração.

**Camada 1 — Espinha institucional + conversão (5):** `/` (home) · `/sobre` (autoridade/E-E-A-T) · `/como-funciona` (Raio-X → 48h → mantido vivo) · `/perguntas-frequentes` (FAQPage) · `/diagnostico` (Raio-X como isca).

**Camada 2 — Uma página por produto (6):** `/ficha-viva` (LBP) · `/google-meu-negocio` (GBP) · `/avaliacoes-google` (reviews) · `/cartao-inteligente` (CartãoPro) · `/atendimento-ia` (Mia) · `/casos` (prova social).

**Camada 3 — Motor de GEO de Búzios (6+) — o diferencial:** `/short-stay-buzios` (prioritário) · `/reserva-direta-sem-ota-buzios` (ângulo matador) · `/pousadas-buzios` · `/restaurantes-buzios` · `/beach-clubs-buzios` · `/aparecer-no-chatgpt-buzios` (pilar educacional, altamente citável).

**Espinha de conversão:** a **landing do quiz** (§4.5) é o destino de todos os CTAs "descubra sua nota" — o hub onde tráfego (busca, IA, ads, portais) vira lead roteado.

**Camada invisível (obrigatória, não conta como página):** `.md` por página · `/llms.txt` · `sitemap.xml` · `robots.txt` liberando robôs de IA · JSON-LD por página (Organization + Service + FAQPage) · widget da Mia embutido (o site atendendo sozinho é a demonstração mais forte).

**Total v1: ~18 páginas visíveis** + camada invisível + quiz como espinha. **v2 (após tração):** hotéis boutique, passeios, blog recorrente e explosão programática (serviço × nicho × sub-região), gerada em escala pelo Agente de Conteúdo (§5.5).

**Gargalo real da v1:** não é montar as páginas (esqueleto em blocos é rápido) — é **escrever o conteúdo citável** (fatos com números, respostas diretas, ganchos por nicho), que exige o conhecimento do mercado de Búzios.

**Marca decidida:** **SoulLocal** (domínio `soullocal.com.br`, e-mails, nome do score — SoulLocal Score). Pré-requisito de lançamento restante: registro do domínio e configuração de e-mail corporativo, se ainda não feitos.

---

## 14. Pendências de detalhamento (a retomar)

Itens levantados e ainda não desenvolvidos — registrados para não se perderem:

- **P0 — Capacidade de onboarding/mês (a medir no piloto):** com os canais de entrada calibrados, essa passou a ser a variável que decide a velocidade de crescimento inteira (§9.2) — vai de 7 meses a 3+ anos até 100 assinantes dependendo só dela. Nenhum outro item desta lista é mais urgente.
- **Chatwoot (aprofundar):** já é o inbox omnichannel da Mia (§5.2, §7.1). Pendente: detalhar uso como serviço/produto — configuração multi-tenant de inboxes, Agent Bot API, papel no atendimento humano e no handoff, e se entra como item vendável ou componente de tier.
- **Evolution Go (revisitar status):** hoje o documento trata "Evolution API" como **somente testes — risco de ban, nunca no número principal** (§7.1). Verificar se "Evolution Go" é variante/versão distinta que muda esse quadro; definir papel exato e limites antes de qualquer uso em produção.
- **Gargalo de mão de obra (continuar):** desempacotado até o onboarding (mais automatizável). Falta o **human gate contínuo** — como encolher o volume de aprovações via autonomia por risco + confiança/lote no policy engine, e a relação com os control planes candidatos (§5.5).
- **Marca:** ✅ **resolvida — SoulLocal** é o nome da agência (este projeto). Domínio `soullocal.com.br`, score = **SoulLocal Score**.
- **Ecossistema de projetos:** ✅ mapa de fronteiras registrado em **§0** — SoulLocal/Hostse/Begoo são empresas do mesmo grupo, CNPJs e bases separados, sem restrição de domínio entre elas; reivindicação = migração real via API (Begoo→SoulLocal). **Restam duas perguntas em aberto:** (1) sobreposição de escopo entre o **Begoo** e o conceito de **TrueBz** (mesma iniciativa ou distintas?); (2) se o **Begoo consulta o policy engine da SoulLocal** para as regras que afetam a página fantasma, ou mantém o próprio — para não fragmentar a fonte única de política em nível de grupo (§0).
- **Nome definitivo da IA operacional:** "Mia" é provisório (Joi/Beca/Anna são do CartãoPro). Definir antes de qualquer material voltado ao cliente/white-label.
- **Documentação da camada de agente (a receber):** presets, configurações e fluxos n8n já validados — anexar ponta a ponta quando a equipe liberar o acesso. Até lá, o detalhe fica como placeholder; a camada é tratada como componente pronto, não a reprojetar.
- **Relatório Dinâmico — desenho de tela (a detalhar):** §9.4 crava a direção (link tokenizado, três camadas, delta como herói, modo "mês plano"). Falta o desenho concreto — quais indicadores entram no topo por vertical, como o delta é apresentado visualmente, e principalmente a mecânica do modo "mês plano" que mantém a honestidade sem soar como desculpa. Item mais difícil e mais diferenciador do desenho; priorizar.
- **PRD de Reviews — alinhar à §5.1A (v2.7):** o PRD de Reviews é documento próprio e precede esta política. Revisar para incorporar R1/R2/R3, o disparo automático sem pergunta prévia, e o diagnóstico de sentimento como entrega. Verificar se há qualquer menção a roteamento por nota ou a sugestão de conteúdo herdada de referência de concorrente.
- **Revisão do material de venda existente (v2.6):** a §6.1A muda o eixo retórico. Varrer Raio-X, Quiz, scripts de WhatsApp, site e PRDs, substituindo toda promessa de "ativo próprio"/"casa própria" pela formulação de aluguel-da-ferramenta. Material antigo em circulação contradiz a resposta honesta à objeção "e se eu parar de pagar?".
- **Domínio do cliente — operação da renovação (a definir):** quem paga e quem opera a renovação anual do `.com.br` registrado no CPF/CNPJ do cliente; o que acontece com a renovação se ele cancelar a assinatura (o domínio é dele — presumivelmente a responsabilidade passa a ser dele, mas isso precisa estar no contrato e ser comunicado no onboarding, não descoberto na expiração).
- **`begoo.guide` — confirmar registro e titularidade:** verificar disponibilidade/posse do domínio e registrá-lo sob o CNPJ do **Begoo** (não da SoulLocal), para preservar a fronteira da §0. Checar também se `buzios.guide` já é ativo do grupo — se for, decidir a relação entre os dois para não criar dois portais disputando o mesmo território.
- **Canal de indução — modelo de contrapartida (a definir antes do 1º acordo):** §9.2.1 crava o mecanismo e os candidatos. Falta decidir a forma de remuneração do indicador (comissão recorrente × valor fixo por cliente ativado × reciprocidade), o instrumento contratual, e verificar implicação de conselho quando o indicador é profissional regulado. Definir antes de abordar o primeiro parceiro — mudar o modelo depois de assinado é caro.
- **Geo-grid — lote piloto de validação de custo (v2.8):** rodar ~50 prospects reais antes de fixar a linha no variável por tenant. Duas incógnitas específicas: (1) quanto a cobrança **a cada 20 resultados** encarece o Raio-X do prospect fraco, que é a maioria da base e ranqueia justamente além da 20ª posição; (2) quais **parâmetros opcionais** são realmente necessários, já que cada um multiplica o custo por requisição. Só depois cravar os números da §7.7 no §9.1.
- **Geo-grid — cadência e densidade por tier (a definir):** a §7.7 assume 3×3 na prospecção e 7×7 quinzenal no Tier 3, mas os Tiers 1 e 2 estão indefinidos. Decidir se recebem varredura (e com que densidade/frequência) ou se a varredura é, ela própria, parte do que separa o Tier 3 — o que tem implicação direta no argumento de upgrade e na camada 1 do §9.4 para quem não é Tier 3.
- **Geo-grid — biblioteca de ações por padrão de fraqueza (a construir):** a regra de entrega da §7.7 ("nó sem ação ao lado não é publicado") só é operável se existir um repertório do que fazer para cada padrão observado (fraqueza concentrada num bairro, fraqueza em anel externo, perda de nós para concorrente novo). Sem isso, a regra vira gargalo humano em vez de disciplina. Candidata natural a virar preset do agente de conteúdo (§5.5).
- **Link tokenizado sem login — especificar como componente transversal:** hoje aparece em quatro usos (onboarding de acesso, aprovação de conteúdo pelo agente, aprovação do cliente via WhatsApp §5.5-C, Relatório Dinâmico §9.4). Especificar uma vez, geração/expiração/escopo de token, para não reimplementar por feature.
