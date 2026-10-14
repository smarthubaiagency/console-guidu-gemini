# Perfil digital: resumo para decisão

- **Autor:** Claude (Opus 5.5), 14/10/2026
- **Relatório completo:** [analise-opus-legado.md](analise-opus-legado.md), com as citações `arquivo:linha` de cada afirmação abaixo.

## Como o legado funciona

- **Inquilino é o workspace.** "Empresa" (`companies`) é só um registro de marca dentro dele. Uma conta pertence a um único workspace e pode ter vários cartões.
- **Unidade → template → seções.** Cada unidade aponta para um template, e o template lista as seções por uma tabela de junção. A página pública desenha seis tipos: Hero, CTA, Redes, Mapa, QR e Links. Bio, arquivos, horário e os demais itens do editor não aparecem para o visitante.
- **Design** é guardado em 96 colunas do template mais um JSON de ajuste. O tema real sai de três cores-semente por uma cascata de cinco camadas. Não há versões nem rascunho: toda gravação vale na hora.
- **URL:** `/{slug}`, com idioma (`/en`), canal de origem (`/nfc`), subdomínio do sistema ou domínio próprio (Cloudflare for SaaS), além do histórico de slug com redirecionamento 308 e do link permanente `/id/{uuid}`.
- **Leads:** troca de contato e formulário com honeypot, consentimento LGPD com hash do termo, aviso no WhatsApp e webhooks. Não há limite de taxa.
- **Métricas:** só visitas, com origem e visitantes únicos. Cliques não são medidos.
- **Dados no Directus, sem RLS.** O isolamento depende de cada consulta filtrar o workspace.
- **Testes do perfil digital:** nenhum.

## O que está diferente do que você descreveu

- **"O usuário altera só as suas informações": falso.** Links, redes, SEO e imagem de compartilhamento ficam no template e qualquer membro edita, o que muda o cartão de toda a unidade.
- **"Cada usuário pertence a uma unidade":** a unidade é opcional no perfil, e sem ela o cartão cai num layout mínimo.
- **Papéis:** o legado tem owner/admin/member/viewer, mas na prática só existe "admin ou não". O GUIDU usa owner/admin/**editor**/viewer, sem `member` no workspace.

## Riscos que não devem vir junto

1. Admin de qualquer workspace marca o próprio template como "mestre", e outros workspaces passam a vê-lo e cloná-lo.
2. Leads, vCard e formulário procuram o perfil só pelo slug, sem o workspace, então dois workspaces com o mesmo slug misturam leads.
3. Rotas aceitam `templateId` do cliente e confiam nas permissões do Directus, que não estão no repositório.
4. HTML da política de privacidade é publicado sem sanitização. Uploads aceitam SVG. URLs de links não são validadas.
5. A troca de slug pela rota `professional` não grava histórico, o que quebra QR codes e links antigos.

## Proposta em uma linha por item

- **Módulo:** Perfil Digital, chave `digital-profile`, tabelas `digital_profile_*` com RLS e FK composta.
- **Unidade:** grupo dentro do workspace (`digital_profile_groups`), com local opcional de `workspace_locations`, que já guarda endereço e horário no formato UCP.
- **Template:** `design` e `blocks` em JSON validado, com versões publicadas. O admin define quais campos o membro pode editar.
- **Cartão:** dados pessoais, links e redes pessoais e sobrescritas permitidas. Slug único por workspace, com histórico.
- **Público:** domínio do workspace (`resolvePublicDomain` já existe) → funções `security definer` que devolvem só campos públicos. Tem SEO, Open Graph, vCard e QR.
- **Leads:** CRM pelo serviço público, mais o registro do envio e do consentimento no módulo.
- **Métricas:** eventos de visita e clique por bloco, com agregação diária no worker.
- **MVP (DP1):** template, grupos, cartões, "Meu cartão", página pública, vCard, QR e visitas. Formulários vêm na DP2, cliques na DP3, e PWA, Wallet e NFC na DP5.

## As 5 perguntas mais importantes

1. **Unidade:** grupo dentro do workspace (recomendado), um workspace por unidade, ou o próprio local (`workspace_locations`)?
2. **Endereço sem domínio próprio:** a cota `core.public_domains` vale 0 por padrão. O cartão exige domínio do workspace, ou a plataforma ou o parceiro dão um host padrão?
3. **Links e redes:** são da empresa, do membro, ou dos dois? Quais campos o admin pode liberar para o membro?
4. **Leads no CRM:** podem entrar no CRM? Hoje o contato exige `created_by` de uma pessoa e não guarda origem nem consentimento, então o serviço público do CRM teria de mudar.
5. **Parceiro:** ele só fornece uma biblioteca de templates, ou também edita o design dos clientes no `/admin`? Editar exige revisar a ADR 0012, como foi feito para os agentes de IA.

## Outras perguntas

- Pode haver cartão para quem não tem conta no painel? E vários cartões por pessoa?
- "Editar o próprio cartão" vale também para o papel `viewer`?
- Armazenamento de fotos: Storage ou R2 antes da DP1, ou foto por URL no MVP?
- Os dados do CartãoPRO serão importados? A ADR 0007 exige decisão explícita.
- NFC, Wallet, PWA, chat e WhatsApp Conecte ficam fora do MVP?
- O cartão continua em pt, en e es?
