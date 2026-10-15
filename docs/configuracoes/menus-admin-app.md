# Menus do /admin (parceiro) e do /app (cliente): proposta

Escrito em 2026-10-14 a partir do levantamento da plataforma ([levantamento.md](levantamento.md)). Para revisão do Marcelo. Estrutura das telas de configurações: card do submenu à esquerda e cards de conteúdo à direita, main na largura toda (diretriz de 2026-10-14).

Regra de herança em todos os campos: a plataforma define padrão e teto; o parceiro ajusta para os seus clientes dentro do teto; o cliente ajusta só o que o parceiro liberar. O /app **não tem Marca**: herda a do parceiro.

## /admin (parceiro)

### Menu lateral (operação)

| Item          | O que tem                                                                           | Hoje              |
| ------------- | ----------------------------------------------------------------------------------- | ----------------- |
| Visão geral   | Clientes ativos, receita do mês, avisos (chaves, cobrança, falhas)                  | existe (simples)  |
| Clientes      | Organizações e workspaces dos clientes, status, plano, entrar com acesso de suporte | existe (Clientes) |
| Planos        | Planos do parceiro (preço, limites dentro do teto, teste, módulos)                  | parte em Cobrança |
| Cobrança      | Faturas e pagamentos dos clientes, inadimplência                                    | existe            |
| IA            | Assistente GUIDU, GUIDS dos clientes, modelos de agente, chaves                     | existe            |
| Equipe        | Membros do parceiro e papéis                                                        | existe (Membros)  |
| Suporte       | Acessos de suporte concedidos pelos clientes                                        | existe            |
| Saúde         | Canais, chaves de IA, jobs e webhooks com falha dos clientes dele                   | novo              |
| Configurações | abre o submenu abaixo                                                               | novo              |

### Submenu de Configurações

- **Parceiro**
  - Geral: nome, contato do operador, idioma, moeda e fuso padrão dos clientes, "membros escolhem o idioma"
  - Marca: logo claro e escuro, favicon, imagem de compartilhamento, cor primária e de destaque, tagline, contato comercial por WhatsApp, rodapé, prévia (existe parte)
  - Domínios: domínio do painel e domínio de envio de e-mail (tabela `partner_domains` existe)
- **Comunicação**
  - E-mail: nome do remetente, responder para, e-mail do remetente (com domínio verificado), SMTP próprio (futuro)
  - Modelos de e-mail: assunto e corpo por evento e idioma, sobrescrevendo os da plataforma; liga/desliga dos não essenciais
  - Notificações: webhook de avisos (lead, indicação e demais eventos, existe em IA › Assistente), canal de status (Slack/Teams/Discord), resumo periódico padrão
- **Cobrança**
  - Dados de quem emite: razão social, CNPJ, endereço, prefixo da fatura (perfil existe)
  - Régua de cobrança: teste por plano, tentativas, prazos (dentro do teto)
  - Gateway próprio (futuro): chaves do parceiro, sandbox ou produção
- **Produto**
  - Módulos: o que oferece aos clientes; beta para clientes escolhidos (existe parte)
  - Planos e limites: valores das cotas por plano, dentro do teto
  - IA: provedores e modelos liberados aos clientes; chave do parceiro (existe em IA › Chaves)
  - WhatsApp (futuro): revisão de templates dos clientes antes da Meta
  - Integrações: app Google próprio (opcional), webhooks
- **Sistema**
  - Segurança: MFA obrigatória no /admin e para os clientes, IPs do /admin, eventos de segurança dos seus
  - Credenciais: chaves e segredos do parceiro (tabela `partner_credentials` existe)
  - API: chaves de API do parceiro (futuro) e limites por plano
  - Analytics: identificador próprio (opcional)
  - Jurídico: termos e privacidade da marca dele (existe)

## /app (cliente)

### Menu lateral

Módulos ligados (CRM, Portfólio, Agentes de IA, Propostas, Google Business...), Execuções, e Configurações. (Equipe e workspaces ficam no submenu.)

### Submenu de Configurações (sem Marca)

- **Workspace**
  - Geral: nome, endereço do workspace (só leitura), idioma, moeda e fuso (dentro do que o parceiro liberou)
  - Locais: lojas e horários (existe)
  - Equipe e papéis: membros e convites (existe)
  - Notificações: o que a equipe recebe e por onde (e-mail, no app, webhook)
- **Canais e integrações**
  - Canais: Chatwoot e caixas (existe)
  - Integrações: conta Google (G1)
  - Credenciais: chaves de IA próprias (existe)
  - API e MCP: chaves e uso (existe)
- **Plano**
  - Plano e cobrança: plano atual, faturas, forma de pagamento (existe)
  - Uso e limites: uso x cota (assentos, armazenamento, IA, API) (existe parte)
  - Módulos: liga e desliga entre os do plano (existe)
- **Sistema**
  - Segurança: exigir MFA da equipe, sessões
  - Dados e exportação: exportar, excluir workspace (existe)
  - Suporte: acesso do parceiro (existe)

### Pessoal (todos os níveis, no menu do usuário)

Minha conta: perfil, senha, MFA, idioma, preferências de notificação.

## Plano de construção

Estado em 15/10/2026 (detalhe no [handoff](../handoff/2026-10-15-handoff.md#4-estado-em-15102026)):

- **CF1. Base** (PR #77, ADR 0018): tabela `settings` em cascata, resolvedor, tela de dois cards, Geral e região. Feita.
- **CF2. Marca** (PR #78): imagens no próprio `partner_brands`. Feita.
- **CF2b. Domínios** (PR #79, [plano-dominios.md](plano-dominios.md)). Feita.
- **CF2c. Domínios públicos padrão** (PR #89, [plano-cf2c.md](plano-cf2c.md)). Feita.
- **CF3. E-mail e notificações** (CF3a #80, CF3b #81, CF3c #84, [plano-cf3.md](plano-cf3.md)). Feita.
- **CF4. Planos e limites** (PR #82). Feita.
- **CF5. Segurança, autenticação, manutenção** (CF5a #85, CF5b #87, CF5c #88, [plano-cf5.md](plano-cf5.md)). Feita.
- **CF6a. IA: provedores e modelos** (PR #90, [plano-cf6a.md](plano-cf6a.md)). Feita.
- **CF6b. API e Integrações (com a G1).** Próxima.
- **CF7. Gateway e analytics.** Próxima.
- Em cada etapa as páginas já existentes migram para a nova estrutura.
