# Perfil digital: comparação dos relatórios do Haiku, Gemini e Opus

14/10/2026. Os três relatórios estão nesta pasta (`docs/modules/perfil-digital/`):

| Modelo                          | Relatório                                                                | Resumo                               | Commit  |
| ------------------------------- | ------------------------------------------------------------------------ | ------------------------------------ | ------- |
| Haiku 5.5                       | [analise-legado.md](analise-legado.md) (768 linhas, 67 KB)               | [resumo.md](resumo.md)               | 569dac2 |
| Gemini (assinado "Antigravity") | [analise-gemini-legado.md](analise-gemini-legado.md) (943 linhas, 88 KB) | [resumo-gemini.md](resumo-gemini.md) | bf3af98 |
| Opus 5.5                        | [analise-opus-legado.md](analise-opus-legado.md) (857 linhas, 142 KB)    | [resumo-opus.md](resumo-opus.md)     | 23fdcae |

Todos leram o legado `cartaopro-linkko` no commit d739429 e o GUIDU na `main` a6f83c4. Para desempatar, conferi no código do legado e do GUIDU cada ponto em que eles discordam (seção 3).

## 1. Veredito

1. **Opus é o melhor, com folga.** Acertou todos os pontos de divergência que conferi, trouxe sete problemas que os outros dois não viram e fez a proposta de módulo mais madura (versões publicadas do template, funções públicas `security definer`, cotas, etapas DP0 a DP6). É o mais longo, mas quase não tem enchimento: o tamanho vem de tabelas com citação `arquivo:linha`.
2. **Haiku vem em segundo.** Enxuto, honesto (marca "inferido" e "não verificado" e tem um anexo do que não leu) e certo na maior parte. Errou quatro fatos que mudam conclusão: disse que não há anti-spam (há honeypot), que a Bio aparece na página pública (não aparece), que o SEO do perfil prevalece sobre o do template (nunca é lido) e tratou o e-mail como bloqueio, quando o Resend já estava decidido na `main` que ele leu.
3. **Gemini fica em terceiro.** É o mais bem diagramado e o que mais explica o motor de cores, mas escreve como peça de venda ("indiscutivelmente", "altíssima performance", "zero client JS") e várias afirmações não se sustentam no código: diz que cliques são medidos, que o formulário público está protegido contra lead no workspace errado e que a página não tem JavaScript no navegador. Também cita linha errada do schema do GUIDU e propõe slug único global, o que conflita com domínio por workspace.

Uso recomendado: **o relatório do Opus como base do planejamento**, com dois complementos do Gemini (a explicação da cascata de cores e o modo "não guardar dados", que encaminha o lead por e-mail) e o anexo de pontos não verificados do Haiku.

## 2. Notas por critério

Escala de 1 a 5.

| Critério                                                           | Haiku | Gemini | Opus |
| ------------------------------------------------------------------ | ----- | ------ | ---- |
| Precisão factual (seção 3)                                         | 3     | 2      | 5    |
| Profundidade e achados próprios                                    | 3     | 3      | 5    |
| Citações verificáveis                                              | 4     | 3      | 5    |
| Honestidade sobre o que não sabe                                   | 5     | 2      | 4    |
| Mapeamento para o GUIDU                                            | 3     | 3      | 5    |
| Proposta de módulo                                                 | 3     | 3      | 5    |
| Clareza e estilo do projeto (frases curtas, sem adjetivo de venda) | 4     | 2      | 4    |
| Concisão                                                           | 5     | 3      | 3    |

## 3. Pontos em que discordam, conferidos no código

| Ponto                               | Haiku                                        | Gemini                                                         | Opus                                                 | O que o código mostra                                                                                                                                                                              |
| ----------------------------------- | -------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seções que a página pública desenha | Inclui Bio, Contato, Site, Arquivos, Horário | Inclui Bio, Wallet, Chat, Horário como módulos                 | Só 6: Hero, CTA, Social, Map, QR, Links              | **Opus.** `ProfileRenderer.tsx:128-285` só tem `case` para esses 6. Bio e as flags `show_*` têm editor, mas não aparecem para o visitante.                                                         |
| Variantes de hero                   | 4 variantes                                  | 4 variantes                                                    | Gravadas, mas sempre `HeroPremium`                   | **Opus.** O renderizador só importa e usa `HeroPremium`.                                                                                                                                           |
| Anti-spam no formulário             | Nenhum                                       | Honeypot `_hp`                                                 | Só honeypot, sem limite de taxa                      | **Gemini e Opus.** `app/api/contacts/route.ts:201` e `contacts/form/route.ts:27`.                                                                                                                  |
| Lead no workspace errado            | Só cita a página e a vCard                   | Diz que a rota é segura porque resolve o workspace no servidor | Lead, vCard e formulário buscam só por slug          | **Opus.** As duas rotas de lead filtram só `slug` com `limit: 1` (`contacts/route.ts:214-220`, `contacts/form/route.ts:46-52`). Não aceitar `workspace_id` do cliente não resolve colisão de slug. |
| Cliques em CTA e links              | Não medidos                                  | Medidos (`cta_click`)                                          | Não medidos                                          | **Haiku e Opus.** Nenhum código grava `cta_click` nem `vcard_save`; o painel lê `vcard_save`, que fica sempre zero.                                                                                |
| SEO por perfil                      | Prevalece sobre o do template                | Prevalece                                                      | Nunca é usado                                        | **Opus.** A página lê `Profile_SEO_Title` (`[...segments]/page.tsx:74`), mas a coluna é `profile_seo_title`.                                                                                       |
| Troca de slug                       | Só admin                                     | Não trata                                                      | Membro troca pela rota `professional`, sem histórico | **Opus.** `professional/route.ts:8` aceita `slug` como campo do usuário.                                                                                                                           |
| `header_scripts`                    | Sem leitor                                   | Risco de XSS armazenado                                        | Sem uso                                              | **Haiku e Opus.** Não há leitor no repositório; o risco do Gemini é hipotético.                                                                                                                    |
| Contraste                           | Nenhuma validação                            | Contraste verificado por WCAG                                  | Cor de contraste automática                          | **Meio a meio.** `getContrastColor` escolhe preto ou branco para alguns tokens derivados; tokens digitados à mão não são conferidos.                                                               |
| Ordem das camadas do tema           | Duas fontes de verdade, sem detalhe          | Camada 4 (JSON) prevalece                                      | Camada 5 (sementes) sobrescreve 3 e 4                | **Opus.** `buildTheme.ts:113-121` aplica as sementes por último.                                                                                                                                   |
| Junção template ↔ seções            | Tem `sort`, `is_visible`, `style`            | Permite sobrescrever por template                              | Só tem ids; ordem fica compartilhada                 | **Opus.** `schema-dump.sql:2004-2008`: só `id`, `templates_id`, `profile_sections_id`.                                                                                                             |
| "Zero client JS" na página          | Não afirma                                   | Afirma                                                         | Não afirma                                           | **Errado no Gemini.** O `ProfileRenderer` importa componentes de cliente como `BottomNav`, `PWAInstallSheet` e `HeroCTAChat` (`ProfileRenderer.tsx:22-27`).                                        |
| E-mail como bloqueio                | Bloqueado (D-PA-08)                          | Não cita                                                       | Aviso por e-mail na DP2                              | **Opus.** `docs/pendencias.md:8` já registra Resend decidido; falta só a conta e as variáveis.                                                                                                     |

## 4. Achados que só um deles trouxe

**Só o Opus** (todos conferidos):

- Admin de qualquer workspace marca o próprio template como mestre (`templates/[id]/route.ts:52`), e mestres aparecem para todos os workspaces (`profiles.ts:41-59`). Vazamento entre clientes.
- Política de privacidade com HTML do admin publicado sem sanitização (`PrivacyView.tsx:67`). XSS armazenado no domínio público.
- Anexos do formulário vão para o storage antes da checagem de consentimento: arquivo órfão quando o envio é recusado.
- Rota de canal (`/nfc/maria`) não passa as regras de design ao tema: o mesmo cartão pode ter cores diferentes.
- `lang` do HTML fixo em `pt-BR` nas versões `/en` e `/es`; sem sitemap.
- Quatro fontes de verdade para o papel de admin.
- No GUIDU, a cota `core.public_domains` vale 0 por padrão: sem decidir um endereço padrão, o cartão não tem URL.

**Só o Gemini:** o modo de privacidade do workspace que não grava o lead e o encaminha por e-mail (`data-treatment.ts`); o Opus também cita, mais curto. A descrição mais didática do motor de cores (escala de 11 paradas e regras do `smart_design_system`).

**Só o Haiku:** vCard sem escape em `EMAIL`, `URL` e `X-SOCIALPROFILE` (injeção de linhas no .vcf); webhook de lead sem bloqueio de rede interna (SSRF); `otp_code` no mesmo registro lido pela página pública; anexo listando o que não foi verificado.

## 5. Onde os três concordam

Com três leituras independentes e conferência no código, estes pontos têm confiança alta:

- Os dados do cartão moram no Directus, sem RLS; o isolamento depende de filtros escritos à mão.
- Links, redes e SEO ficam no template e qualquer membro os edita, mudando o cartão da unidade inteira. Não trazer.
- Hash de IP sem sal, reversível.
- Nenhum teste cobre o perfil digital.
- Upload aceita SVG; token do Chatwoot em texto puro.
- No GUIDU: `workspace_locations` já guarda endereço e horário; `workspace_domains` e `resolvePublicDomain` estão prontos; o contrato de módulos só aceita destino `app` e `admin` e precisa de destino público com ADR; o papel `member` do legado vira `editor`; tema em JSON validado por Zod em vez de 96 colunas.
- MVP sem Wallet, NFC e PWA.

## 6. Onde as recomendações divergem

| Decisão                  | Haiku                                      | Gemini                | Opus                                                       | Minha posição                                                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------ | --------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace do legado vira | `Organization` (hipótese)                  | `Organization`        | `Workspace`                                                | **Workspace.** No legado o workspace guarda contatos, domínios, templates, unidades e perfis, e uma conta só pertence a um workspace. No GUIDU é o workspace que tem CRM, domínios e módulos. A `company` do legado é só marca: vira empresa (`Organization`) e marca. |
| Unidade                  | `workspace_locations` + vínculo de membros | `workspace_locations` | Grupo do módulo com local opcional                         | **Grupo com local opcional (Opus).** Sua premissa fala em "filial ou setor"; setor não tem endereço, e o local continua sendo reaproveitado quando existe.                                                                                                             |
| Chave                    | `digital-card`                             | `digital-profile`     | `digital-profile`                                          | `digital-profile`, "Perfil digital".                                                                                                                                                                                                                                   |
| Slug                     | Único por workspace                        | Único global          | Único por workspace, histórico único por workspace         | Por workspace, porque o endereço é por domínio do workspace.                                                                                                                                                                                                           |
| Template                 | Um por local, seções em tabela             | JSON com seções       | JSON com blocos, versões e campos que o membro pode editar | Opus. Sem rascunho e publicação, toda gravação vai ao ar na hora, como no legado.                                                                                                                                                                                      |
| Leads                    | `CrmContact` + tabela de vínculo           | CRM                   | CRM + `digital_profile_submissions`                        | Opus, e ele aponta o que o CRM precisa mudar (`created_by` obrigatório, sem origem nem consentimento).                                                                                                                                                                 |
| Métricas                 | Eventos com sal                            | Eventos com HMAC      | Eventos brutos + agregado diário                           | Opus.                                                                                                                                                                                                                                                                  |
| Etapas                   | MVP com leads                              | MVP sem leads         | DP1 sem leads, DP2 leads                                   | Opus, com a DP2 logo em seguida.                                                                                                                                                                                                                                       |

## 7. Observações de forma

- O Gemini se apresenta como "Antigravity (Google DeepMind)" e cita o caminho de uma pasta do Windows; não deixou mensagem de commit. Usa negrito e exclamação em excesso e adjetivos que o padrão de escrita do projeto evita.
- Haiku e Opus seguem o padrão do projeto: frases curtas, "inferido" quando é dedução, citação em cada afirmação.
- O Opus separa citações do legado e do GUIDU (`guidu:`), o que facilita conferir.
