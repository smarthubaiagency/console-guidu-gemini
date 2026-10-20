# Viabilidade de Templates Digitais como módulo do GUIDU

- **Versão:** 0.1, 20/10/2026.
- **Estado:** análise e recomendações; não substitui decisões aceitas sem revisão.
- **Base do GUIDU:** `29e47607410b360a7b9e594682ac185cabf30323`.
- **Base da origem:** worktree local de `linkkotech/nextcrm-primeiro`, branch `develop`, HEAD `5875e03744a847ee73f9af01dcded46989fbdcc1`, com mudanças não commitadas.

## 1. Contexto, objetivo e método

O objetivo é levar biblioteca de templates e blocos, editor visual, temas, campos dinâmicos, prévia e ciclo de uso para o GUIDU, mantendo o design sob autoria exclusiva da plataforma. `/admin` é o console do parceiro; `/app` é o produto do cliente. Esses nomes têm significado diferente do `/admin` do NextCRM, que hoje contém o editor.

A análise combina leitura estática de componentes, schemas, ações, modelos e testes da origem com o contrato de módulos, código de autorização, registro e planos do GUIDU. As referências do destino são da base indicada no topo. As linhas de origem citadas são do worktree observado, não uma garantia de que o HEAD remoto contém as alterações locais.

Não houve acesso ao banco da origem ou do destino, inventário real de objetos de Storage, execução de aplicação, teste de carga ou prova visual. Portanto, a viabilidade arquitetural pode ser avaliada, mas integridade dos dados existentes, disponibilidade dos arquivos e equivalência funcional ainda precisam das etapas de prova.

## 2. Parecer

| Dimensão                        | Avaliação                   | Condição para concluir                                                                          |
| ------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| Stack                           | Favorável                   | Adaptar dependências e validações; projetos usam Next.js, React, TypeScript, Prisma e Tailwind. |
| Modularização                   | Favorável                   | Extrair domínio e renderer; substituir imports e serviços acoplados ao NextCRM.                 |
| Autoria exclusiva na plataforma | Favorável                   | Novas permissões e políticas no servidor/banco; não basta esconder controles.                   |
| Editor visual                   | Reaproveitamento relevante  | Preservar comportamento útil, adaptar shell e gaveta e corrigir dados e persistência.           |
| Publicação de ponta a ponta     | Exige desenvolvimento       | A origem ainda separa a prévia do renderer público e tem publicação incompleta.                 |
| Segurança e isolamento          | Exige adaptação substancial | Usar contexto, guards, RLS, visibilidade e versões do GUIDU.                                    |
| Importação de templates/dados   | Condicional                 | Exige snapshot reprodutível, amostra real autorizada, arquivos e conversor.                     |
| Operação completa               | Condicional                 | Resolver Storage, endereços públicos, unidades, backup e piloto.                                |

O caminho recomendado é um módulo nativo `digital-templates`, com serviços públicos internos consumidos por `digital-profile`. Um serviço separado ou iframe aumentaria a complexidade de identidade, publicação, permissões e operação sem um requisito atual que o justifique.

Autoria central reduz a quantidade de papéis que podem modificar o design. Em contrapartida, cria uma fila operacional de criação e revisão na plataforma. Esse custo precisa de responsáveis, fluxo de solicitação, biblioteca reutilizável e medição de tempo de atendimento. Não se deve liberar um editor ao parceiro como solução informal para essa fila.

## 3. Inventário da origem e destino de cada parte

| Componente da origem    | Evidência                                                                                                      | Situação observada                                                                            | Tratamento proposto                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Catálogo de templates   | `src/components/admin/templates/TemplatesPageClient.tsx`, `TemplateCard.tsx`, `src/types/template.ts`          | Listagem e operações distribuídas por componentes/ações.                                      | Adaptar para catálogo de autoria em plataforma e DTO de consumo separado.                    |
| Montagem de template    | `src/components/admin/templates/TemplateBuilderClient.tsx`                                                     | Conteúdo, design, blocos e prévia; persistência parcial.                                      | Preservar experiência útil, integrar gaveta, estado e salvamento consistente.                |
| Editor de bloco         | `src/components/admin/templates/editor/BlockEditorClient.tsx`, `Inspector.tsx`, `StructureTreeView.tsx`        | Árvore, seleção e propriedades.                                                               | Extrair domínio; adaptar UI ao padrão do GUIDU.                                              |
| Controles e formulários | `src/components/admin/editor/controls/`, `src/config/editor/element-definitions.ts`                            | Controles configuráveis e campos avançados.                                                   | Separar definições puras de componentes React e validar todas as propriedades no servidor.   |
| Schemas de conteúdo     | `src/schemas/editor.schemas.ts`, `src/schemas/blocks/`                                                         | Árvore JSON, metadados e formatos legados.                                                    | Schema canônico versionado em Zod 4 e normalizador explícito.                                |
| Mutação de árvore       | `src/lib/editor/tree-mutations.ts`, `element-helpers.ts`, `nesting-rules.ts`                                   | Helpers de clonagem e estrutura.                                                              | Reaproveitar funções puras após corrigir referências, IDs e casos de borda.                  |
| Hero e rodapé           | `src/lib/editor/factories/hero-premium.ts`, `footer-premium.ts`, `block-detection.ts`                          | Blocos de composição e identificação semântica.                                               | Converter para catálogo versionado, sem depender do banco de origem.                         |
| Variáveis dinâmicas     | `src/config/editor/data-variables.ts`, `field-discovery.ts`, `tree-field-utils.ts`                             | Catálogo amplo, placeholders e campos configuráveis.                                          | Criar bindings tipados com fornecedores autorizados; não expor todo objeto de usuário.       |
| Temas                   | `src/services/theme.actions.ts`, `src/components/admin/templates/themes/`, `theme-variables.ts`                | CRUD e editor; ligação ao template ainda usa presets de exemplo.                              | Publicar tema resolvido junto da versão; manter editor de tema só em plataforma.             |
| Prévia                  | `src/components/admin/templates/preview/LivePreview.tsx`, `editor/EditorElementPreview.tsx`                    | Renderização da árvore com seleção/interação próprias de editor.                              | Extrair renderer seguro compartilhado; controles de seleção ficam em camada de edição.       |
| Perfil público          | `src/components/public-profile/ProfileRenderer.tsx:10-63`                                                      | Layout básico separado; não aplica a árvore do template.                                      | Implementar integração com renderer comum no consumidor `digital-profile`.                   |
| Captura de lead         | `src/services/public-profile.actions.ts`, `LeadCaptureForm.tsx`                                                | Fluxo básico para contato; sem contrato completo do destino.                                  | Integrar serviço público do CRM, origem/consentimento e proteção contra abuso.               |
| Arquivos                | `src/components/admin/editor/controls/ImageUploadControl.tsx:192-244`, `src/services/upload.actions.ts:48-143` | Upload e crop reais, com envio ao Supabase; o comentário TODO do controle está desatualizado. | Substituir adapter por mídia do GUIDU; não copiar credenciais, bucket ou política de acesso. |
| Persistência            | `src/services/template.actions.ts`, `template-block.actions.ts`, `src/lib/actions/template.actions.ts`         | Ações paralelas com regras e respostas diferentes.                                            | Uma camada de serviços; páginas, ações e futuras APIs chamam a mesma política.               |
| Modelos de banco        | `prisma/schema.prisma`: `DigitalTemplate`, `TemplateBlock`, `ThemePreset`, `DigitalProfile`, `Unit`            | Global e workspace misturados por `workspaceId` opcional; perfis e unidades acoplados.        | Separar autoria global, audiência, vínculos operacionais e dados de perfil.                  |
| Testes e scripts        | `src/lib/editor/__tests__/`, `scripts/*block*`, `scripts/*template*`                                           | Existem testes de helpers e scripts diagnósticos; não demonstram aceite completo.             | Converter cenários relevantes em testes determinísticos sem banco da origem.                 |

### 3.1 Paridade dos elementos e controles

O catálogo do schema tem 16 tipos: `Section`, `Container`, `Div`, `Heading`, `Text`, `RichText`, `Button`, `Image`, `Avatar`, `Icon`, `QRCode`, `IconPlus`, `MiniCard`, `Carousel`, `GoogleMaps` e `CustomForm`.

Cada tipo precisa de cenário de importação, validação, edição, salvamento/reabertura, prévia e saída pública. Hero e rodapé são composições, não novos tipos de elemento. Paridade inclui ordem, visibilidade, tamanhos, espaçamento, bordas, fundos, tipografia, ícones, estados e comportamento responsivo efetivamente suportado.

Nem todo campo presente no schema corresponde a comportamento final implementado. Em especial, variáveis dinâmicas, coleções, mapas, formulários, vCard e ações precisam de prova funcional fora do editor. Campos para webhook, CAPTCHA, e-mail e redirecionamento não provam que a integração exista.

O inventário avançado inclui Carousel manual e coleções `profile.socials`, `profile.team`, `profile.products` e `profile.units`; Maps com marcadores e estilo; QR/vCard; links de telefone, e-mail, WhatsApp, redes e PIX; CustomForm com webhook, redirecionamento, e-mail, reCAPTCHA e campo de conversão; e CSS/classes/identificadores declarados. As coleções aparecem no catálogo, mas a resolução pública real não está demonstrada. `CustomFormPreview.tsx:121-123` impede envio; o `captureLead` público é outro fluxo e não executa a configuração genérica do formulário. `customCss` e `cssId` não tiveram aplicação localizada no pipeline auditado. O GUIDU precisa implementar equivalentes suportados ou relatar incompatibilidade explícita, sem executar código arbitrário importado.

`List` em `src/config/editor-elements.ts` e `Column` em `element-definitions.ts` são menções fora da união validada dos 16 tipos. Não são considerados suporte funcional comprovado. O upload, ao contrário, é real: o serviço envia ao bucket `uploads`, aceita tipos declarados e limite de 5 MB e usa prefixo de workspace ou `shared`; essa política não deve ser transportada ao GUIDU.

O construtor de campos editáveis é ferramenta da plataforma. No novo modelo ele define slots de conteúdo autorizados, não uma forma de o app ganhar campos para alterar cor, CSS, espaçamento, visibilidade estrutural ou tipo do elemento. Qualquer capacidade adiada precisa constar no relatório de paridade; um primeiro recorte não encerra a migração completa.

## 4. Lacunas concretas que mudam o esforço

1. **Publicação incompleta.** `TemplateBuilderClient.tsx:332-335` contém TODO de publicação. É necessário ciclo rascunho → validação → versão publicada → distribuição → uso.
2. **Ordem e ativação locais.** Os handlers em `TemplateBuilderClient.tsx:84-95` alteram estado e ainda indicam persistência pendente. Salvar design não prova que a lista de blocos foi salva.
3. **Prévia e público divergem.** `ProfileRenderer.tsx:10-63` monta layout fixo enquanto a prévia usa `EditorElementPreview`. Reutilizar o renderer do editor sem extrair seleção, mocks e dependências também não resolve a saída pública.
4. **Autorização desigual.** `src/services/template.actions.ts:124-139` atualiza design após autenticação, sem demonstrar autorização de papel/escopo naquela função. Outras ações contêm regras diferentes. Reescrever acesso usando o padrão do destino.
5. **Clonagem não confiável de ponta a ponta.** `src/lib/actions/template.actions.ts:316` copia configuração do template sem clonar seus blocos. `template-block.actions.ts:532-575` duplica bloco com autenticação insuficiente e ordenação fracionária, enquanto `TemplateBlock.sortOrder` é inteiro.
6. **Referências internas na cópia.** `addBlockToTemplate` copia `content` preservando identificadores. Helpers de árvore têm caminhos distintos para campos na raiz e por elemento. Um clone deve remapear IDs de nós e referências de campos em uma única passagem validada.
7. **Mais de um formato de conteúdo.** Há conteúdo legado, árvore atual e campos editáveis na raiz/por elemento. Um importador precisa identificar versão, normalizar e relatar perda ou rejeição; não fazer cast de JSON.
8. **Temas de exemplo no fluxo.** `TemplateDesignTab.tsx:9-13` importa `mock-themes`; seu efeito de inicialização pode substituir variáveis por um preset. O GUIDU precisa preservar sobrescritas, referenciar versões e resolver tokens sem mutação silenciosa.
9. **Bindings ainda demonstrativos.** O catálogo contém mais dados pessoais que os seis campos previstos no plano de Perfil digital. A migração do motor não autoriza automaticamente ampliar os dados públicos.
10. **Fluxos externos parciais.** O preview do formulário impede envio; mocks e placeholders não devem chegar ao produto como integração funcional.
11. **Contagem de visitas acoplada à leitura.** `getProfileBySlug` incrementa `views` e é chamado tanto por metadados quanto pela página pública (`src/app/[locale]/p/[slug]/page.tsx:13` e `:29`). Há risco de contabilizar leituras técnicas/duplicadas; separar leitura pública de evento de visita. O efeito não foi reproduzido nesta análise estática.

Esses achados são evidências estáticas. A fase de prova deve reproduzir os defeitos relevantes e medir a compatibilidade antes de estimar reaproveitamento em percentuais.

## 5. O GUIDU já oferece e o que ainda falta

| Área                      | Estado verificado na base                                                                | Implicação                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Contrato e registro       | `src/core/module-contracts/manifest.ts`, `validate.ts`, `src/modules/registry.ts`        | Registrar novo módulo; respeitar namespace de rotas/permissões e exports client/server.                           |
| Destinos do manifesto     | `app` e `admin`; `admin` significa `/platform` por compatibilidade da ADR 0012           | A autoria em plataforma não exige inventar outro destino. `/admin` parceiro não está representado por esse valor. |
| Autorização da plataforma | `requirePlatformAdminPage`, `requirePlatformPermission`, contexto de identidade e matriz | Não fabricar workspace para editar catálogo global. Guard de página não substitui serviço e RLS.                  |
| Estado e contratação      | `src/core/module-runtime/state.ts` já trata contratação e suspensão                      | README de módulos ainda menciona F3 pendente; código atual deve embasar testes de estado.                         |
| Contexto de dados         | Prisma e transações contextualizadas; RLS; papéis ativos                                 | Não trazer acesso Prisma/Supabase direto da origem.                                                               |
| Parceiro e gerenciado     | ADRs 0012/0020 e guards existentes                                                       | Ser parceiro não abre automaticamente os dados dos clientes nem concede autoria de design.                        |
| Domínios/hosts            | CF2c construída, usada pelo plano de Perfil digital                                      | Reaproveitar resolução do núcleo, sem copiar `/p/[slug]`.                                                         |
| Endereços/caminhos        | CF2e é plano, ainda não uma capacidade pronta na base                                    | Dependência de publicação pública, com slug/histórico/carência/redirect.                                          |
| Unidades/finalidades      | CF2d é plano                                                                             | Integrar cadastros existentes; não importar tabela `Unit` paralela.                                               |
| Storage completo          | F5e aguarda escolha entre Supabase Storage e Cloudflare R2                               | Provedor, políticas, custo e recuperação são decisão pendente; motor pode avançar com fixtures.                   |
| Perfil digital            | Há planejamento, mas não módulo registrado                                               | Construção do consumidor faz parte do caminho completo; não presumir módulo pronto.                               |
| UI                        | Shell, componentes modelo, gaveta e `useStatus`                                          | Adaptar UI; não copiar cabeçalho, sidebar, `confirm()` ou resultados por toast da origem.                         |

## 6. Mudanças de produto necessárias

O [plano atual de Perfil digital](../perfil-digital/plano-perfil-digital.md) prevê modelos criados pela plataforma ou parceiro, design smart no workspace e editor gerenciado no parceiro, com `/platform` depois. A proposta deste conjunto exige revisão explícita das decisões 8, 9, 10, 11 e 14 e da etapa DP3, além das seções de motor e cronograma.

| Tema                       | Plano existente                               | Proposta desta análise                                                                                 |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Autor dos modelos          | Plataforma e parceiro                         | Só plataforma.                                                                                         |
| Controles de design no app | Cores-semente, fonte, logo/capa no modo smart | Sem controles de design; dados e mídias de conteúdo somente nos slots permitidos.                      |
| Editor completo            | Parceiro, em DP3                              | Plataforma desde a primeira entrega de autoria.                                                        |
| Relação modelo/unidade     | Cópia editável por unidade                    | Vínculo a versão imutável e dados separados; sem cópia de design editável pelo workspace.              |
| Modelos do parceiro        | Parceiro pode criar                           | Plataforma pode preparar modelo exclusivo de um parceiro; ele recebe, sem autoria.                     |
| Atualizações               | Modelo alterado não muda cópias               | Versão nova não muda vínculos; atualização explícita, com prévia e rollback.                           |
| Motor de design            | Reaproveitamento do legado CartãoPRO          | Avaliar integração do motor de cores desse legado com o editor NextCRM, sem dois motores concorrentes. |

As decisões de unidade, perfil master, campos pessoais, CRM e endereços podem ser preservadas. Sua implementação continua necessária. O modo de serviço gerenciado define quem pode operar dados do cliente; não desbloqueia o editor de design.

## 7. Alternativas avaliadas

| Alternativa                                                | Avaliação                                                                                                                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Módulo nativo com autoria plataforma e consumidor separado | Recomendado. Reutiliza autorização, banco, UI, operação e contratos do GUIDU.                                                                                               |
| Tudo dentro de `digital-profile`                           | Viável se o editor nunca atender outro consumidor. A separação proposta evita misturar perfis pessoais com catálogo global e favorece reuso sem exigir pacote independente. |
| Editor externo/iframe                                      | Adiciona identidade entre aplicações, comunicação e operação; não elimina a necessidade de integração segura. Não recomendado no escopo atual.                              |
| Copiar páginas e ações da origem                           | Alto risco de herdar permissões divergentes, mocks, dependência de contexto e duplicação de UI. Rejeitado.                                                                  |
| Autor em todos os níveis com controles ocultos             | Contraria a política avaliada e não restringe chamadas diretas. Rejeitado.                                                                                                  |

## 8. Riscos e mitigação

| Risco                                          | Impacto                                                      | Mitigação e evidência exigida                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Worktree da origem não reprodutível            | Trazer versões incompatíveis ou perder melhorias locais      | Snapshot autorizado com hashes, lista de arquivos e tratamento das mudanças locais em DT0; não commitar mudanças alheias. |
| Dados/arquivos não disponíveis                 | Modelos importados vazios ou com mídia quebrada              | Inventário real de banco e objetos, amostra exportada autorizada, checksum e validação de referência.                     |
| Política nova conflita com planos antigos      | Construção de dois editores ou responsabilidades divergentes | Revisão documental rastreável antes da implementação das regras afetadas.                                                 |
| Edição global usada para ler dados de clientes | Violação de isolamento                                       | Prévia com dados fictícios por padrão; dado real somente por acesso válido separado, com auditoria.                       |
| Vazamento de audiência ou cache                | Modelo exclusivo de parceiro/empresa exposto                 | RLS, DTO reduzido, cache por audiência/versão/workspace e teste com dois parceiros.                                       |
| Atualização em massa quebra páginas            | Impacto simultâneo em clientes                               | Versões fixadas, diff, compatibilidade de slots, piloto, lotes idempotentes e rollback por vínculo.                       |
| Templates contêm HTML/CSS/URL perigosa         | Injeção, navegação ou carregamento indevido                  | Schema estrito, política de sanitização/CSP, URLs tipadas e CSS restrito; nunca executar script arbitrário.               |
| Mídia removida ainda em uso                    | Quebra de publicação e rollback                              | Referências por versão, retenção, coleta após ausência de usos e backup de objetos.                                       |
| Escopo inclui recursos apenas demonstrativos   | Prazo subestimado                                            | Matriz dos 16 tipos e integrações; marcar implementado, parcial ou não entregue por cenário.                              |
| Fila de autoria central                        | Atraso para clientes e parceiros                             | Modelos base, duplicação confiável, briefing e responsável de publicação; medir fila durante piloto.                      |
| Dependências e licenças                        | Impedimento de redistribuição                                | Rastrear origem do código, autorização conforme ADR 0007 e licença de fontes, ícones, imagens e bibliotecas.              |

## 9. Conclusão de viabilidade e limites

A arquitetura comporta o modelo proposto sem introduzir outro backend. O maior trabalho está em completar publicação/renderização, sanear contratos e compatibilizar a política de autoria com o Perfil digital planejado. A fonte reduz o esforço de construir o editor, mas não substitui os serviços e garantias do destino.

A recomendação é avançar primeiro com decisões e uma prova de motor/renderer usando fixtures, depois autoria persistente e distribuição e, por último, completar o fluxo público e o piloto. Não há evidência suficiente para prometer percentual de reaproveitamento, migração automática de todos os dados ou data de produção nesta etapa.

A busca na origem não localizou LICENSE/COPYING nem campo license no package.json. Registrar titularidade e autorização de reaproveitamento antes da extração e inventariar licenças das versões efetivamente usadas, inclusive fontes e imagens. Essa ausência não foi tratada como conclusão sobre a titularidade do projeto.

## 10. Referências

- [Contexto do GUIDU](../../context.md), [especificação](../../spec/especificacao-v1.0.md) e [adendo de módulos](../../spec/adendo-modulos-v1.1.md).
- [Contrato de módulos](../README.md), [modelo padrão](../../../module-templates/standard/README.md) e [manifesto atual](../../../src/core/module-contracts/manifest.ts).
- [ADR 0007: isolamento e reaproveitamento](../../adr/0007-isolamento-do-projeto.md), [ADR 0012: níveis e parceiros](../../adr/0012-plataforma-de-parceiros.md) e [ADR 0020: serviço gerenciado](../../adr/0020-modo-de-servico-gerenciado.md).
- [Handoff de Perfil digital](../../handoff/2026-10-15-handoff-perfil-digital.md), [plano de Perfil digital](../perfil-digital/plano-perfil-digital.md), [CF2d](../../operacao/plano-cf2d-enderecos.md), [CF2e](../../operacao/plano-cf2e-enderecos-publicos.md) e [pendências de Storage](../../pendencias.md).
- Origem: caminhos e linhas do worktree explicitados neste documento; árvore remota de referência em [NextCRM](https://github.com/linkkotech/nextcrm-primeiro). Não assumir que arquivos locais modificados estejam disponíveis nesse remoto.

## 11. Histórico

| Versão | Data       | Mudança                                                                            |
| ------ | ---------- | ---------------------------------------------------------------------------------- |
| 0.1    | 20/10/2026 | Auditoria inicial, autoria central, lacunas e dependências para migração completa. |
