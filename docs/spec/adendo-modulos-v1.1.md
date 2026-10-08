# Adendo sobre módulos no repositório

Contrato de módulos e guia de desenvolvimento para Claude Code e Codex

Versão 1.1 • 7 de outubro de 2026 • Plataforma SaaS modular de Marcelo Dias

Atualização 1.1: navegação, submenus e entradas de Settings gerados pelo registro dos módulos, com destinos e permissões separados para cliente e administração.

> Ajustes validados no documento `decisoes` desta issue prevalecem sobre este texto (em especial D5 e D6).

## 1 Objetivo e relação com a especificação

Este adendo complementa a Especificação da plataforma SaaS modular versão 1.0, especialmente suas seções 5, 14, 17, 23, 24 e 25. Formaliza a construção de módulos dentro do mesmo repositório, o módulo modelo, os pontos de conexão com o dashboard e o processo de desenvolvimento e publicação.

Catálogo, Google Business e Agentes de IA devem seguir o mesmo contrato. Seus campos, telas internas, regras comerciais, credenciais específicas, operações e ferramentas continuam em aberto nas especificações de cada módulo. O contrato comum não obriga os módulos a terem funcionalidades iguais.

Este documento especifica o que deverá ser implementado. Ainda não existe um repositório de plataforma nem um módulo modelo criado nesta tarefa. Nomes de arquivos, interfaces e comandos propostos precisam ser materializados pela equipe ou pelos assistentes antes de serem utilizados.

A decisão é manter o núcleo e os módulos em um único projeto Next.js inicialmente. Módulos são unidades de código organizadas e versionadas no Git, integradas na preparação e publicação da aplicação. Não haverá instalação de código por ZIP no painel nem carregamento de plugins de terceiros durante a execução nesta primeira arquitetura.

## 2 Explicação para o responsável pelo produto

Depois de existir uma plataforma base funcional e o módulo modelo, o desenvolvedor clona o repositório, cria uma branch, copia o modelo para uma pasta nova e implementa a funcionalidade. Em seguida conecta as páginas, permissões e demais registros, testa e entrega as mudanças para revisão.

| Termo | Significado prático |
| --- | --- |
| Plataforma | Base compartilhada de login, empresas, workspaces, planos, segurança e operação |
| Módulo | Funcionalidade de negócio, com telas e regras próprias |
| Módulo modelo | Estrutura reutilizável para iniciar um módulo novo |
| Branch | Espaço de trabalho separado para implementar uma mudança |
| Integrar | Conectar o módulo à base e aprovar suas alterações |
| Publicar | Disponibilizar uma versão da plataforma com o código integrado |
| Habilitar | Liberar o módulo para determinado workspace |

Instalar o código na plataforma e habilitar para um cliente são etapas diferentes. Um módulo integrado pode permanecer em beta e ser liberado apenas para workspaces escolhidos. Uma instalação atende muitos workspaces, cada um com seus dados e configurações.

## 3 Condições para começar um módulo

Antes de copiar o modelo, a plataforma precisa ter autenticação, resolução de workspace, permissões, limites, acesso seguro ao banco, auditoria e layout básico funcionando. Caso contrário, cada módulo tende a reconstruir essas funções de maneira diferente.

A primeira tarefa dos assistentes é implementar o contrato de extensão, o modelo e um exemplo simples de referência. O exemplo verifica que a base funciona e não é um produto comercial adicional. Ele deve ficar restrito a desenvolvimento/testes ou a ambientes explicitamente autorizados.

A especificação do novo módulo deve responder: qual problema resolve, quais usuários podem utilizá-lo, quais dados guarda, quais ações realiza, quais conexões exige, quais limites consome, como exporta/exclui seus dados e como seu resultado será verificado. Recursos opcionais, como jobs e ferramentas MCP, só entram quando houver necessidade definida.

## 4 Estrutura proposta

```text
module-templates/standard/
  manifest.ts
  contracts/
  components/
  server/
    services/
    repositories/
    adapters/
  tests/
  database-proposals/
  README.md
  MODULE_SPEC.md

src/modules/
  registry.ts
  catalog/
  google-business/
  ai-agents/
  novo-modulo/

src/core/module-contracts/
src/core/module-runtime/
src/app/app/[workspaceSlug]/
src/app/api/v1/
supabase/migrations/
docs/modules/
```

module-templates/standard é material para geração, não um módulo registrado em produção. Ajustar includes/excludes do TypeScript e do build para não compilar placeholders. src/core/module-contracts define tipos e schemas comuns; module-runtime fornece as funções de integração; registry declara os módulos efetivamente incluídos.

Cada módulo exporta suas interfaces públicas por pontos de entrada separados: manifest.ts para metadados seguros, client.ts para componentes de navegador e server.ts para serviços exclusivos do servidor. Não criar um export único que misture React interativo, Prisma e segredos. Arquivos de servidor usam server-only.

Arquivos opcionais incluem jobs.ts, events.ts e mcp-tools.ts. Não criar implementações vazias que aparentem oferecer funcionalidades prontas. Propostas de banco acompanham o desenvolvimento; SQL aprovado passa para o histórico central de migrations, sem um mecanismo de execução automática na ativação do módulo.

## 5 Manifesto e contrato obrigatório

O manifesto é a ficha que permite à plataforma reconhecer o módulo. Ele contém metadados e referências seguras. Deve ser validado com Zod durante verificações do projeto e do build.

| Campo | Regra |
| --- | --- |
| moduleKey | Identificador estável e único, como appointment; não reutilizar após retirada |
| displayName | Nome apresentado no menu |
| moduleVersion | Versão da entrega do módulo |
| contractVersion | Versão da interface comum implementada |
| platformCompatibility | Faixa de versões compatíveis da plataforma |
| releaseStatus | coming_soon, beta, available ou maintenance |
| routes | Entradas e páginas reais conectadas ao App Router |
| navigation | Entradas de menu e submenus por destino cliente ou admin, ícone, grupo, ordem e permissão |
| settings | Entradas de configuração por destino workspace ou admin, rota, componente registrado e permissões de leitura e alteração |
| permissions | Operações que o módulo exige; nomes exclusivos e estáveis |
| entitlements | Capacidades e cotas contratuais utilizadas |
| dependencies | Dependências obrigatórias e opcionais aprovadas |
| configurationSchema | Validação da configuração por workspace sem valores secretos |
| capabilities | Funcionalidades suportadas, como summary, jobs, export e MCP |

O manifesto não cria tabelas, rotas nem permissões sozinho. Ele declara o contrato; os respectivos adaptadores, registros e migrations precisam existir. A plataforma verifica duplicidade de chaves, conflitos de rota, dependências ausentes e compatibilidade.

Usar namespace por módulo para permissões, eventos e ferramentas. Exemplo ilustrativo: appointment.read, appointment.write e appointment.cancel. Os escopos MCP podem limitar ainda mais o acesso, mas não substituem essas permissões.

## 6 Interfaces entre o núcleo e o módulo

| Interface | Resultado esperado |
| --- | --- |
| Contexto autorizado | Identidade, workspace e origem obtidos do servidor, nunca do formulário |
| Resumo | Dados mínimos para cards do dashboard, com estado Sem dados quando aplicável |
| Configuração | Schema, estado de configuração e referências às conexões permitidas |
| Saúde | Estado de integração e última verificação sem expor conteúdo sensível |
| Consumo | Eventos para recursos efetivamente medidos pelo servidor |
| Auditoria | Ações, recursos e alterações filtradas pelo padrão do núcleo |
| Dados pessoais | Procedimentos de exportação, retenção e exclusão quando houver dados |
| Jobs | Tipos e handlers de tarefas persistentes quando necessários |
| MCP | Ferramentas explicitamente aprovadas e schemas de entrada/saída |

Serviços recebem contexto produzido e validado pelo núcleo. Um campo workspaceId recebido da URL apenas identifica o alvo; não concede acesso. O módulo não constrói um contexto autorizado a partir de dados enviados pelo cliente.

O núcleo oferece helpers para autorização, entitlements, quotas, transações, auditoria, jobs e referências de conexão. O módulo declara a operação exigida e chama esses helpers; verificações não podem ser puladas por caminhos alternativos.

Toda entrada externa passa pela mesma política: identidade ativa, vínculo, grant quando existir, escopo, permissão, estado do módulo, plano e limites. Serviços e acesso a dados permanecem protegidos mesmo se forem chamados diretamente por uma página de servidor.

## 7 Limites de dependência e segurança

Módulos podem utilizar interfaces públicas do núcleo e componentes compartilhados. Não acessam repositories internos de outro módulo nem usam SQL para alterar tabelas de domínio alheio. Quando precisarem se comunicar, usam serviço público ou evento com contrato aprovado.

Cada módulo identifica suas tabelas e políticas, com prefixo coerente no banco e workspace_id obrigatório nos dados operacionais. Constraints impedem referências cruzadas; RLS e contexto de transação seguem a seção 9 da especificação principal. O runtime do módulo não recebe uma conexão privilegiada para contornar esse desenho.

Segredos são referências a conexões do mesmo workspace; não são copiados para manifestos ou configurações. Módulos usam o cofre por um serviço restrito. Nunca retornam chave de provedor à página ou ao MCP.

Código de módulos dentro do mesmo processo é código confiável da sua equipe, não um sandbox. Separar pastas ajuda a organização, mas não isola uma dependência maliciosa ou um processo que consuma memória. Revisão, análise de dependências, testes e limites de tarefas são necessários. Plugins arbitrários de terceiros exigiriam arquitetura adicional.

## 8 Como conectar ao dashboard

O registro central importa explicitamente os manifestos dos módulos incluídos. A navegação combina esse registro com plano, habilitação do workspace, disponibilidade e permissões atuais. Não procurar e executar pastas desconhecidas em runtime.

As páginas Next.js são arquivos finos de ligação, criados no desenvolvimento. Exemplo: src/app/app/[workspaceSlug]/appointment/page.tsx resolve o contexto e chama o componente ou serviço exportado pelo módulo. Inserir routes no manifesto não gera automaticamente esse arquivo.

Endpoints REST também têm adaptadores explícitos sob /api/v1/workspaces/{id}/appointment. Eles validam entrada e invocam serviços do módulo. Componentes do navegador recebem DTOs; chamadas iniciais feitas no servidor podem chamar o serviço diretamente, sem HTTP ao próprio backend.

O dashboard monta cards com a interface de resumo. Menus, submenus e entradas de Settings são montados automaticamente a partir dos registros dos módulos aprovados e das permissões atuais. As áreas de configuração comuns hospedam componentes do módulo conectados durante o desenvolvimento. Não assumir que todos os módulos cabem em um formulário genérico de JSON.

| Local de ligação | Alteração esperada |
| --- | --- |
| Registro central | Incluir manifesto e versão |
| Navegação e Settings | Declarar entradas e componentes; o núcleo monta menus e submenus sem edição manual por cliente |
| App Router | Criar páginas e layouts de ligação necessários |
| API | Criar endpoints e contratos de transporte |
| Permissões e planos | Registrar capacidades sem liberar a todos automaticamente |
| Banco | Integrar migrations e atualizar o Prisma schema |
| Jobs | Registrar handlers necessários em worker aprovado |
| MCP | Registrar somente ferramentas aprovadas |
| Observabilidade | Identificar módulo nos eventos e métricas |

Esses são os pontos normais de integração. Não exigir zero mudanças fora da pasta do módulo, pois rotas e migrations são centralizadas. As alterações devem ser pequenas, listadas e verificáveis.

### 8.1 Navegação automática por destino

O núcleo deve fornecer renderizadores compartilhados para a sidebar do app, a sidebar do admin, os submenus e a navegação de Settings. Cada módulo declara onde deseja contribuir. O registro central gera a árvore final de navegação; não manter uma segunda lista de itens escrita manualmente em cada layout.

Cada entrada tem id estável, moduleKey, destination, label, routeKey ou destino validado, iconKey opcional, groupKey, order e requiredPermissions. Submenus usam children; limitar a um nível inicial para manter navegação simples. Ordenar de modo determinístico por grupo, ordem e identificador. Rejeitar chaves duplicadas, rotas conflitantes, ciclos e destinos não registrados.

O manifesto contém somente metadados seguros. routeKey e componentKey apontam para registros explícitos no código, não para imports arbitrários enviados pelo banco. Ícones vêm de uma lista permitida. A plataforma resolve URLs de workspace usando o slug validado; entradas administrativas não herdam esse contexto silenciosamente.

No app, considerar disponibilidade, contratação, habilitação no workspace e permissões da identidade ativa. Remover itens sem acesso e grupos sem filhos visíveis. Um pai com filhos não exige permissão de uma página inexistente: pode ser apenas um agrupador, enquanto cada filho tem seu próprio acesso. Definir item ativo pela rota correspondente mais específica.

No admin, considerar papel interno, permissão administrativa e presença do módulo no registro global. Uma configuração global deve continuar acessível à equipe autorizada quando o módulo estiver em manutenção ou desabilitado para clientes. Menus operacionais do admin podem exigir estado disponível, conforme sua declaração. O estado comercial de um workspace não controla configurações globais.

### 8.2 Settings de cliente e admin

| Destino | URL padrão proposta | Contexto |
| --- | --- | --- |
| Cliente | /app/[workspaceSlug]/settings/modules/[moduleKey] | Configuração daquele workspace |
| Administração | /admin/settings/modules/[moduleKey] | Políticas e configurações globais do módulo |

Cada entrada de Settings declara id, destination, label, order, routeKey, componentKey, readPermissions e writePermissions. A plataforma gera o item no menu ou aba correspondente; o módulo fornece o componente e os serviços que carregam e salvam a configuração. Configurações opcionais ou inexistentes não geram entrada vazia.

Rotas padrão podem usar um host compartilhado Next.js com segmento [moduleKey], que resolve o componente de um registro estático autorizado. Isso permite reutilizar a página de Settings sem criar um arquivo por módulo. Páginas específicas fora desse host continuam exigindo wrappers explícitos. Uma chave desconhecida ou um componente ausente falha de forma segura e é detectado no build quando aplicável.

A página sempre resolve contexto e valida acesso antes de carregar dados. Leitura e alteração podem ter permissões diferentes; usuário com leitura vê controles apropriados, e o servidor rejeita salvamento sem permissão. Não confiar no filtro da navegação como proteção de rota.

Configuração global e de workspace têm armazenamento e serviços separados. Nunca deduzir o escopo de gravação apenas da URL enviada pelo navegador. Defaults globais podem ser herdados quando declarados pelo contrato do módulo; overrides permitidos, valores efetivos e origem devem estar explícitos. O admin global não recebe acesso a documentos ou chaves dos clientes por oferecer Settings.

### 8.3 Exemplo de contribuição do módulo

Um futuro módulo de Agendamento pode declarar menu Agendamento com filhos Agenda, Reservas e Disponibilidade; Settings do cliente com Configurações de agendamento; Settings do admin com Políticas de agendamento. Esses nomes são exemplos, não definições de um módulo comercial desta plataforma.

Ao registrar e publicar o módulo, o núcleo monta as entradas autorizadas sem editar o menu de cada empresa. O desenvolvedor ainda implementa componentes, rotas necessárias, permissões, serviços e persistência. Declaração de menu não gera funcionalidades nem aplica mudanças no banco.

### 8.4 Aceite da geração automática

Verificar menus e Settings para dois workspaces, com módulo habilitado em apenas um, e usuários com permissões diferentes. Usuário sem acesso não vê a entrada e também não abre a rota diretamente. Administrador interno autorizado pode configurar política global durante manutenção; cliente não acessa Settings do admin.

Testar remoção de grupos vazios, ordenação, rota ativa, chaves desconhecidas, conflito de identificadores, navegação por teclado e exibição mobile. Alteração de vínculo ou permissão invalida caches pertinentes. Nenhum componente de servidor ou segredo pode ser incluído no bundle de navegador por meio do registro de navegação.

## 9 Módulo modelo e exemplo de referência

O modelo entrega manifesto, contratos, componentes e serviços básicos, helpers do núcleo, exemplos de teste e instruções. Inclui exemplos de menu com submenu e componentes de Settings para cliente e admin, com permissões separadas e sem campos específicos de produto. Arquivos a renomear usam placeholders claros. Não conter credenciais, dependências do produto de origem ou configuração de produção.

Como referência técnica, criar uma funcionalidade mínima de registros de exemplo: listar, criar e consultar um registro vinculado ao workspace, com permissão, quota de demonstração e auditoria. Esse recurso só valida o padrão. Não define campos nem regras do Catálogo, Google ou Agentes.

Quando a referência incluir persistência, suas tabelas são de demonstração e suas migrations precisam de estratégia para ambientes não comerciais; não aplicar dados de exemplo em produção. A referência deve testar isolamento entre dois workspaces e bloqueio de operação sem permissão.

O modelo explica como adicionar rota, migration e registro. Posteriormente pode existir um gerador de módulo que copie arquivos, substitua nomes e gere wrappers. Esse gerador é uma entrega futura ou uma tarefa explícita de fundação; não há comando funcional disponível nesta especificação.

Alterar o modelo não atualiza automaticamente os módulos já criados. Cada módulo registra a versão do modelo de origem; novas regras comuns devem ficar no núcleo sempre que possível, e migrações de contrato precisam de revisão.

## 10 Passo a passo de desenvolvimento

### 10.1 Preparar o projeto
Clonar o repositório oficial ou atualizar sua cópia local. Ler README, AGENTS.md, instruções do Claude Code, a especificação principal e este adendo. Instalar dependências pelo gerenciador e lockfile definidos no projeto.

Usar ambiente local ou Supabase de desenvolvimento com credenciais próprias e dados sintéticos. Uma branch Git não isola o banco; duas branches apontando ao mesmo Supabase podem interferir entre si. Para trabalho simultâneo, preferir bancos locais independentes ou ambientes de desenvolvimento separados.

### 10.2 Criar a linha de trabalho
Criar branch específica, como feat/module-appointment. Com Claude Code e Codex trabalhando ao mesmo tempo, usar worktrees ou cópias locais separadas e atribuir responsável pelos arquivos compartilhados. O núcleo de autorização e o histórico de migrations exigem coordenação.

### 10.3 Copiar o modelo
Copiar module-templates/standard para src/modules/appointment. Substituir identificador, nomes, prefixos, versão e documentação. Conferir que o novo módulo não usa imports, dados ou testes de outro módulo por acidente. Copiar a pasta é apenas o ponto de partida: ainda é preciso registrar o módulo, criar as páginas de ligação, integrar as permissões e entregar as alterações do banco.

### 10.4 Implementar a funcionalidade
Escrever primeiro MODULE_SPEC.md com escopo, regras e critérios de aceite. Implementar dados e serviços, depois API e páginas, preservando as fronteiras servidor/navegador. Usar componentes compartilhados de shadcn/ui e tokens Tailwind da plataforma.

Gerar migrations SQL novas e revisar constraints/RLS; atualizar Prisma schema conforme o fluxo do projeto. Não editar migrations já aplicadas nem aplicar SQL remoto automaticamente. Jobs, eventos e ferramentas MCP só são acrescentados se estiverem na especificação do módulo.

### 10.5 Testar e revisar
Executar typecheck, lint, build e testes relevantes com os scripts reais do repositório. Verificar caminho feliz, acesso negado, limite atingido, falha de integração e isolamento. Revisão pode ser feita pelo outro assistente, com inspeção humana das decisões e evidências.

Criar pull request descrevendo função, pontos de ligação, migrations, permissões, testes e riscos. Corrigir conflitos e revalidar as partes afetadas antes de integrar.

### 10.6 Integrar e publicar
Após aprovação, integrar ao branch principal. Aplicar migrations no ambiente de teste pelo responsável, publicar preview/staging e validar com o código final. Em produção, seguir a ordem planejada entre banco, aplicação e worker; mudanças devem ser compatíveis com a versão em execução durante a transição.

Habilitar primeiro em workspace de teste ou piloto. Depois liberar por plano e rollout. Publicar o módulo não significa habilitá-lo em todas as contas.

## 11 Exemplo de rotina em linguagem simples

Você solicita um módulo. O assistente lê o contrato, especifica o produto e implementa numa branch do repositório da plataforma, usando o módulo modelo, conecta o menu e entrega uma revisão que mostra o que mudou e como foi testado. Depois de aprovar, você aplica o SQL remoto indicado, quando houver, e a versão é publicada. O admin libera o módulo para o workspace do cliente. No próximo módulo, a equipe repete esse fluxo no mesmo repositório.

## 12 Banco, atualizações e remoção

Todas as migrations aprovadas entram em supabase/migrations, com identificação do módulo no arquivo e execução ordenada. Mesmo desenvolvido separadamente, o módulo não pode criar um segundo histórico independente de banco dentro da plataforma.

Atualizações usam migrations compatíveis e versões de contrato. Preferir expandir estrutura, publicar código compatível e só depois remover campos antigos quando não utilizados. Um rollback de código não garante rollback de dados; documentar recuperação e mudanças irreversíveis.

| Ação | Efeito |
| --- | --- |
| Incluir código | Módulo passa a fazer parte da versão publicada |
| Habilitar workspace | Libera uso conforme plano e permissão |
| Desabilitar workspace | Bloqueia uso e inicia tratamento definido de jobs; preserva dados conforme contrato |
| Manutenção global | Bloqueia operações afetadas com mensagem clara |
| Atualizar | Entrega correções ou recursos com compatibilidade e migrations |
| Excluir dados | Processo explícito com autorização, retenção e rastreabilidade |
| Remover código | Exige tratar dependências, contratos, jobs e dados existentes antes |

Definir por operação se jobs pendentes serão cancelados ou concluídos. Não permitir novas ações após bloqueio; efeitos externos já concluídos não são automaticamente desfeitos. Desabilitar não significa excluir, e excluir um workspace exige tratar dados de todos os seus módulos.

## 13 API, MCP e projetos existentes

REST, páginas do servidor e MCP compartilham serviços. Ferramentas MCP do módulo têm escopos próprios, inputs/outputs Zod, risco, política de aprovação e limites. A plataforma aplica o grant e o contexto; o módulo não recebe privilégios adicionais por ser chamado por um assistente.

Primeira integração pode ser leitura e proposta de operação. Escritas só são liberadas quando o contrato de execução for implementado. Não expor automaticamente endpoints como tools nem criar ferramentas genéricas de SQL ou HTTP arbitrário.

Para projeto já existente, criar um módulo adaptador: telas usam o shell da plataforma, e serviços chamam sua API externa. O backend externo precisa de autenticação de serviço, escopo de workspace e proteção de autorização equivalente. Os dados e responsabilidades de exclusão devem ter proprietário definido. Não reescrever projetos maduros apenas para colocá-los na mesma pasta.

## 14 Prompt base para os assistentes

Contexto: Estamos desenvolvendo uma plataforma SaaS multiempresa em Next.js, Supabase, Prisma, shadcn/ui, Tailwind e Zod. Leia as instruções do repositório, a especificação principal e o adendo de módulos. O módulo deve ficar no mesmo repositório e compartilhar os serviços do núcleo.

Objetivo: Implementar o módulo [NOME] com identificador [CHAVE], partindo de module-templates/standard. Se o modelo ou contrato não existir, informe a lacuna e implemente a fundação em uma tarefa separada e revisável antes de construir o módulo.

Requisitos: Respeitar contexto de workspace, RLS, papéis, capacidades e quotas; segredos somente por referência ao cofre; regras em serviços; páginas/API/MCP como adaptadores. Não definir funcionalidades internas ausentes na especificação. Não executar SQL remoto.

Lógica: Registrar manifesto; criar wrappers de páginas e endpoints; declarar permissões e contratos; propor migrations e atualizar Prisma schema; integrar auditoria e ciclo de vida dos dados. Adicionar jobs ou MCP apenas quando requeridos.

Plano: Identificar dependências, registrar escopo em MODULE_SPEC.md, listar arquivos afetados, implementar por etapas e revisar mudanças fora da pasta do módulo.

Testes: Verificar dois workspaces, usuários com papéis distintos, contexto ausente, revogação, limites e acessos externos. Executar build e scripts de qualidade do projeto. Informar testes não executados e motivo.

Critérios de aceite: Módulo funcional e integrado; sem vazamento de dados/segredos; sem duplicação da autenticação; migrations entregues para aplicação manual; documentação, versão e instruções de atualização prontas.

## 15 Critérios de conclusão do modelo e de cada módulo

| Item | Evidência |
| --- | --- |
| Contrato | Manifesto válido e compatível; sem chaves ou rotas duplicadas |
| Navegação | Menus e submenus gerados pelo registro, rotas reais e acesso verificado |
| Settings | Entradas automáticas e componentes registrados para cliente/admin; leitura e escrita separadas |
| Segurança | Permissão no serviço, RLS e isolamento entre workspaces |
| Planos | Disponibilidade e quotas verificadas no servidor |
| Credenciais | Referências autorizadas; segredo ausente de client e logs |
| Dados | Migrations centrais, constraints e Prisma schema consistentes |
| Operação | Estados de falha e jobs necessários com rastreabilidade |
| Privacidade | Exportação/exclusão e retenção aplicáveis documentadas |
| MCP | Tools registradas explicitamente e restritas pelo grant |
| Qualidade | Build, testes relevantes e revisão com evidências |
| Documentação | Especificação, README e mudanças de versão |
| Demonstração | Exemplo restrito a desenvolvimento, sem dados fictícios em produção |

## 16 Implantação inicial e evolução

Agora: criar contrato, registry, módulo modelo e referência; adaptar os três módulos iniciais; manter rotas e migrations explícitas; usar Git para revisão e publicação.

Depois: automatizar geração de arquivos, validar limites arquiteturais no CI e, quando necessário, extrair módulos para pacotes privados. Instalação dinâmica de plugins, marketplace e execução de código de terceiros constituem uma evolução diferente, com isolamento e governança próprios.

## 17 Entregas a solicitar primeiro

1. Contrato comum de módulo com interfaces, schemas e política de acesso.
2. Registro central, renderizadores automáticos de menus/submenus e hosts de Settings para cliente/admin, além dos pontos de ligação de API, permissões e MCP.
3. Modelo reutilizável com instruções e placeholders claros.
4. Módulo demonstrativo que comprova integração e isolamento.
5. Checklist de criação, revisão, atualização e habilitação.

