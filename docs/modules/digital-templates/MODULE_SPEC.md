# Especificação candidata: Templates Digitais (`digital-templates`)

- **Versão:** 0.2, 20/10/2026.
- **Estado:** proposta, aguarda revisão; não registrada nem implementada.
- **Modelo de referência:** `module-templates/standard` 1.0.0 e contrato de módulos da base `29e47607410b360a7b9e594682ac185cabf30323`.
- **Origem:** solicitação de análise da migração do NextCRM para o GUIDU, com autoria exclusiva em plataforma.

## 1. Problema e limites

A plataforma precisa criar designs reutilizáveis, publicar versões confiáveis e disponibilizá-las a parceiros/clientes sem distribuir a ferramenta de autoria. O usuário final precisa receber o resultado e preencher seus dados sem alterar a identidade visual ou a estrutura do modelo.

O produto inclui dois níveis de autoria: editor de blocos, para construir sua árvore de elementos e campos; e editor de templates, para combinar blocos e montar a estrutura final. A plataforma pode criar composições diferentes, alterar hierarquia, ordem, layout e apresentação dentro do catálogo de elementos e das validações técnicas. Não existe uma composição obrigatória herdada do antigo perfil padrão. Hero, CTA, links, mapa, QR e rodapé são exemplos de biblioteca, não seções fixas impostas a todos os templates.

Conforme esclarecimento do solicitante em 20/10/2026, o plano anterior de Perfil digital usava outro projeto, sem esses editores. Ele oferece contexto de regras de negócio a revalidar. O construtor NextCRM é a base funcional de autoria; recuperar o motor smart do outro projeto é opcional e não condiciona essa migração.

`digital-templates` guarda catálogo, blocos, temas, documentos visuais, versões e regras de disponibilização. O módulo consumidor guarda os dados de negócio e o vínculo de uso. Inicialmente, `digital-profile` mantém unidades, perfis master/pessoais, dados pessoais e estado de publicação do perfil. Hosts, caminhos, mídia, auditoria e planos são serviços do núcleo.

Não haverá outro backend, iframe editorial, duplicação de autenticação nem acesso ao banco da origem durante a operação do GUIDU. O módulo terá exports separados `manifest.ts`, `client.ts` e `server.ts`. O editor não entra no bundle de consumo do app nem na página pública.

## 2. Quem usa e com quais permissões

### 2.1 Regras de produto

| Operação                                                 | Plataforma                                           | Admin/parceiro                                                 | App/workspace                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Criar, duplicar e editar design/bloco/tema               | Capacidade editorial específica                      | Não                                                            | Não                                                                           |
| Definir slots e validações de conteúdo                   | Capacidade editorial específica                      | Não                                                            | Não                                                                           |
| Publicar/arquivar versões e distribuir audiência         | Capacidade específica                                | Não                                                            | Não                                                                           |
| Consultar catálogo e prévia                              | Segundo permissão                                    | Só publicações disponibilizadas ao parceiro                    | Só publicações disponibilizadas ao workspace                                  |
| Escolher/atribuir modelo pronto                          | Segundo permissão de distribuição                    | Só se houver delegação explícita e escopo do cliente validado  | Owner/admin apenas se seleção for liberada; caso contrário, recebe atribuição |
| Atualizar vínculo para versão publicada                  | Operação autorizada, sem editar dados do cliente     | Mesmo limite da atribuição                                     | Mesmo limite da seleção                                                       |
| Editar dados pessoais/empresa/unidade                    | Não por ser autor de design                          | Conforme suporte/gerenciado ou permissão operacional explícita | Conforme regras de `digital-profile`/núcleo                                   |
| Alterar estrutura, CSS, cores, fontes ou tema no consumo | Somente no editor da plataforma, gerando nova versão | Não                                                            | Não                                                                           |

Esta proposta permite delegar seleção/atribuição de modelo pronto sem delegar autoria. O padrão inicial é a plataforma atribuir a versão; a delegação permanece desligada até decisão de produto e políticas de banco correspondentes. Atribuição não deve exigir abrir os dados pessoais do cliente ao distribuidor.

No modo gerenciado, continuam valendo as políticas de dados do GUIDU. Ele não concede escrita no catálogo global. Um autor global não recebe automaticamente acesso a um perfil real para testar o modelo.

### 2.2 Permissões propostas

As chaves de plataforma e parceiro entram no catálogo/matriz do núcleo. O manifesto atual concede defaults somente para papéis de workspace; não resolve papéis internos por `defaultWorkspaceRoles`.

| Chave proposta                          | Papéis padrão propostos                   | Finalidade                                                                             |
| --------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `platform.digital_templates.read`       | owner, operations; support só se aprovado | Ver catálogo editorial.                                                                |
| `platform.digital_templates.edit`       | owner, operations                         | Criar/editar rascunho, blocos e temas.                                                 |
| `platform.digital_templates.publish`    | owner, operations                         | Publicar e arquivar; capacidade separada da edição.                                    |
| `platform.digital_templates.distribute` | owner, operations                         | Gerir audiência e atribuições permitidas.                                              |
| `partner.digital_templates.read`        | partner_owner, partner_admin              | Ver catálogo recebido, sem rascunhos.                                                  |
| `partner.digital_templates.assign`      | Nenhum inicialmente                       | Distribuir versão pronta aos clientes autorizados; exige delegação explícita.          |
| `digital_templates.read`                | owner, admin, editor, viewer              | Consultar catálogo autorizado no workspace. Não modifica a restrição do attendant.     |
| `digital_templates.assign`              | Nenhum inicialmente                       | Aplicar modelo pronto se o produto liberar a escolha; opção por owner/admin a revisar. |

Os nomes e defaults são candidatos, não permissões existentes. Billing não recebe autoria. Attendant não ganha acesso às áreas de workspace por esse módulo. Uma futura edição do próprio perfil por attendant precisa de rota e decisão específicas, sem reabrir todas as áreas.

### 2.3 Autorização e estado

- Plataforma: identidade ativa, host da plataforma, MFA e política de IP existentes, papel interno ativo, capacidade específica, trava técnica e disponibilidade global. Executar por contexto de identidade, sem workspace fictício.
- Parceiro: resolver parceiro pelo host, vínculo ativo, permissão e audiência. Qualquer operação em workspace alheio exige caminho de delegação/operação aprovado; não aceitar `workspaceId` vindo do formulário como autorização.
- Workspace: contexto de empresa/workspace, permissão, contratação e estado do consumidor, cota e audiência da publicação. A manutenção ou suspensão deve ser revalidada também no serviço/job.
- Público: leitura estreita pelo consumidor e núcleo de endereços; sem sessão de editor e sem acesso amplo às tabelas globais.
- Uma mesma política atende página, action, API e job. A RLS repete os limites aplicáveis.

Não duplicar cobrança por registrar dois módulos: `digital-templates` é capacidade técnica de autoria/distribuição; o plano do consumidor governa perfis/uso. A especificação comercial deve dizer se haverá pacote comercial independente. O plano inicial não exige que o cliente compre um editor que não recebe.

## 3. Dados guardados

Nomes abaixo são conceituais e serão fechados em DT2. Catálogo global não usa `workspace_id = null` como caminho alternativo dentro de uma tabela operacional de clientes.

| Entidade proposta                   | Dono/escopo                     | Conteúdo e regra                                                                                             |
| ----------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `digital_template_models`           | Plataforma                      | Identidade estável, título, finalidade, categoria, estado e autoria.                                         |
| `digital_template_drafts`           | Plataforma                      | Documento mutável, revisão concorrente, autor e timestamps.                                                  |
| `digital_template_versions`         | Plataforma                      | Snapshot publicado imutável, número, hash, schema/renderer/tema, requisitos e assets.                        |
| `digital_template_blocks` e versões | Plataforma                      | Biblioteca de blocos; uso fixado na publicação ou incorporado por valor com proveniência.                    |
| `digital_template_themes` e versões | Plataforma                      | Presets de design; tokens resolvidos incorporados ao snapshot publicado.                                     |
| `digital_template_audiences`        | Plataforma                      | Elegibilidade global/parceiro/empresa/workspace e finalidade; referência a publicação, sem liberar rascunho. |
| Vínculo de consumo                  | Workspace, no módulo consumidor | Versão publicada, unidade/recurso, revisão anterior e trilha de atualização.                                 |
| Registro de assets                  | Núcleo de mídia                 | Dono plataforma ou cliente, estado, tipo, tamanho, hash e referências por versão/recurso.                    |
| Relatório de importação             | Plataforma                      | Proveniência, hashes, mapeamento, alertas, status e resultado idempotente.                                   |

Não duplicar o vínculo em duas tabelas que disputem a verdade. Para Perfil digital, a versão fica no vínculo/template da unidade, sujeito a uma única versão ativa por unidade. Outro consumidor terá vínculo próprio pelo mesmo contrato.

Dados do funcionário, leads, credenciais, contatos e endereços não entram no JSON global. Dados de exemplo são sintéticos. O documento global pode conter nome/logotipo específico de empresa apenas quando o modelo for restrito à audiência correta e o tratamento tiver sido autorizado; preferir bindings de dados para evitar publicar conteúdo privado no catálogo.

Tabelas de cliente usam `workspace_id NOT NULL`, identidade da empresa e FKs compostas para pai/workspace. O desenho de tabelas globais e audiência é explícito, com RLS e grants mínimos; não se aplica a elas artificialmente uma FK de workspace inexistente.

## 4. Documento, renderer e ações

### 4.1 Contrato do documento

Campos conceituais: `schemaVersion`, versão mínima do renderer, finalidade, metadados, árvore de elementos/blocos, tema resolvido e sua versão de regras, bindings tipados, slots de conteúdo, referências a assets e requisitos de integração. Publicação recebe número e hash gerados no servidor.

O schema valida tipos/propriedades, limites de bytes/nós/profundidade, IDs únicos, nesting permitido, referências internas, integridade dos campos, permissões dos bindings e URLs. Valores numéricos/tokens/CSS seguem allowlist. Defaults são determinísticos. Zod e helpers puros não importam configuração que carrega React ou código de servidor.

Os 16 tipos do inventário têm conversores e testes. `List` e `Column`, mencionados em configurações antigas mas fora da união validada da origem, entram como incompatibilidade a esclarecer, não como promessa de suporte já existente.

### 4.2 Renderer e bindings

O renderer é comum à prévia, ao resultado autenticado e ao público. Recebe apenas documento validado e dados do contrato público. Não importa Prisma, sessão, ações editoriais ou header do painel. Seleção, outlines, DnD e dados de exemplo pertencem à camada do editor.

Bindings são IDs de campos de catálogo tipado, não expressões arbitrárias, caminhos livres de objeto ou código executável. Campos vazios usam regra de conteúdo aprovada, sem conceder ao app opção de ocultar estrutura. Coleções têm projeção e limite, não acesso genérico ao CRM/Portfólio/equipe. O catálogo antigo de redes pessoais não expande a lista de campos permitida no plano de Perfil digital.

São dados editáveis pelo usuário somente os permitidos pelo consumidor. Para Perfil digital, a lista anterior de foto, nome, cargo, telefone, e-mail e LinkedIn pessoal é uma proposta de política de dados a revalidar na DP0; ela não define os tipos de bloco nem limita o que a plataforma pode montar. Campos de conteúdo adicionais precisam de catálogo, validação e autorização próprios. Nome/logo/endereço de negócio podem vir do cadastro da empresa/unidade por binding. Trocar imagem de conteúdo permitida não libera tamanho, fonte, cor, posição ou CSS.

### 4.3 Publicação e atualização

1. Criar/editar rascunho com revisão esperada; conflito não sobrescreve o trabalho de outro autor.
2. Validar documento, bindings, assets, acessibilidade, finalidade e requisitos de integração.
3. Mostrar prévia com dados sintéticos e relatório de impacto/compatibilidade.
4. Publicar atomicamente snapshot imutável e registrar auditoria na mesma transação.
5. Tornar a publicação elegível para audiências aprovadas.
6. Atribuir uma versão específica a unidade/recurso, validando cota/estado e escopo.
7. Para atualizar, criar prévia/diff e migrar valores compatíveis dos slots. Mudança incompatível exige mapeamento explícito ou impede atualização.
8. Registrar versão anterior e permitir rollback do vínculo. Se slots/dados também mudaram, preservar snapshot ou migração reversível, sem perder valores silenciosamente.

Publicar versão 2 não altera usos da versão 1. Editar bloco ou tema reutilizado também não altera publicações existentes. Arquivar impede novas atribuições e preserva usos e rollback. Despublicar um perfil é ação do consumidor, diferente de arquivar um modelo.

Bloqueio emergencial de uma versão é operação distinta, restrita e auditada. Deve invalidar cache e ter comportamento público e comunicação definidos; não apagar dados. Suspensão contratual permite leitura autenticada conforme núcleo, mas continuidade do público depende de decisão explícita de produto, não inferida do guard de página.

### 4.4 Integrações avançadas

- QR e vCard usam dados públicos mínimos e geração com escape; o QR acompanha o endereço canônico do núcleo.
- Carousel aceita itens manuais e coleções aprovadas; sem placeholder fingindo conteúdo real.
- Maps usa configuração da plataforma e chaves públicas restritas quando necessárias; dados de unidade são projetados, scripts/carregamentos seguem política e consentimento aplicáveis.
- Formulário é renderizado a partir do schema da versão; servidor revalida campos, perfil publicado, audiência, destino e limites. O cliente não escolhe workspace ou dono do lead.
- CRM registra origem e prova de consentimento no serviço apropriado; validar a mudança necessária no `createdBy` atual sem uma liberação genérica de escrita anônima.
- E-mail e webhook são efeitos assíncronos por jobs/eventos do núcleo, com idempotência, timeout, tentativas e trilha. Webhook usa conexão/referência validada, bloqueio de destinos internos e política de redirecionamentos; nenhum segredo vai no documento.
- CAPTCHA v2/v3 exige validação no servidor. Não basta desenhar o controle na prévia.
- Conversão usa eventos/pixels aprovados e configuração tipada; não executa `conversionScript` arbitrário importado. HTML rico e CSS têm política estrita e saneamento consistente no servidor/público. Campos legados não suportados geram relatório explícito.

## 5. Conexões, mídia e dependências

Escolher o provedor de mídia na F5e antes de declarar upload completo. Upload da origem é real, mas será substituído pelo adapter do GUIDU, sem copiar chaves, bucket, permissões ou prefixo `shared`.

Mídia de rascunho é privada; publicação cria/autoriza derivados públicos adequados. Validar assinatura real do arquivo, tamanho, dimensão e tipo; tratar SVG e HTML explicitamente, preferindo rejeição/normalização controlada. Crop/transformação geram objetos rastreáveis. Excluir a imagem do editor não apaga um asset ainda referenciado por publicação ou rollback.

Fontes, ícones e imagens precisam de origem e licença verificadas. Servir fontes pelo próprio produto conforme planejamento de Perfil digital. Dependências editoriais são carregadas sob demanda na plataforma; não transplantar o `package.json` completo.

## 6. Configuração, limites e consumo

| Escopo     | Configuração proposta                                                            | Regra                                                                          |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Plataforma | Trava de lançamento, política de publicação, tipos de arquivo e limites técnicos | Schema tipado; sem segredo.                                                    |
| Plataforma | Audiência/finalidade de cada publicação                                          | Tabela de domínio, não configuração livre em JSON do módulo.                   |
| Parceiro   | Nenhum ajuste de design                                                          | Recebe catálogo; eventual delegação de atribuição é permissão, não cor ou CSS. |
| Workspace  | Versão recebida e dados permitidos no consumidor                                 | Sem árvore editável nem tokens visuais.                                        |
| Plano      | Perfis, recursos/vínculos, arquivos, submissões e recursos avançados contratados | Números do Comercial; nenhuma quota inventada nesta proposta.                  |

Limites técnicos de JSON/árvore, tamanho e integrações são validados antes da publicação. Cotas operacionais são verificadas na transação que cria/reserva o recurso, inclusive concorrência. Modelos globais não consomem automaticamente a cota de perfil/template do cliente. O perfil master segue a regra comercial já proposta de não contar na cota de perfis, se confirmada na revisão.

## 7. Rotas, manifesto e integrações com o núcleo

- Autoria candidata: `/platform/digital-templates`, com biblioteca, temas e revisões dentro do namespace. Editor abre em `WorkbenchLayout`; não criar shell paralelo.
- Manifesto atual: `destination: "admin"` representa `/platform`. Registrar `digital-templates` e navegação com permissões do núcleo; páginas reais precisam existir.
- Parceiro: catálogo recebido em `/admin/digital-templates`, integrado à navegação específica do parceiro. Não chamar esse destino de `admin` no manifesto atual. Se houver decisão de generalizar destinos, fazer ADR e versão de contrato próprias.
- App: consumo pode ficar na tela de Perfil digital, evitando dois menus para a mesma tarefa; catálogo independente só se houver caso de uso aprovado.
- Público: o módulo de templates não cria URL pública autônoma. `digital-profile` resolve host/endereço e chama renderer. ADR e extensão do contrato público continuam necessárias na DP0/CF2e.
- Serviços internos propostos: obter catálogo autorizado; obter documento publicado permitido; validar documento; publicar versão; atribuir/trocar versão; renderizar com dados autorizados; validar/normalizar pacote de importação.

MCP/API não são exposição automática do editor. A primeira entrega pode usar serviços internos e actions. Quando forem necessárias, interfaces externas terão schemas, escopos, idempotência e guards equivalentes; ferramentas administrativas genéricas não fazem parte desta proposta.

## 8. Exportação, exclusão, retenção e recuperação

- Export do cliente inclui vínculo/versionamento e seus dados/assets autorizados; não inclui rascunhos, modelos exclusivos de outro público ou bibliotecas internas completas.
- Backup operacional da plataforma preserva documentos publicados necessários, histórico e manifesto de assets, independentemente da restrição de export do cliente.
- Exclusão de workspace retira perfis do ar, invalida caches, encerra vínculos/jobs e trata dados e objetos pela política de retenção. Não exclui modelo global usado por outros clientes.
- Auditoria guarda metadados e hashes adequados, evitando conteúdo pessoal e segredos desnecessários; retenções jurídicas/comerciais permanecem a definir.
- Restore é testado em ambiente isolado com banco e objetos. Reaplicar exclusões, revogações e bloqueios posteriores ao backup antes de voltar a servir.
- Rebaixamento de plano e fim da disponibilidade não apagam recursos implicitamente. Documentar leitura, publicação pública e novas atribuições em cada transição.

## 9. Eventos e jobs

Eventos propostos, a registrar no catálogo do núcleo: publicação, versão disponibilizada, atribuição/troca, falha de importação, falha de formulário/webhook e bloqueio emergencial. Incluir público/escopo e metadados mínimos, sem documento completo ou PII por padrão.

Jobs somente para importações grandes, processamento de mídia, atualização em lote autorizada, agregação de métricas e entregas externas. Revalidar autorização/estado antes do efeito, não guardar token do usuário no payload e garantir idempotência.

## 10. Critérios de aceite

O [plano de implantação](plano-de-implantacao.md) define etapas e matriz verificável. Nenhuma conclusão de migração completa ocorre antes de: paridade dos 16 tipos, publicação e imutabilidade, consumo sem autoria, mídia real, renderer público, isolamento, integração de dados, importação reconciliada, rollback e piloto.

Os valores de quota, políticas de retenção, continuidade pública na suspensão e seleção delegada são decisões pendentes com defaults explicitados; não serão preenchidos silenciosamente na implementação.

## 11. Histórico

| Versão | Data       | Mudança                                                                                                               |
| ------ | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| 0.1    | 20/10/2026 | Especificação candidata para autoria em plataforma e consumo por versões.                                             |
| 0.2    | 20/10/2026 | Explicitados editor de blocos e montagem de estruturas por template; plano antigo mantido como referência de domínio. |
