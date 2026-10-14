# Perfil Digital (Cartão de Visita) — Resumo Executivo para Decisão

> **Relatório Síntese P0 — GUIDU (`console-guidu-gemini`)**  
> Documento completo com código-fonte e citações linha a linha disponível em: [analise-gemini-legado.md](analise-gemini-legado.md).

---

## O que é a Feature no Legado

O Cartão de Visita Digital Inteligente do CartãoPRO / Linkko permite que empresas criem e gerenciem páginas de apresentação pública personalizadas para seus colaboradores. O cartão funciona como um micro-site profissional responsivo com:
- **Identidade e Bio:** Foto de perfil com recorte dinâmico, nome, cargo, pronomes, sufixos, biografia e tags de competências.
- **Ações Rápidas:** Botões diretos para ligação telefônica, conversa no WhatsApp, envio de e-mail e download de contato **vCard (.vcf)** direto para a agenda do smartphone.
- **QR Code Inteligente:** Renderização vetorial em SVG nos modos "link" ou **"offline"** (codifica todo o vCard no próprio QR Code, permitindo leitura sem internet).
- **Captura de Leads e B2B:** Formulário estendido de contato com upload de anexos e botão de **Troca de Cartão B2B**, com deduplicação por e-mail/telefone e auditoria de consentimento LGPD.
- **Design Corporativo e Unidades:** As filiais/departamentos da empresa (`units`) herdam um **Template** com tokens de design gerados por um algoritmo de cores HSL inteligente (`Smart Design System`).
- **Métricas e Atribuição:** Contagem de acessos em tempo real com rate limit via Redis e anonimização de IP por hashing, discriminando acessos vindos de cartões físicos com chip NFC, QR Code impresso ou redes sociais.

---

## Principais Correções e Achados da Auditoria

1. **Premissa de Unidades e Usuários:**
   - No legado, o cartão público pertence à entidade **`profiles`**, que se vincula à `company`, ao `workspace` e opcionalmente à `unit` (`schema-dump.sql:profiles`).
   - Um usuário (`directus_users`) pode possuir mais de um perfil cadastrado.
2. **Débito de Isolamento nos Links (P-03):**
   - No legado, os links e redes sociais corporativas eram salvos diretamente na tabela `templates` da unidade (`templates.Link`, `templates.network`). Isso fazia com que edições feitas por um colaborador afetassem todos os demais cartões da mesma filial. **No GUIDU, links e redes sociais devem pertencer primariamente ao membro (`DigitalProfile`).**
3. **Ausência de RLS Real no PostgreSQL do Legado:**
   - As tabelas de perfis, unidades e templates residiam inteiramente no Directus sem RLS de banco (`migrations/006_rls_policies.sql:48-50`). A segurança dependia de validações em JavaScript no Next.js. No GUIDU, toda a camada adotará RLS nativo com `withContext`.
4. **Cobertura de Testes:**
   - A feature de perfil digital possui **0% de testes automatizados** no repositório legado.

---

## Mapeamento Arquitetural Canônico para o GUIDU

| Legado (`cartaopro-linkko`) | Canônico no GUIDU (`console-guidu-gemini`) | Status e Decisão |
|---|---|---|
| **Workspace (faturamento)** | **`Organization` (Empresa)** | Titular dos planos e faturamento corporativo no parceiro. |
| **Company (marca/branding)** | **`Workspace` (Ambiente Operacional)** | Onde os módulos, domínios e membros residem. |
| **Unit (filial/endereço)** | **`WorkspaceLocation`** | **Já existe no Prisma schema do GUIDU!** Possui endereço em JSON, coordenadas geográficas e horários de funcionamento (`hours`). Dispensa novas tabelas no Core. |
| **Profile (cartão do membro)** | **`WorkspaceMember` + `DigitalProfile`** | Extensão do membro do workspace contendo os dados do cartão digital e slug único. |
| **Template (design e cores)** | **`DigitalProfileTemplate`** | Tabela própria do módulo com tokens visuais, validação Zod e cores calculadas. |
| **Contacts (leads)** | **`CrmContact` / `DigitalProfileLead`** | Leads capturados no cartão entram no fluxo do módulo CRM com origem marcada. |
| **Domains (domínios próprios)** | **`WorkspaceDomain`** | Já implementado na etapa CF2b via Cloudflare for SaaS e Traefik. |
| **Papéis (`roles`)** | **`owner`, `admin`, `editor`, `viewer`** | O papel `member` do legado vira `editor` (edita seu próprio cartão). |

---

## Estrutura do Novo Módulo no GUIDU

- **Nome e Chave:** Módulo **Perfil Digital** (`digital-profile`).
- **Tabelas Prisma (com RLS por workspace):**
  - `digital_profile_templates`: cores-semente, tipografia, seções e layout.
  - `digital_profiles`: slug único, nome, cargo, bio, avatar, contatos, links e toggles.
  - `digital_profile_slug_history`: preservação de histórico de slugs (redirecionamento 308).
  - `digital_profile_events`: métricas de visualização e cliques com HMAC-SHA256.
- **Páginas no Painel:**
  - **No Parceiro (`/admin`):** Modelos de cartões pré-configurados para clientes da agência.
  - **Na Empresa (`/app`):** Gestão central de cartões, métricas e templates; edição de colaboradores em gaveta lateral (`WorkbenchLayout`, ADR 0015).
  - **No Colaborador (`/my-card`):** Tela simplificada para o próprio usuário gerenciar seus dados e QR Code.
- **Página Pública:**
  - Renderizada como Server Component de altíssima performance, consumindo o resolvedor `resolvePublicDomain` e gerando CSS variables corporativas com zero client JS.

---

## Roadmap Sugerido

- **Fase 1 (MVP Prioritário):** Manifesto do módulo, migration Prisma com RLS, editor de templates com Smart Design, gestão de cartões em `WorkbenchLayout`, página pública SSR com vCard (.vcf), QR Code vetorial e métricas assíncronas.
- **Fase 2 (Captura e Filiais):** Formulários de contato e troca B2B integrados ao CRM, vinculação com `WorkspaceLocation` (Google Maps e horários) e histórico de slugs.
- **Fase 3 (White-Label Avançado):** Passes de carteira Google Wallet e Apple Wallet, PWA dinâmico e integração com o agente de IA SDR (GUIDS).

---

## As 10 Perguntas Principais para Decisão de Marcelo

1. **Adoção de `WorkspaceLocation` para Unidades:** Confirma o uso da tabela nativa existente `workspace_locations` do GUIDU como a representação definitiva de filiais no perfil digital? *(Recomendação: Sim).*
2. **Posse dos Links e Redes Sociais:** No legado, links e redes pertenciam à unidade e vazavam entre todos os membros (P-03). Confirma que no GUIDU links e redes devem pertencer primariamente ao membro (`DigitalProfile`)? *(Recomendação: Sim).*
3. **Extensão do Manifesto para Rotas Públicas:** Aprova a formalização de rotas com destino `public` no contrato de módulos (`manifest.ts`), atendidas pelo runtime de domínios públicos?
4. **Papel do Parceiro no Design (`/admin`):** O parceiro da agência white-label deve poder criar templates corporativos padrão no `/admin` para revenda, ou cada empresa cria seus templates do zero? *(Recomendação: Permitir templates padrão do parceiro na Fase 3).*
5. **Permissões de Membro Comum (`editor`):** O colaborador comum terá permissão apenas de gerenciar seus dados pessoais e visibilidade de seções em tela simplificada (`/my-card`), ficando a criação de templates com os administradores?
6. **Destino dos Leads:** Os contatos capturados no cartão devem ser salvos diretamente na tabela de contatos do módulo CRM nativo do GUIDU?
7. **Provedor de Armazenamento de Arquivos (Pendência F5e):** Qual serviço de armazenamento deve ser integrado para fotos de perfil e logos (Supabase Storage nativo, Cloudflare R2 ou AWS S3)?
8. **Modo Evento com Agente de IA:** Deseja que o Modo Evento do cartão conecte automaticamente um agente de IA (GUIDS) do workspace para fazer follow-up conversacional com os leads?
9. **Anonimização de IP com Salt Corporativo:** Aprova a substituição do hash simples do legado por HMAC-SHA256 com segredo corporativo (`APP_SECRET`), blindando a plataforma contra vazamento de IPs sob a LGPD?
10. **Escopo do MVP (Fase 1):** Aprova a entrega prioritária do MVP (Fase 1: Template, Perfil do Membro, Rota Pública com Domínio Próprio, vCard, QR Code e Analytics com latência zero) postergando Google Wallet e Apple Wallet para a Fase 3?
