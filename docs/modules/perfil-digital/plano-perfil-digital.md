# Perfil digital: planejamento do módulo

- **Versão:** 0.2, 15/10/2026.

Início do planejamento em 14/10/2026, a partir da [comparação dos relatórios](comparativo-relatorios.md). Base técnica: [relatório do Opus](analise-opus-legado.md), com os complementos indicados na comparação. Nada aqui foi implementado.

## 1. O que o módulo entrega

Cartão de visita digital por pessoa do workspace: página pública no domínio do workspace, vCard, QR, métricas de visita e, logo depois, captura de leads para o CRM. O admin define o visual e os blocos por template; o membro edita só os próprios dados e o que o template liberar.

Fica de fora do começo: cartão físico NFC, Google e Apple Wallet, PWA, chat Chatwoot no cartão, WhatsApp Conecte, loja de cartões e importação do CartãoPRO.

## 2. Decisões para o Marcelo

Juntei as perguntas dos três relatórios, sem repetição, na ordem em que travam o trabalho. Cada uma tem a minha recomendação.

**Travam a especificação (DP0):**

1. **Nome e chave. Decidido em 15/10/2026:** "Perfil digital", chave `digital-profile`, tabelas `digital_profile_*`.
2. **Hierarquia. Decidido pelo Marcelo em 15/10/2026:** empresa → workspace (em geral um por empresa) → uma ou várias unidades → um template por unidade → usuários vinculados à unidade. O endereço principal (fiscal) do cliente fica no workspace; cada unidade tem endereço próprio (ex.: Rodobens, uma unidade por estado, cada uma com seu template). Uma empresa pode ter vários workspaces quando precisa separar filiais.
3. **Unidade. Decidido pelo modelo acima.** Defaults que adotei, a confirmar:
   - A unidade é uma linha de `workspace_locations` (endereço, coordenadas e horário já existem e servem a Portfólio, Google Business e agente). O módulo só acrescenta os vínculos.
   - Criar template exige escolher a unidade, e cada unidade tem no máximo um template. Para reaproveitar o visual em outra unidade, o admin duplica o template.
   - Todo cartão pertence a uma unidade e usa o template dela; trocar a unidade troca o template.
   - O cartão só é publicado se a unidade tiver template publicado.
   - O endereço fiscal não é do módulo: entra no cadastro do workspace (núcleo), que hoje não tem esse campo.
4. **Endereço público. Decidido pelo Marcelo em 15/10/2026.** As regras de domínio são da plataforma e estão em [plano-cf2c-dominios-publicos.md](../../operacao/plano-cf2c-dominios-publicos.md). O que vale para o módulo:
   - O cartão publica em `{host}/{slug}`. O host vem da cascata do núcleo: domínio próprio do workspace para perfil digital → padrão do parceiro → padrão da plataforma (ex.: `mobio.pro/{slug}`).
   - O slug é único por host. No domínio padrão, ele é disputado entre todos os workspaces que usam aquele host.
   - O módulo não guarda slug nem histórico em tabela própria: reserva, publica e troca o endereço pelo serviço de endereços públicos do núcleo, que cuida de reservados e redirecionamento 308.
   - Subdomínio por workspace (`rodobens.mobio.pro`) fica fora do MVP.
5. **Links e redes.** Empresa no template e pessoais no cartão, com o admin escolhendo quais campos o membro edita. Recomendo sim.
6. **Rota pública no contrato de módulos.** Estender o manifesto com destino público e registrar numa ADR nova. Sem isso não há página pública.

**Travam a etapa de leads (DP2):**

7. **Leads no CRM.** Sim, pelo serviço público do CRM, que passa a aceitar contato criado por visitante (hoje `created_by` é obrigatório) e a guardar origem e consentimento. O envio fica também em `digital_profile_submissions`.
8. **Aviso de lead.** Por e-mail (Resend, CF3a) ao dono do cartão. O webhook do A6 e o WhatsApp ficam para depois.

**Podem ser decididas durante a implementação:**

9. **Fotos.** Enquanto o storage (F5e) não é escolhido: foto e logo pequenas guardadas na linha, como na Marca (CF2), com recorte no navegador. Capa e imagem de compartilhamento esperam o storage.
10. **Parceiro.** No começo, só uma biblioteca de templates base no `/admin` (DP5). Editar o design dos clientes exige revisar a ADR 0012.
11. **Quem edita o próprio cartão.** Todos os papéis, inclusive `viewer`. Recomendo sim.
12. **Cartão sem conta no painel** (ex.: vendedor externo) e **vários cartões por pessoa.** Recomendo cartão sem conta sim; vários por pessoa não no MVP.
13. **Idiomas da página pública.** pt-BR, en e es, escolhidos por cartão.
14. **Importação do CartãoPRO.** Decisão própria (ADR 0007), depois do MVP.
15. **Mover template e usuários entre workspaces** (ex.: a empresa separa as filiais e a cobrança). Pedido do Marcelo em 15/10/2026: ação do admin (plataforma ou parceiro). Proposta: ferramenta no `/platform` e no `/admin` que move uma unidade inteira (local, template, cartões e histórico de slug) para outro workspace, com auditoria e redirecionamento 308 dos endereços antigos. Atenção: hoje a cobrança é por empresa (`subscriptions.organization_id`), não por workspace. Separar a cobrança de uma filial significa criar outra empresa, e o destino da mudança é um workspace dessa nova empresa. Etapa própria, depois do MVP (DP5).

## 3. Etapas propostas

Cada etapa só começa com o seu "pode começar".

| Etapa | Entrega                                                                                                                                                                           | Migration     |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| DP0   | `MODULE_SPEC.md` do módulo com as decisões acima; ADR da rota pública de módulos                                                                                                  | Não           |
| CF2c  | Plataforma, fora deste módulo: domínios padrão e endereços públicos ([plano-cf2c-dominios-publicos.md](../../operacao/plano-cf2c-dominios-publicos.md)). Pré-requisito da DP1     | Sim           |
| DP1a  | Núcleo: destino público no manifesto de módulos (ADR nova) e rota pública que usa a resolução da CF2c                                                                             | Não           |
| DP1b  | Dados: templates com versões (um por unidade), cartões ligados à unidade, endereço pelo serviço do núcleo (CF2c), RLS e testes com dois workspaces; manifesto, permissões e cotas | Sim           |
| DP1c  | Painel: lista de cartões, editor na gaveta, unidades (sobre `workspace_locations`), editor do template (Design, Blocos, SEO, Prévia, Publicar), "Meu cartão"                      | Não           |
| DP1d  | Público: página com blocos Hero, CTA, Links, Redes, Mapa, QR e Rodapé; SEO e Open Graph; vCard com escape; QR; evento de visita                                                   | Sim (eventos) |
| DP2   | Troca de contato e formulário fixo, no CRM, com consentimento, limite de taxa e aviso por e-mail                                                                                  | Sim           |
| DP3   | Cliques por bloco e por link, agregação diária no worker, tela de métricas                                                                                                        | Sim           |
| DP4   | Formulários personalizados, anexos (com storage), pixels com consentimento, webhooks                                                                                              | Sim           |
| DP5   | Mover unidade entre workspaces (decisão 15), biblioteca de templates do parceiro, PWA, Wallet, cartão físico                                                                      | Sim           |
| DP6   | Importação do legado, se aprovada                                                                                                                                                 | Não           |

## 4. O que não trazer do legado

Conteúdo pessoal no template; `templateId` vindo do cliente; template mestre marcado por workspace; busca de perfil só por slug; slug trocado sem histórico (agora resolvido no núcleo); HTML do admin sem sanitização; upload por MIME do cliente (SVG); vCard sem escape; webhook sem bloqueio de rede interna; hash de IP sem sal; 96 colunas de cor; Directus.

## 5. Próximo passo

Com as respostas das perguntas 5 e 6 e a confirmação dos defaults da 3, escrevo a `MODULE_SPEC.md` (DP0) e o rascunho da ADR da rota pública.

## 6. Histórico

| Versão | Data       | Mudança                                                                                                                                                                |
| ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1    | 14/10/2026 | Primeira versão, a partir da comparação dos relatórios                                                                                                                 |
| 0.2    | 15/10/2026 | Decisão 4 refeita: endereço `{host}/{slug}` com cascata de domínios; subdomínio por workspace fora do MVP; regras de domínio movidas para o plano da CF2c (plataforma) |
