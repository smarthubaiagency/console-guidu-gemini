# Especificação da plataforma SaaS modular

Documento de arquitetura e requisitos para implementação com Claude Code e Codex

Versão 1.0 • 7 de outubro de 2026 • Responsável pelo produto Marcelo Dias

> Ajustes validados no documento `decisoes` desta issue prevalecem sobre este texto (em especial D1 sobre a seção 9 e D3 sobre a seção 23).

## 1 Objetivo e alcance

Construir uma plataforma SaaS multiempresa com dashboard compartilhado, API First, administração interna e módulos independentes. Uma empresa pode ter vários workspaces; cada workspace pode ter vários usuários, conforme contratação. Um usuário pode participar de várias empresas e workspaces com permissões diferentes.

A primeira estrutura recebe Catálogo, Perfil da Empresa no Google e Agentes de IA. Este documento especifica somente como esses módulos se conectam à plataforma. Suas telas internas, campos de domínio, ferramentas, regras comerciais e fluxos específicos permanecem em aberto e exigem especificações próprias.

O MCP nativo permitirá que clientes e administradores conectem assistentes externos à plataforma com identidade verificada, concessões explícitas e escopos definidos. É uma interface adicional dos serviços da plataforma, distinta dos agentes de IA contratados nos workspaces.

As recomendações são decisões propostas para implementação, não evidência de controles já implementados nem declaração de conformidade legal. Versões de bibliotecas e compatibilidade devem ser verificadas e fixadas no início do projeto.

## 2 Premissas e decisões propostas

| Tema | Decisão proposta |
| --- | --- |
| Arquitetura | Monólito modular em Next.js com serviços compartilhados entre interface, REST e MCP |
| Empresa | Unidade contratante, responsável pela assinatura e dados comerciais |
| Workspace | Fronteira principal de isolamento dos dados operacionais |
| Identidade | Supabase Auth; perfis separados de vínculos e permissões |
| Assinatura | Por empresa, com limites globais e cotas por workspace |
| Usuários | Contagem de usuários únicos ativos por empresa; regras para convites reservados explicitadas |
| Navegação | Slug globalmente único para o workspace; UUID interno; usuário fora da URL |
| Administração | Papéis internos separados dos papéis dos clientes |
| Credenciais IA | BYOK por workspace, sem fallback automático para uma chave da plataforma |
| RAG | Infraestrutura compartilhada com isolamento; configurações internas definidas em documento do módulo |
| SQL remoto | Assistentes geram migrations e instruções; aplicação no Supabase remoto é manual pelo responsável |

Decisões propostas podem mudar mediante ADR aprovado antes de alterar contratos ou banco. Não reinterpretar silêncio como aprovação de mudanças de escopo.

## 3 Stack sugerida

| Tecnologia | Responsabilidade e restrições |
| --- | --- |
| Next.js App Router e React | Páginas no servidor, componentes interativos e Route Handlers; runtime Node para Prisma |
| TypeScript estrito | Tipos consistentes; evitar any em contratos e autorização |
| Supabase Postgres | Dados relacionais, constraints, transações, RLS e pgvector quando o módulo exigir |
| Supabase Auth e SSR | Identidade, sessões, recuperação e MFA; validar tokens no servidor |
| Supabase Storage | Arquivos com políticas próprias; privado por padrão para conteúdo restrito |
| Prisma | Modelagem e repositories no servidor; integração com RLS conforme seção 9 |
| Tailwind CSS | Tokens visuais, responsividade e estilos |
| shadcn/ui | Componentes base mantidos no repositório; revisar acessibilidade após customização |
| Zod | Contratos de entrada e saída; validação no servidor e feedback no formulário |
| React Hook Form | Formulários; opcional conforme complexidade |
| TanStack Query | Cache de dados interativos quando necessário; chave inclui workspace e contexto de acesso |
| SDK MCP oficial para TypeScript | Transporte e protocolo; versão fixada após teste de compatibilidade |
| OpenAPI | Contrato REST versionado e documentação de integração |
| Worker e jobs persistentes | Indexações, sincronizações, exportações e tarefas demoradas |
| Redis opcional | Rate limit distribuído e coordenação; não é fonte definitiva dos dados |
| Vitest e Playwright | Testes de serviços, contratos e fluxos críticos; testes SQL para RLS |
| Telemetria | Logs estruturados, métricas, traces e alertas com minimização de dados |

Fixar versões estáveis compatíveis em lockfile. Não assumir que a versão mais nova de cada pacote é compatível com todas as outras. Evitar instalar extensões experimentais de RLS como requisito obrigatório sem avaliação.

## 4 Camadas e execução

Páginas e layouts carregam dados no servidor. Client Components cuidam de interação, estado, filtros, modais e feedback. O servidor mantém segredos, autorizações, quotas e regras de negócio. O banco aplica integridade e isolamento.

| Camada | Função |
| --- | --- |
| Página Server Component | Resolver contexto de navegação e chamar serviços para dados iniciais |
| Client Component | Interagir e enviar comandos; não decidir autorização definitiva |
| Route Handler REST | Validar transporte, autenticar, validar entrada e chamar serviço |
| Adaptador MCP | Validar token, concessão e escopo; converter chamada de ferramenta em caso de uso |
| Serviço | Revalidar autorização operacional, regras, plano, quotas e resultado |
| Repository | Acessar banco dentro do contexto autorizado e da transação |
| Worker | Executar tarefa persistente com identidade técnica e autorização reavaliada |

Página no servidor, API e MCP chamam os mesmos serviços. Não fazer HTTP para a própria API quando uma chamada interna segura ao serviço for suficiente. Backends externos são acessados por adaptadores.

Server Actions são opcionais para interface e usam os mesmos serviços. Nunca são o único contrato de uma operação que precisa estar disponível externamente. Proteger arquivos exclusivos do servidor com server-only. Dados enviados ao navegador são DTOs mínimos, sem campos secretos.

## 5 Organização do repositório

```text
src/
  app/
    (auth)/
    admin/
    app/[workspaceSlug]/
    api/v1/
    mcp/workspace/
    mcp/admin/
    oauth/consent/
  core/
    auth/ organizations/ workspaces/ permissions/
    billing/ entitlements/ audit/ credentials/
    integrations/ jobs/ privacy/ mcp/
  modules/
    catalog/
    google-business/
    ai-agents/
  shared/
    ui/ contracts/ errors/
  lib/
    supabase/ prisma/ telemetry/
supabase/migrations/
prisma/schema.prisma
docs/architecture/
docs/adr/
tests/
```

Cada módulo pode conter components, contracts, server/services, server/repositories e adapters. Módulos não acessam repositories de outros módulos diretamente. Integrações entre eles usam interfaces de serviço ou eventos registrados.

## 6 Modelo de dados do núcleo

| Entidade | Campos e responsabilidade mínimos |
| --- | --- |
| profiles | id ligado à PK auth.users, nome e preferências; sem workspace único no usuário |
| organizations | id, nome, status, dados comerciais necessários e timestamps |
| organization_members | organization_id, user_id, role e status; vínculo único |
| workspaces | id, organization_id, slug único, nome, status e timestamps |
| workspace_members | workspace_id, user_id, role, status e timestamps; vínculo único |
| invitations | escopo empresa ou workspace, destinatário, papel, hash do token, expiração e aceite |
| platform_admin_members | identidade, papel interno, status; gravação por processo privilegiado |
| plans e plan_versions | produtos e versões de capacidades e limites |
| subscriptions | empresa, versão contratada, status, período e referência de cobrança |
| workspace_modules | workspace, module_key, estado e configuração permitida; vínculo único |
| entitlement_overrides | exceção autorizada, motivo, validade e responsável |
| provider_connections | workspace, provider, finalidade, secret_ref e estado |
| api_keys | hash, principal, escopos, workspace, expiração e revogação |
| mcp_clients e mcp_grants | clientes externos e concessões de acesso conforme seção 17 |
| execution_proposals | proposta, payload_hash, validade, aprovação e estado |
| jobs e executions | workspace, tipo, estado, tentativas, execução e correlação |
| audit_events | eventos de acesso e mudança; inserção controlada |
| usage_events | consumo medido, unidade, referência de execução e correções |
| privacy_requests | solicitação, identidade verificada, responsável, prazo e evidências |
| support_access_grants | acesso temporário de suporte, motivo, escopo e expiração |

UUID nativo nas PKs e FKs do domínio; UTC em timestamps e fuso apenas para apresentação e regras locais. Padronizar camelCase em TypeScript/Prisma e snake_case no SQL via mapeamento. Identificadores de fornecedores permanecem externos, sem substituir a PK.

Tabelas operacionais recebem workspace_id NOT NULL. Dados no nível da empresa recebem organization_id. Constraints compostas asseguram que referências filhas e pais pertencem ao mesmo workspace. Indexar vínculos, filtros por workspace e consultas frequentes; não criar índices sem justificar o padrão de acesso.

## 7 Papéis e política de acesso

| Papel | Escopo proposto |
| --- | --- |
| Organization owner | Contratação, propriedade e concessão de acesso aos workspaces |
| Organization admin | Administração da empresa conforme permissões delegadas |
| Workspace owner | Propriedade operacional, equipe e configurações do ambiente |
| Workspace admin | Gestão de equipe e integrações autorizadas |
| Workspace editor | Alterações de conteúdo permitidas pelo módulo |
| Workspace viewer | Leitura permitida; exportação não é automática |
| Platform owner | Governança da plataforma e concessão de privilégios internos |
| Platform operations | Operação de clientes e jobs com permissões delimitadas |
| Platform billing | Planos e assinaturas; sem leitura de documentos por padrão |
| Platform support | Suporte com acesso temporário explícito aos dados do cliente |

Papéis mapeiam permissões, como workspace.members.invite e integrations.manage. Não espalhar comparações de nome de papel pelo código. Exportar, excluir, publicar, alterar credenciais e delegar acesso são permissões distintas.

Por padrão, vínculo na empresa não concede leitura de todos os dados dos workspaces. O proprietário pode conceder acesso mediante operação auditada; se o produto preferir herança, registrar essa decisão e testá-la. Não remover o último proprietário ativo. Transferência exige destinatário válido, autenticação reforçada e transação.

Autorização efetiva é a interseção entre identidade ativa, associação ativa, permissão, recurso solicitado, módulo disponível, contratação, concessão externa quando existir e política de execução. Não aceitar user_id, role ou workspace autorizado vindos do corpo da requisição como prova de acesso.

## 8 Autenticação e sessões

Usar Supabase Auth com cookies e integração SSR. Validar identidade com getClaims ou getUser conforme o fluxo; não confiar apenas no objeto de usuário de getSession. Proxy e layouts podem auxiliar navegação, mas endpoints e serviços precisam verificar acesso.

Implementar login, confirmação de e-mail conforme política, recuperação, convites expirantes, aceite, logout e revogação administrativa. Convites têm uso único e vínculo com destinatário verificado. A conta existente aceita o convite sem duplicar identidade.

MFA obrigatório para administração interna e operações privilegiadas; MFA disponível a clientes. Bloqueio de identidade, remoção de vínculo ou revogação de concessão precisa impedir novas operações imediatamente, inclusive com JWT ainda válido. Operações em andamento seguem política de cancelamento definida, sem prometer reversão de efeitos externos já concluídos.

## 9 Prisma, Supabase e RLS

Prisma conecta diretamente ao Postgres e não recebe automaticamente o contexto JWT usado por auth.uid na Data API. Uma conexão como proprietário, postgres ou papel com BYPASSRLS pode ignorar RLS. Não liberar Prisma no caminho de dados dos clientes sem demonstrar isolamento.

Estratégia proposta para Prisma em runtime: papel app_runtime sem superuser, sem BYPASSRLS e sem propriedade das tabelas; privilégios mínimos; RLS habilitada e FORCE ROW LEVEL SECURITY nas tabelas aplicáveis. Papel de migrations separado. Não permitir SET ROLE para papel privilegiado no runtime.

Todas as consultas de domínio executam em uma transação com contexto local definido pelo servidor após validação: app.user_id, app.workspace_id, app.organization_id quando pertinente, app.principal_type e app.grant_id para acesso delegado. Usar parâmetros em set_config com is_local verdadeiro. Executar as consultas no mesmo transaction client; ausência de contexto nega acesso. Nunca persistir contexto na conexão nem interpolar SQL.

Policies da conexão Prisma leem esse contexto e verificam vínculos atuais. Policies da Data API usam a identidade validada do Supabase. Essas duas entradas exigem desenho explícito: auth.uid não substitui app.user_id automaticamente. Evitar recursão nas políticas de membership com funções de acesso mínimo, search_path fixo e privilégios controlados.

A recomendação inicial é centralizar dados de domínio no servidor e restringir a Data API ao que for necessário. Se mantida, negar por padrão acesso direto de clientes OAuth externos às tabelas internas; assim, um token MCP restrito não pode contornar seus escopos acessando PostgREST. Se houver acesso delegado direto, as políticas precisam incorporar client_id, grant, workspace e capacidade da operação.

Prova obrigatória antes da implementação dos módulos: testar acesso cruzado, contexto ausente, troca de workspace, rollback, conexões reutilizadas e requisições concorrentes. Até passar, usar Supabase com JWT de usuário e RLS nos repositories do domínio; Prisma pode ficar restrito ao caminho controlado de modelagem e rotinas internas. **(Substituído por D1: Data API fechada para domínio; se o spike falhar, decisão volta para Marcelo.)**

Uma cadeia de migrations SQL em supabase/migrations é a fonte executável do banco, incluindo tabelas, constraints, policies, funções e privilégios. Prisma schema reflete o domínio e gera o cliente. Não manter dois históricos concorrentes de migrations. Assistentes geram e testam SQL localmente; o responsável aplica SQL remoto manualmente. Não usar db push remoto nem gerenciar auth e storage como schemas próprios.

## 10 Páginas públicas e de identidade

| Rota | Página |
| --- | --- |
| /login | Entrar |
| /auth/callback | Retorno de autenticação e troca segura de código |
| /forgot-password e /reset-password | Recuperação |
| /invite/[token] | Aceite de convite sem expor seu conteúdo em logs |
| /onboarding | Criar empresa e workspace quando permitido |
| /oauth/consent | Autorizar assistente externo e selecionar acesso |
| /privacy e /terms | Aviso de privacidade e termos versionados |

Páginas de confirmação, acesso negado, convite expirado, indisponibilidade e conta suspensa precisam de estados claros. Cadastro público aberto é uma decisão comercial, não padrão obrigatório.

## 11 Menus e páginas do app

Topo com seletor de empresa/workspace, identificação do ambiente ativo, perfil e notificações operacionais. Sidebar com Visão geral, módulos habilitados, Execuções quando contratadas, Configurações e Ajuda. Separar a conta pessoal das configurações do workspace.

| Rota | Conteúdo |
| --- | --- |
| /app | Seleção ou redirecionamento ao último workspace ainda autorizado |
| /app/[workspaceSlug] | Dashboard com módulos, status e pendências reais |
| /app/[workspaceSlug]/catalog | Entrada do módulo; detalhes internos em aberto |
| /app/[workspaceSlug]/google-business | Entrada do módulo; detalhes internos em aberto |
| /app/[workspaceSlug]/ai-agents | Entrada do módulo; detalhes internos em aberto |
| /app/[workspaceSlug]/executions | Jobs, erros e resultados visíveis ao cliente |
| /app/[workspaceSlug]/settings/general | Nome, marca e fuso |
| /app/[workspaceSlug]/settings/team | Membros, convites e permissões |
| /app/[workspaceSlug]/settings/modules | Habilitação e estado dos módulos |
| /app/[workspaceSlug]/settings/integrations | Conexões externas e status |
| /app/[workspaceSlug]/settings/credentials | Conexões BYOK e gestão de segredos |
| /app/[workspaceSlug]/settings/api | Chaves da plataforma e webhooks |
| /app/[workspaceSlug]/settings/mcp | Assistentes conectados, escopos, expiração e revogação |
| /app/[workspaceSlug]/settings/usage | Consumo e limites |
| /app/[workspaceSlug]/settings/audit | Auditoria permitida ao cliente |
| /app/organizations/[organizationId]/settings | Gestão da empresa, workspaces e assinatura |
| /app/account | Perfil pessoal, segurança, sessões e aplicativos conectados |

Um workspace leva direto ao dashboard; vários permitem seleção; nenhum leva ao onboarding ou convite. Slug resolve UUID no servidor e exige verificação de vínculo. Não incluir nome do usuário na rota do ambiente.

Não exibir métricas simuladas como reais. Mostrar Sem dados, Configuração pendente, Em breve, Beta ou Indisponível conforme o caso. Estados de carregamento, erro, vazio, limite atingido e acesso negado fazem parte de cada página.

## 12 Menus e páginas do admin

Sidebar inicial: Visão geral, Clientes, Workspaces, Usuários, Planos e assinaturas, Módulos, Operação, Auditoria e Configurações. Itens internos podem começar como abas, com rotas estáveis e permissões próprias.

| Rota | Página e ações |
| --- | --- |
| /admin | Saúde operacional, clientes, assinaturas e pendências |
| /admin/customers | Empresas, contatos e situação comercial |
| /admin/customers/[id] | Resumo, workspaces, membros, assinatura, consumo e histórico |
| /admin/workspaces | Ambientes, estados, limites e módulos |
| /admin/workspaces/[id] | Resumo, membros, módulos, conexões, consumo e auditoria |
| /admin/users | Identidades e vínculos; distinguir bloqueio global de remoção local |
| /admin/plans | Versões de planos, capacidades e preços |
| /admin/subscriptions | Contratações, renovação, cancelamento e inadimplência |
| /admin/modules | Disponibilidade, beta, manutenção e rollout |
| /admin/operations/integrations | Falhas, última sincronização e estado das conexões |
| /admin/operations/executions | Jobs, tentativas e resultados com acesso mínimo |
| /admin/operations/usage | Consumo por empresa e workspace |
| /admin/operations/privacy | Solicitações verificadas, retenção e exclusão |
| /admin/operations/incidents | Registro e resposta a incidentes |
| /admin/audit | Eventos administrativos e acessos de suporte |
| /admin/settings | Configurações globais |

Suporte acessa dados de cliente mediante concessão temporária, justificativa e escopo. Mostrar acesso de suporte no app e auditar ator real e ator representado. Não implementar login como cliente com troca silenciosa de sessão na primeira versão.

## 13 Configurações administrativas

| Aba | Conteúdo |
| --- | --- |
| Geral | Marca, domínio público, suporte, idioma e fuso padrão |
| Autenticação | Cadastro, convites, sessões e políticas de MFA |
| E-mail | Remetentes, templates, entrega e teste de envio |
| Storage | Limites de arquivo, MIME types, cotas e retenção |
| Provedores IA | Provedores aceitos e capacidades; detalhes dos módulos em aberto |
| Integrações globais | Aplicativos OAuth e configuração dos conectores |
| Cobrança | Provedor, produtos e mapeamento de planos |
| API e webhooks | Política de acesso, rate limits e eventos |
| MCP | Clientes aceitos, ferramentas, escopos, concessões e suspensão emergencial |
| Equipe interna | Papéis administrativos e revisão de acesso |
| Privacidade | Políticas, contatos, fornecedores e retenção |
| Operação | Estado dos serviços, jobs e alertas |

Preferências comerciais podem ficar no banco. Chaves de banco, service_role e raiz de criptografia ficam no ambiente de deploy ou cofre de infraestrutura. O painel mostra diagnóstico e referências; não expõe um editor genérico de segredos globais.

E-mails do Supabase Auth e e-mails transacionais da aplicação têm configurações e fluxos distintos. Alterar o remetente da aplicação não atualiza o SMTP do Auth automaticamente. Configurar SMTP de produção, observar entregas e impedir vazamento de tokens em links rastreados.

## 14 Contrato de integração dos módulos

Cada módulo declara module_key, nome, rota, versão do contrato, estado de lançamento, permissões, capacidades do plano, dependências e pontos de integração. O registro fica no código; habilitação e configurações por workspace ficam no banco.

Separar disponibilidade técnica, contratação, habilitação e permissão do usuário. Ocultar menu não é autorização. API, MCP e workers também verificam o estado do módulo.

Cada módulo fornece interfaces para resumo do dashboard, validação de configuração, estado de saúde, exportação/exclusão de dados, eventos auditáveis, consumo, jobs e ferramentas MCP quando aprovadas. Informações sensíveis são referências a conexões, não segredos copiados para JSON de configuração.

| Módulo inicial | Conexão com a plataforma | Especificação em aberto |
| --- | --- | --- |
| Catálogo | Recebe contexto de workspace, capacidades, Storage, auditoria, serviços e API | Conteúdo, categorias, publicação, campos e regras |
| Google Business | Usa conector OAuth, referências de conexão, jobs e estado de sincronização | Operações, métricas, telas e regras; acesso às APIs depende de aprovação do Google |
| Agentes de IA | Usa BYOK, identidade de execução, consumo, fontes autorizadas e jobs | Agentes, prompts, ferramentas, RAG, modelos e fluxos |

Projetos existentes podem ser conectados por adaptadores HTTP. O backend externo deve verificar identidade de serviço, workspace e autorização; confiar apenas em um workspace_id enviado é insuficiente. Não duplicar regra de negócio no dashboard.

Para novo módulo: aprovar contrato, registrar permissões/capacidades, criar migrations e policies, implementar serviços/adaptadores, integrar menu e resumo, definir exportação/exclusão e testar isolamento. Registrar ferramentas MCP separadamente; não expor automaticamente todos os endpoints como ferramentas.

## 15 API REST e eventos

Prefixo /api/v1 e UUID para recursos. Exemplo de núcleo: GET /me/workspaces; GET /workspaces/{id}/overview; GET /workspaces/{id}/modules; GET /workspaces/{id}/usage; gestão de membros, convites, conexões e concessões conforme permissão. APIs administrativas usam /api/v1/admin e autorização interna independente.

Entrada passa por autenticação, resolução de principal, associação, escopo externo, permissão, disponibilidade do módulo, contratação, quota e Zod. Saída usa contrato tipado; erros incluem code, mensagem segura e requestId. Nunca devolver stacktrace ou credenciais. Diferenciar 401, 403, 409, 422 e 429 quando aplicável; evitar revelar recursos de outro cliente.

Definir paginação, filtros permitidos, ordenação, limites de página e política de compatibilidade. Chaves externas armazenadas por hash têm escopo, principal, expiração e revogação; não equivalem às chaves BYOK recuperáveis.

Webhooks têm assinatura, timestamp, janela de validade, proteção contra repetição e identificador de entrega. Entregas persistentes com tentativas limitadas. Eventos internos usam outbox transacional quando efeitos externos dependem de uma mudança no banco. Evitar prometer entrega exatamente uma vez; garantir efeitos idempotentes.

## 16 Credenciais e limites do RAG

Cada workspace pode ter várias conexões: geração de texto, embeddings e serviços opcionais. Uma conexão pode atender mais de uma finalidade quando compatível. O módulo escolhe referências válidas do mesmo workspace.

Guardar chaves em cofre, como Supabase Vault com privilégios restritos, ou solução equivalente. Metadados contêm secret_ref, identificação mascarada, estado e última verificação. Cadastro envia segredo uma vez ao servidor; consultas posteriores não o devolvem. Gestão permite testar, substituir e revogar; auditoria registra a ação sem o valor.

Nunca expor segredos pelas ferramentas MCP, DTOs, erros ou logs. O MCP permite usar a capacidade de uma conexão sem ler sua chave. Apenas possuir a chave do provedor não dá autorização na plataforma.

A plataforma oferece isolamento para documentos, trechos, vetores, caches e jobs. Bases devem ter vínculos de acesso por agente. O contrato do módulo precisa registrar modelo e versão da indexação, invalidar acesso revogado, propagar exclusão e definir reindexação ao trocar embeddings. Estratégia de chunking, dimensões, busca, prompts e ferramentas permanece em aberto.

## 17 MCP nativo e autenticação

Implantar duas superfícies lógicas: https://dominio.com/mcp/workspace para clientes e https://dominio.com/mcp/admin para equipe interna. Recursos OAuth e concessões diferentes; um token de workspace não autoriza administração. O endpoint admin não concede acesso automático a conteúdo de clientes.

Usar Streamable HTTP e SDK oficial, com autenticação em cada requisição, HTTPS e validação de Origin conforme o transporte. Sessão MCP não é identidade nem prova de autorização. Retomar sessão não preserva acesso revogado.

Modelo principal: OAuth Authorization Code com PKCE, descoberta de protected resource e servidor de autorização, validação de emissor e binding do token ao recurso. Supabase Auth pode ser candidato ao authorization server; sua compatibilidade precisa ser provada em spike técnico, incluindo customização de escopos, audience, grant, revogação e clientes pretendidos.

Se o Supabase não atender todo o contrato, usar servidor OAuth mantido e compatível ligado à identidade Supabase, sem implementar criptografia ou protocolo OAuth caseiro. Escopos OIDC como profile e email não substituem permissões operacionais. Concessões próprias da aplicação são obrigatórias mesmo quando o token já identifica o usuário.

DCR não é requisito universal: escolher registro de clientes compatível com a versão negociada do protocolo, permitindo clientes pré-registrados e metadata documents quando suportados. No admin, começar com clientes aprovados. Testar versões instaladas de Claude Code e Codex; registrar URL, método de conexão, protocolo e limitações realmente verificadas.

### 17.1 Fluxo de autorização

1. Usuário adiciona URL MCP ao assistente; cliente descobre autenticação e inicia OAuth.
2. Plataforma autentica usuário; para admin exige MFA e papel interno ativo.
3. Consentimento mostra cliente, finalidade, recurso MCP, workspace, ferramentas/capacidades, dados expostos e validade.
4. Usuário concede somente acessos que possui; servidor persiste grant antes de aprovar a autorização.
5. MCP valida token e resolve grant associado ao usuário, cliente e recurso. Emissão e seleção do grant devem ser inequívocas, por claim verificável ou vínculo server-side documentado.
6. Cada tool call reavalia grant, vínculo, escopo, permissão, módulo, plano e política.
7. Usuário ou administrador revoga a conexão; novas chamadas são bloqueadas mesmo se o access token ainda não expirou.

Padrão inicial: uma concessão por usuário, cliente, recurso e workspace, sem troca silenciosa. Para múltiplos workspaces, concessões independentes e identificadas. Descobrir ambientes disponíveis não permite ler seus dados.

### 17.2 Dados da concessão

mcp_grants inclui id, user_id, client_id, resource_uri, workspace_id ou escopo administrativo explícito, scopes, status, expires_at, revoked_at, approved_at, versão e referências de autorização. Guardar tokens opacos por hash quando verificáveis assim; refresh tokens que precisem ser recuperados exigem cofre. Nunca gravar access tokens em logs.

Validação inclui assinatura ou introspecção segura, issuer, audience/recurso, expiração e cliente. Access token curto, com 15 minutos como parâmetro inicial se suportado; tolerância de relógio proposta de 60 segundos. Checar concessão atual evita depender do TTL para revogar. Cache de autorização tem invalidação explícita e prazo máximo documentado.

### 17.3 Escopos e ferramentas iniciais

| Escopo | Ferramentas propostas | Restrição |
| --- | --- | --- |
| workspace:read | get_workspace, get_workspace_overview | Workspace concedido |
| modules:read | list_enabled_modules, get_module_status | Metadados autorizados |
| usage:read | get_usage_summary | Resumo sem chaves ou conteúdo |
| executions:read | list_executions, get_execution_status | Resultado filtrado |
| members:read | list_workspace_members | Dados mínimos; separado do resumo |
| proposals:write | propose_operation | Cria proposta; não executa efeito |
| operations:execute | execute_approved_operation | Permissão específica, proposta válida e política |
| admin:customers:read | list_customers, get_customer_summary | Papel interno; dados comerciais mínimos |
| admin:operations:read | get_platform_health, list_failed_jobs | Sem conteúdo de cliente por padrão |
| admin:proposals:write | propose_admin_operation | Sujeito a aprovação e permissão específica |

Cada ferramenta tem input/output Zod, required scopes, permissões específicas, classificação de risco, limite e política de aprovação. Ferramentas de módulos serão definidas nas respectivas especificações; ficam desabilitadas até aprovação de contrato.

Não oferecer ferramenta genérica de SQL, shell, acesso ao filesystem, leitura de segredos ou HTTP arbitrário. tools/list filtra capacidades; tools/call valida novamente. Prompts, descriptions e annotations de ferramentas não são mecanismos de segurança.

### 17.4 Escrita, aprovação e idempotência

Primeira liberação MCP contempla leituras do núcleo e criação de propostas. Escritas entram por lista explícita. Alterar permissões, publicar, excluir, exportar em massa, mudar cobrança ou acessar dados por suporte exige aprovação humana na plataforma e autenticação reforçada quando pertinente.

Proposta registra ator, grant, workspace, operação, alvo, payload canônico, hash, versão do recurso e expiração. Aprovação fica vinculada ao conteúdo exato e ao aprovador. Executar exige revalidação; alterar conteúdo invalida aprovação. Aprovação do próprio modelo não conta como aprovação humana.

Idempotência tem chave única por workspace e execution_id, ou escopo administrativo equivalente. Reuso com payload diferente retorna conflito. Estado e resultado ficam persistidos; efeitos externos usam mecanismo seguro de repetição. Ferramenta longa retorna job_id, com consulta e cancelamento quando tecnicamente possível.

### 17.5 Segurança operacional do MCP

Rate limit por cliente, principal e workspace; teto de concorrência e payload. Binding de sessões ao principal e concessão. Proteger descoberta de clientes/metadados e integrações contra SSRF, redirects indevidos e token passthrough. Token OAuth da plataforma não é encaminhado como credencial do Google ou do LLM.

Auditar cliente, grant, ator, workspace, ferramenta, decisão, request_id, execution_id, resultado e campos alterados filtrados. Resources MCP usam o mesmo controle das ferramentas. Exportações e documentos entregues ao assistente podem sair do ambiente da plataforma; informar isso no consentimento e aplicar minimização.

Chaves pessoais de API podem ser opção complementar para clientes técnicos compatíveis: expiração, escopo e revogação, preferencialmente leitura; não substituem OAuth interoperável. Automação sem usuário usa principal técnico próprio e autorização delimitada; não presumir suporte a client_credentials no Supabase.

## 18 Planos, cotas e cobrança

Empresa limita workspaces e usuários únicos; workspace limita recursos contratados. Convites pendentes podem reservar vagas para evitar estouro no aceite; essa decisão deve ser aplicada de modo transacional e explicada na interface.

Capacidades não dependem de comparar nome de plano no código. Planos têm versões; alterações não modificam contratos existentes silenciosamente. Overrides precisam de motivo, validade e auditoria. Upgrade, downgrade, trial, inadimplência, suspensão e cancelamento têm transições explícitas.

Quota é verificada na transação que reserva ou cria recurso. Consumo é medido no servidor; BYOK não elimina o custo da sua infraestrutura nem seus limites. Falha de chave informa erro acionável sem fallback financeiro implícito.

Downgrade abaixo do uso atual não apaga recursos automaticamente. Definir período de ajuste, bloqueio de novas criações e acesso de leitura conforme contrato. Processar eventos de pagamento com assinatura e idempotência. Provedor de cobrança permanece a selecionar.

## 19 Segurança de aplicação e arquivos

Negação por padrão; autorização por objeto em toda operação. Proteger contra XSS, CSRF conforme mecanismo de autenticação, SQL injection, SSRF e abuso de endpoints. CORS é política de navegador, não autorização. Sanitizar conteúdo quando necessário e impor limites de entrada, saída e upload.

Buckets privados para documentos, exportações e conteúdo interno; URLs assinadas curtas com permissões verificadas. Arquivos publicados pelo módulo usam processo explícito e recursos separados. Prefixo com workspace_id ajuda organização, mas não substitui policy.

Validar tamanho, tipo real e extensões; impedir execução de conteúdo enviado. Definir quarentena e análise de arquivos antes de aceitar fontes de risco. RAG trata documentos recuperados como dados não confiáveis; acesso a ferramentas depende do servidor, não de instruções no documento.

MFA do admin e revisão de acessos; segredos fora de Git; ambientes separados; logs sem tokens e sem conteúdos pessoais desnecessários. Revisar dependências e privilégios SQL. Usar OWASP ASVS como referência de controles e evidências, sem alegar certificação automática.

## 20 Auditoria, privacidade e LGPD

Logs técnicos, auditoria e consumo são registros diferentes. audit_events recebe event_id, tempo UTC, empresa/workspace, ator real, ator representado quando houver, origem, client/grant, ação, recurso, resultado e correlação. Gravação append-only pela aplicação, sem UPDATE/DELETE comuns; retenção por processo restrito. Auditoria crítica acompanha a transação da mudança ou outbox confiável.

Hashes auxiliam correlação e integridade, mas não tornam logs imutáveis por si só. Registros contra administradores de infraestrutura exigem controle adicional e, conforme risco, cópia externa imutável. IP e user-agent podem ser dados pessoais; coletar somente quando justificado.

Definir finalidade e base legal por tratamento, inventário de dados e responsabilidades. É provável que a plataforma seja controladora de cadastro/cobrança e operadora de parte dos dados de clientes; contratos e prática determinam essa classificação. BYOK não exclui obrigações da plataforma. Consentimento não é base legal universal.

Manter aviso de privacidade, termos e acordo de tratamento com versões; fornecedores/suboperadores, finalidade, localização e condições de IA documentados. Avaliar transferências internacionais e mecanismos válidos; hospedar no Brasil não impede transferência por API estrangeira. Avaliar dados sensíveis e de crianças antes de aceitar esses usos.

Canal de titulares com verificação de identidade, responsável e rastreabilidade; atender direitos aplicáveis, como acesso, correção e exclusão. Exportação comercial de workspace e solicitação de titular são processos diferentes. Retenção por categoria com justificativa; exclusão lógica não substitui eliminação quando exigida.

Exclusão coordena banco, arquivos, vetores, caches e fornecedores sob controle contratual. Backups seguem prazo próprio e ficam fora do uso normal; restauração reaplica registros de exclusão. Não prometer apagar imediatamente cada cópia de backup. Preservação por obrigação legal ou litígio precisa de fundamento e escopo.

Plano de incidentes define contato, detecção, contenção, evidências, avaliação e comunicação. A regra geral do RCIS exige comunicação pelo controlador à ANPD e titulares em três dias úteis para incidentes com risco ou dano relevante, observadas exceções e regras aplicáveis. Contrato do operador precisa viabilizar aviso rápido ao controlador.

A adequação legal depende de documentação, operação e revisão jurídica dos tratamentos reais. Esta especificação organiza controles, sem declarar conformidade por tecnologia escolhida.

## 21 Operação e continuidade

Definir objetivos de disponibilidade, RPO e RTO antes de vender SLA. Proposta inicial sujeita à contratação de infraestrutura: RPO de até 24 horas e RTO de até 8 horas; comprovar em teste antes de assumir compromisso. Menores perdas exigem backup mais frequente/PITR e operação compatível.

Backup do banco não deve ser presumido como backup dos objetos Storage. Verificar cobertura e recuperar ambos. Testar restauração isolada e integridade das permissões; restaurar não pode reativar credenciais ou acessos revogados indevidamente.

Monitorar latência média/P95, taxa de erro, fila, tempo de job, falhas de conexão, storage e consumo. Alertas têm responsável e instrução de resposta. Liveness verifica processo; readiness verifica dependências obrigatórias. Métricas têm tamanho da amostra e estado Sem dados quando necessário.

Jobs persistem antes da execução, com timeouts, tentativas, backoff, resultado e fila de falhas. Reavaliar autorização e suspensão antes do efeito; não armazenar bearer token de usuário em payload de job. Worker usa identidade técnica com grant de execução e payload mínimo.

Não usar tarefas em memória nem execução após resposta como garantia de conclusão. Limitar concorrência por cliente. Hospedagem Node pode começar em contêiner com processo worker separado; sessões MCP e streaming exigem configuração compatível do proxy e timeouts. Arquitetura permite separar serviços depois por necessidade medida.

## 22 Experiência e empresas de diferentes portes

Dashboard responsivo, navegação por teclado, foco visível, rótulos, contraste e feedback claros. Usar WCAG 2.2 AA como alvo de implementação e testar fluxos críticos; shadcn/ui não garante acessibilidade após customização. Tabelas com paginação, filtros e estados vazios úteis.

Mostrar ambiente ativo em ações sensíveis e no consentimento MCP. Confirmar exclusões e explicar limites. Incluir notificações de falha de credencial, convites, jobs e mudanças relevantes. Dados reais em métricas; nenhuma simulação apresentada como produção.

Pequenas empresas recebem configuração simples e papéis fixos. Empresas em crescimento recebem vários workspaces, auditoria e delegação. Grandes empresas podem exigir SSO, SCIM, logs externos, residência de dados, retenção específica, aprovação dupla, pentest e SLA. Avaliar exigências antes de contratar, pois porte não é equivalente a sensibilidade dos dados.

## 23 Implantação por fases

| Fase | Entrega e condição de saída |
| --- | --- |
| 0 Contratos | Aprovar decisões, limites de dados, modelo de autorização, plano e estratégia Prisma/RLS |
| 1 Fundação | Auth, empresas, workspaces, vínculos, convites, RLS e prova de isolamento |
| 2 Dashboard | Shell admin/app, páginas do núcleo, permissões, estados e registro de módulos |
| 3 API e MCP | REST do núcleo, OAuth/grants, leitura MCP e propostas; testar clientes reais |
| 4 Operação | Cofre BYOK, quotas, auditoria, jobs, recuperação, privacidade e observabilidade |
| 5 Módulos | Implementar documentos próprios e conectar módulos por contratos aprovados |
| 6 Produção | Revisão de segurança, testes críticos, restore, procedimentos e liberação controlada |

**(Ordem ajustada por D3: Operação passa a ser a fase 3 e API/MCP a fase 4.)**

Implementar agora isolamento, autorização, auditoria, recuperação, concessões MCP e procedimentos de privacidade. Leitura MCP do núcleo faz parte da base; escritas específicas dependem de ferramenta aprovada e política de execução.

Depois, conforme contratos e demanda: SSO/SCIM, papéis customizados, portal de titulares, SDKs, SIEM, logs imutáveis externos, isolamento dedicado, múltiplas regiões e certificações. Não adiar requisito já exigido pelo risco ou por cliente contratado. Microserviços não são objetivo obrigatório.

## 24 Critérios de aceite e testes

| ID | Evidência exigida |
| --- | --- |
| AC01 | Usuário sem vínculo não lê nem altera outro workspace via REST, Prisma, Data API ou Storage |
| AC02 | Contexto Prisma ausente, inválido ou vazado em conexão reutilizada resulta em bloqueio |
| AC03 | Remover membro, bloquear identidade ou revogar grant impede novas operações com token vigente |
| AC04 | Usuário não eleva papel e não remove último proprietário |
| AC05 | FK impede referência entre registros de workspaces distintos |
| AC06 | Convites expirantes e únicos; criação e aceite respeitam vagas sob concorrência |
| AC07 | Segredos não aparecem em DTO, MCP, logs, telemetria ou erro |
| AC08 | Módulo indisponível ou não contratado bloqueia UI, API, MCP e workers |
| AC09 | MCP workspace não usa token no admin; token de cliente não acessa Data API para ampliar escopo |
| AC10 | tools/list e tools/call respeitam grant e permissões atuais; inputs maliciosos não alteram contexto |
| AC11 | Proposta alterada/expirada não executa; reexecução não duplica efeito |
| AC12 | Exportação e exclusão rastreáveis propagam para dados derivados e arquivos |
| AC13 | Restore recupera banco e Storage no objetivo declarado e reaplica exclusões/revogações |
| AC14 | Auditoria não pode ser editada por papéis comuns; inclui ator e correlação das ações críticas |
| AC15 | Integrações repetidas e pagamentos não duplicam recursos; jobs sobrevivem ao reinício |
| AC16 | Teste de carga valida limites por cliente e evita monopolização de workers |
| AC17 | MFA admin, recuperação e consentimento funcionam sem expor informações sensíveis |
| AC18 | Fluxos críticos de app/admin funcionam em teclado, mobile e estados de falha |

Testar regras com dados locais sintéticos, duas empresas, múltiplos workspaces e usuários com papéis distintos. Testes SQL avaliam policies e grants diretamente, não só a API. Testes de contrato validam REST e MCP. Registrar resultados de testes e falhas conhecidas; não marcar como aprovado o que não foi executado.

## 25 Orientação para Claude Code e Codex

Esta especificação guia ambos os assistentes. Não autoriza alterações de infraestrutura ou execução SQL remota. Trabalhar por entregas pequenas e revisáveis, preservando invariantes de segurança e requisitos em aberto.

Criar no repositório AGENTS.md, instruções compatíveis para Claude Code, docs/context.md, ADRs, matriz de permissões, modelo de dados, OpenAPI, catálogo MCP e registro de pendências. Esses arquivos devem referenciar a especificação vigente e registrar decisões novas sem sobrescrever requisitos silenciosamente.

Cada tarefa segue Contexto, Objetivo, Requisitos, Lógica, Plano, Testes e Critérios de aceite. Primeiro ler o repositório e instruções locais; apresentar solução concreta; implementar somente o escopo; executar testes relevantes; informar arquivos, evidências e limitações. Não preencher configuração interna dos módulos por suposição.

Quando os dois assistentes trabalharem no mesmo projeto, usar branches ou worktrees isolados e proprietário definido por alteração; evitar migrations concorrentes e revisão simultânea do mesmo arquivo. Um assistente pode revisar a implementação do outro. Não assumir execução paralela automática.

Invariantes: nenhuma consulta de cliente sem contexto; nenhuma autorização apenas no layout; nenhum segredo no client; nenhuma operação MCP sem grant; nenhuma ferramenta genérica privilegiada; nenhuma migration remota automática; nenhum dado fictício como métrica real; nenhuma mudança de plano que apague recursos implicitamente.

## 26 Pendências antes da implementação

| Pendência | Proposta ou responsável |
| --- | --- |
| Nome, marca e domínio | **Resolvido: GUIDU (provisório), console.guidu.co** |
| Herança de acesso empresarial | Proposta de concessão explícita; produto confirma |
| Planos, preços e cotas | Comercial define números e política de vagas |
| Escopo de dados sensíveis | Produto e avaliação jurídica definem |
| Infraestrutura e recuperação | Operação valida RPO/RTO e cobertura de backup |
| Prisma com RLS | Engenharia prova isolamento antes de liberar (spike F0.3) |
| OAuth do MCP | Spike valida Supabase, scopes, audience e clientes reais (spike F0.4) |
| Clientes e ferramentas MCP | Começar com núcleo e clientes aprovados |
| Provedores e cobrança | Selecionar com contratos e requisitos de privacidade |
| Retenção e privacidade | Definir por categoria com responsabilidades |
| Configurações dos três módulos | Permanecem abertas em documentos separados |

## 27 Referências oficiais

Consultadas em 7 de outubro de 2026. Revalidar na implementação.

1. Next.js Server and Client Components — https://nextjs.org/docs/app/getting-started/server-and-client-components
2. Next.js Authentication — https://nextjs.org/docs/app/guides/authentication
3. Next.js Backend for Frontend — https://nextjs.org/docs/app/guides/backend-for-frontend
4. Supabase RLS — https://supabase.com/docs/guides/database/postgres/row-level-security
5. Supabase Prisma — https://supabase.com/docs/guides/database/prisma
6. Supabase SSR — https://supabase.com/docs/guides/auth/server-side/creating-a-client
7. Supabase Vault — https://supabase.com/docs/guides/database/vault
8. Supabase Storage — https://supabase.com/docs/guides/storage/security/access-control
9. Supabase SMTP — https://supabase.com/docs/guides/auth/auth-smtp
10. Supabase OAuth Server — https://supabase.com/docs/guides/auth/oauth-server
11. Supabase MCP Authentication — https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
12. Supabase OAuth Token Security — https://supabase.com/docs/guides/auth/oauth-server/token-security
13. MCP Authorization — https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
14. MCP Streamable HTTP — https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
15. OWASP ASVS — https://owasp.org/projects/asvs
16. LGPD — https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
17. ANPD Incidentes — https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis
18. ANPD Transferências internacionais — https://www.gov.br/anpd/pt-br/assuntos/noticias/resolucao-normatiza-transferencia-internacional-de-dados
19. Google Business Profile Prerequisites — https://developers.google.com/my-business/content/prereqs

