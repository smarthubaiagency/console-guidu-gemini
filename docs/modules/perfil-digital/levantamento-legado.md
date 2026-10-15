# Cartão digital: levantamento do legado (cartaopro-linkko)

Levantado em 14/10/2026 a partir do código do `smarthubaiagency/cartaopro-linkko` (commit d739429, 07/09/2026), do `_bmad-output/product-vision.md` (gerado em 25/05/2026) e do `directus-schema-snapshot.json`. Serve de base para cruzar com os relatórios do Haiku, Gemini e Opus quando o Marcelo enviá-los. O que vem do product-vision é declaração do próprio legado, não conferido rota a rota. Atenção: o product-vision fala em 17 seções, mas a página pública só desenha 6 (Hero, CTA, Redes, Mapa, QR, Links); ver [comparativo-relatorios.md](comparativo-relatorios.md), que substitui este levantamento como referência.

## 1. O que o produto é

CartãoPRO/Linkko: cartão de visita digital multi-tenant. O workspace cria perfis para os colaboradores, acessados por QR, NFC, link e PWA, com analytics, captura de contatos e integrações. Planos Free, Pro, Corporate, cobrados por licença (assento).

Backend duplo: Directus (perfis, templates, contatos, analytics, workspaces, quase tudo) e Supabase com RLS só para notificações e logs de WhatsApp. Isso é o que o GUIDU não repete: aqui tudo fica no Postgres com RLS (ADR 0001, ADR 0010).

## 2. Funcionalidades e estado declarado

| Bloco                 | O que faz                                                                                                                                                                                             | Estado no legado                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Perfil público        | `/[slug]`, `/en/[slug]`, `/es/[slug]`, permalink `/id/[userId]`; 17 seções liga/desliga (`show_*`); SSR com tema dinâmico                                                                             | Produção                                                                            |
| Editor do perfil      | ~20 telas em `/profile/u/[slug]/*`: bio, pessoais, profissionais, contatos, unidade, redes, site, links, CTA, QR, SEO, formulários, horário, rodapé, Chatwoot, Google Business, WhatsApp Conecte, PWA | Produção                                                                            |
| Templates de design   | ~118 campos por template (cores, botões, raios, fonte, hero, SEO, CTA, formulários); master + clone por workspace; `smart_design_system` e `smart_color_presets`                                      | Produção, só admin                                                                  |
| QR code               | Link, URL custom ou vCard embutido (modo offline)                                                                                                                                                     | Produção                                                                            |
| vCard                 | `/api/vcard/[slug]` gera .vcf                                                                                                                                                                         | Produção, sem evento de analytics                                                   |
| Formulário de contato | Captura nome, e-mail, telefone, empresa; cria contato                                                                                                                                                 | Produção; `/api/contacts/form` sem validar workspace (falha de segurança declarada) |
| Formulário de troca   | Troca de cartão B2B com consentimento                                                                                                                                                                 | Produção                                                                            |
| Contatos              | Lista, filtros, notas, tags, CSV, OCR de cartão (OpenAI), sync Chatwoot                                                                                                                               | Produção                                                                            |
| Analytics             | `analytics_events` (perfil, fonte, tipo, ip_hash); fontes NFC, QR, Bio, WhatsApp, Eventos                                                                                                             | Produção                                                                            |
| Unidades              | Filiais com endereço, Maps e horário                                                                                                                                                                  | Produção                                                                            |
| Google Wallet         | Passe por perfil, configurado na empresa                                                                                                                                                              | Produção                                                                            |
| Apple Wallet          |                                                                                                                                                                                                       | Planejado                                                                           |
| Cartão físico NFC     | `physical_cards` (código, perfil, scans NFC/QR, ativação, lote, frente/verso); `/claim/[code]`                                                                                                        | Beta                                                                                |
| Loja de cartões       | `products`, `orders` (Mercado Pago)                                                                                                                                                                   | Mock, sem pagamento                                                                 |
| Domínio próprio       | `domains` + Cloudflare                                                                                                                                                                                | Produção                                                                            |
| Pixels                | GTM, GA4, Meta Pixel no perfil                                                                                                                                                                        | Produção                                                                            |
| Webhooks              | Eventos para fora                                                                                                                                                                                     | Produção                                                                            |
| Modo evento           | Tag, período e mensagem por perfil                                                                                                                                                                    | Parcial                                                                             |
| PWA                   | Manifest por empresa                                                                                                                                                                                  | Produção                                                                            |
| MobioCHAT             | WhatsApp (Evolution/Meta), notificações de lead, Chatwoot, RIE                                                                                                                                        | Produção (fora do escopo do cartão)                                                 |

## 3. Dados principais (Directus)

- `profiles` (74 campos): identidade (nome, pronomes, prefixo, pós-nominais, avatar, capa), profissional (cargo, empresa, unidade), contatos, bio, `show_*` por seção, SEO, modo evento, `remove_branding`, `color_mode`, OTP, `leads_webhook_url`, `is_default`.
- `templates` (118 campos), `profile_sections`, `templates_profile_sections`, `fonts`.
- `companies` (logo, PWA, Wallet, Chatwoot, CNPJ), `units`.
- `physical_cards`, `products`, `orders`, `domains`, `profile_slug_history`, `analytics_events`, `contacts` (40 campos com consentimento LGPD).

## 4. O que o GUIDU já tem e o cartão pode usar

| Legado                    | GUIDU hoje                                                               |
| ------------------------- | ------------------------------------------------------------------------ |
| `domains`                 | `workspace_domains` (CF2b), já pensado para "site, perfil digital, quiz" |
| `contacts`                | Módulo CRM (`crm_contacts`), ainda sem origem, consentimento e tags      |
| `units`                   | `workspace_locations` (núcleo, formato UCP)                              |
| `companies` (marca, logo) | Marca do parceiro (CF2); falta a marca do workspace                      |
| Planos por assento        | CF4 Planos e limites (em PR)                                             |
| Google Business           | Módulo `google-business`                                                 |
| Chatwoot, WhatsApp        | Camada de canais do núcleo (ADR 0011) e GUIDS                            |
| Webhooks de lead          | Avisos de lead do A6 (`partner_notice_webhooks`)                         |
| Idiomas pt/en/es          | Painel já em pt-BR/en/es (ADR 0013)                                      |

## 5. Pontos de atenção herdados

- Template com 118 colunas planas: no GUIDU vale tokens em JSON validado por Zod, como na Marca.
- Formulário público sem validação de workspace e sem limite de taxa: o GUIDU precisa de rota pública com rate limit, captcha ou honeypot e consentimento versionado.
- Analytics por IP hash sem retenção definida: definir retenção e base legal.
- Wallet e NFC dependem de credenciais e logística: candidatos a etapas posteriores.
