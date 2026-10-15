# Levantamento das configurações (plataforma, admin, app)

Iniciado em 2026-10-14 a pedido do Marcelo: definir as configurações de cima para baixo (plataforma > admin do parceiro > app do cliente) antes de seguir com A7, para que todo limite e toda dependência já tenham um campo definido. Marcelo passa páginas de referência de outro sistema, uma a uma; para cada uma registramos o que aproveita, o que sai e onde mora. No final, construímos as páginas de settings.

## Regra de herança

Cada campo diz em que nível nasce e se o nível de baixo pode sobrescrever (plataforma define padrão e teto; parceiro ajusta dentro do teto; cliente ajusta dentro do que o parceiro libera).

## Menu da plataforma (proposta de 2026-10-14, a confirmar)

Geral, Marca, Idiomas, Segurança, E-mail, Notificações, Armazenamento, Cobrança, IA, API, Integrações, Módulos, Domínios, Jurídico, Auditoria e LGPD, Operações.
Já existem: Marca, Idiomas, Módulos, IA, Chaves de API, Faturamento, Jurídico, Operações.

## Páginas de referência

(uma seção por página: aproveita / sai / campos / nível / herança)

### 1. Geral (referência WACRM, recebida 2026-10-14)

Hoje: `/platform/brand` (marca do parceiro casa, versionada) tem nome, cor, logo, e-mail e URL de suporte; parceiro tem a mesma tela no /admin (white label, ADR 0012). `APP_URL` vem do ambiente e é usado na checagem de origem (segurança). `organizations.max_seats` existe, opcional.

| Campo da referência                      | Decisão proposta                                                                                                                                    | Nível / herança                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Platform name                            | Já existe (Marca › nome)                                                                                                                            | Plataforma = padrão; parceiro sobrescreve na marca dele      |
| Tagline                                  | Aproveita: novo campo na Marca (login, e-mails)                                                                                                     | Plataforma padrão; parceiro sobrescreve                      |
| Primary URL                              | Fica no ambiente (`APP_URL`), só leitura na tela; editar pela tela abriria brecha na checagem de origem                                             | Só plataforma                                                |
| Support email                            | Já existe (Marca › e-mail e URL de suporte)                                                                                                         | Plataforma padrão; parceiro sobrescreve                      |
| Default seats per new org                | Aproveita, mas vai para Cobrança/planos: assentos vêm do plano; aqui só o padrão quando não há plano                                                | Plataforma teto; parceiro define por plano; cliente não muda |
| WhatsApp chat button (site de marketing) | **Decidido (Marcelo, 2026-10-14):** vira "contato comercial por WhatsApp" na Marca (número, rótulo, mensagem pronta), mostrado no login e no rodapé | Plataforma padrão; parceiro sobrescreve na Marca             |
| Preview da marca                         | Já existe (prévia na Marca)                                                                                                                         | —                                                            |

Proposta: Geral fica só com o que é da plataforma como operadora (URL só leitura, fuso e idioma padrão, contato do operador); identidade visual fica em Marca, que é herdável pelo parceiro.

### 2. Marca / Branding (referência WACRM, recebida 2026-10-14)

Hoje: nome, cor primária, e-mail e URL de suporte, um logo (PNG, JPEG ou WEBP, conferido pelos bytes), versões a cada salvamento, prévia. Na referência o cliente (workspace) pode ter white label próprio; aqui o white label é do parceiro (ADR 0012) e o cliente não tem marca.

| Campo da referência                   | Decisão proposta                                                                                                                                                                   | Nível / herança                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Logo claro                            | Já existe (logo único)                                                                                                                                                             | Plataforma padrão; parceiro sobrescreve |
| Logo escuro                           | Aproveita: novo, usado no modo escuro; sem ele, o claro                                                                                                                            | Idem                                    |
| Favicon                               | Aproveita: novo (PNG ou ICO quadrado)                                                                                                                                              | Idem                                    |
| Imagem de compartilhamento (1200x630) | Aproveita: novo, prévia de links no WhatsApp etc.                                                                                                                                  | Idem                                    |
| Cor primária                          | Já existe                                                                                                                                                                          | Idem                                    |
| Cor de destaque com paleta pronta     | Aproveita como opcional; sem ela, derivada da primária. Passa pelo validador de contraste                                                                                          | Idem                                    |
| "Use URL" nas imagens                 | Sai: só upload. URL externa esbarra na CSP e em rastreio de terceiros                                                                                                              | —                                       |
| SVG                                   | Sai: SVG pode carregar script; seguimos com PNG, JPEG, WEBP (ICO no favicon)                                                                                                       | —                                       |
| Texto do rodapé com HTML simples      | Aproveita como texto puro com links (sem HTML), para não abrir XSS                                                                                                                 | Idem                                    |
| Prévia ao vivo                        | Já existe; passa a mostrar logo escuro e destaque                                                                                                                                  | —                                       |
| White label por workspace             | **Decidido (Marcelo, 2026-10-14):** marca própria vai até o parceiro; o cliente (/app) herda a marca do seu parceiro; o white label do parceiro é configurado no /admin (ADR 0012) | Plataforma > parceiro; cliente herda    |

Também entram na Marca, vindos da página Geral: tagline e contato comercial por WhatsApp.

### 3. Idiomas e região / Localization (referência WACRM, recebida 2026-10-14)

Hoje: `/platform/settings/languages` cadastra idioma (código e nome), liga/desliga e define o padrão; traduções existem só para pt-BR, en e es. Moeda: o Portfólio grava moeda por preço, padrão BRL fixo no código. Fuso: por local do workspace (padrão America/Sao_Paulo) e por agente de IA.

| Campo da referência        | Decisão proposta                                                                                           | Nível / herança                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Idioma padrão              | Já existe                                                                                                  | Plataforma padrão; parceiro escolhe o padrão dos seus clientes; workspace escolhe o seu |
| Idiomas habilitados (107)  | Aproveita, mas só oferece idioma com tradução pronta (hoje pt-BR, en, es); idioma sem tradução não aparece | Plataforma habilita; abaixo só escolhe entre os habilitados                             |
| Idioma reserva da tradução | Aproveita (texto que falta cai nele)                                                                       | Só plataforma                                                                           |
| Membros escolhem o idioma  | Aproveita                                                                                                  | Plataforma liga; parceiro e workspace podem travar                                      |
| Moeda padrão               | Aproveita: substitui o BRL fixo no código                                                                  | Plataforma padrão; parceiro; workspace                                                  |
| Moedas habilitadas         | Aproveita, lista curta (BRL, USD, EUR...)                                                                  | Plataforma habilita                                                                     |
| Fuso padrão                | Aproveita (padrão America/Sao_Paulo)                                                                       | Plataforma padrão; parceiro; workspace e local                                          |
| Fusos habilitados          | Sai: restringir fusos não protege nada; todos os IANA ficam disponíveis                                    | —                                                                                       |
| Formato de data e hora     | Sai como campo fixo: segue o idioma do usuário (Intl), como já fazemos                                     | —                                                                                       |
| RTL automático             | Sai por ora: nenhum idioma nosso é RTL; volta se um entrar                                                 | —                                                                                       |
| Prévia (moeda, data, hora) | Aproveita                                                                                                  | —                                                                                       |

### 4. E-mail: envio (SMTP) e modelos (referência WACRM, recebidas 2026-10-14)

Hoje: `src/core/notifications` só com e-mail; transporte desligado até escolher o provedor (D-PA-08), entregas gravadas como "não enviadas". Modelos prontos em pt-BR, en, es para: convite, cobrança em atraso, cobrança suspensa, chave reserva da IA em uso, agente pausado. E-mails de login (confirmar e-mail, redefinir senha, link mágico) hoje saem do Supabase Auth, com modelos e SMTP configurados no Supabase, fora do nosso painel e sem a marca do parceiro.

| Campo da referência                 | Decisão proposta                                                                                                                                             | Nível / herança                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| E-mail gerenciado embutido (padrão) | Aproveita: um provedor transacional da plataforma (**D-PA-08 decidida por Marcelo em 2026-10-14: Resend**)                                                   | Só plataforma                                                            |
| SMTP próprio                        | Depois: parceiro com SMTP ou domínio próprio entra junto com Domínios                                                                                        | Parceiro (futuro)                                                        |
| Provedor                            | Aproveita, só leitura ou escolha entre os suportados; chave cifrada como as outras                                                                           | Só plataforma                                                            |
| Nome do remetente                   | Aproveita                                                                                                                                                    | Plataforma padrão; parceiro sobrescreve (white label)                    |
| E-mail do remetente                 | Aproveita, mas só de domínio verificado; parceiro usa o da plataforma até ter domínio próprio                                                                | Plataforma; parceiro com domínio verificado                              |
| Responder para                      | Aproveita                                                                                                                                                    | Plataforma padrão; parceiro sobrescreve                                  |
| Modelos: assunto e corpo por evento | Aproveita, por idioma (pt-BR, en, es), com as nossas tags `{{...}}` sem lógica (não Handlebars completo), com prévia                                         | Plataforma base; parceiro sobrescreve para os seus clientes; cliente não |
| Ligar/desligar cada e-mail          | Aproveita só para e-mails não essenciais (boas-vindas, fim do teste); segurança e cobrança não desligam                                                      | Plataforma; parceiro nos não essenciais                                  |
| Lista de eventos                    | Nossa lista: convite, cobrança em atraso, suspensão, chave reserva, agente pausado; novos: boas-vindas, fim do teste, fatura, aviso de lead por e-mail (A6a) | —                                                                        |
| Confirmar e-mail, redefinir senha   | Entram nos nossos modelos com a marca do parceiro via "Send Email Hook" do Supabase Auth (precisa de aprovação, mexe no Auth)                                | Plataforma; parceiro sobrescreve                                         |

Proposta de menu: uma entrada "E-mail" com abas Envio e Modelos.

### 5. Armazenamento / Storage (referência WACRM, recebida 2026-10-14)

Hoje: não há armazenamento de arquivos. O logo da marca fica no banco (até 256 KB); mídia do Portfólio guarda links; anexos de canal passam sem ficar guardados. A A7 (base de conhecimento) e as imagens novas da Marca (logo escuro, favicon, imagem de compartilhamento) vão precisar de armazenamento. Cotas por plano já existem em `src/core/entitlements` (chaves `<módulo>.<item>`).

| Campo da referência       | Decisão proposta                                                                                                                                  | Nível / herança                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Provedor                  | Aproveita: Supabase Storage (mesmo projeto), só leitura na tela; buckets privados com RLS por workspace                                           | Só plataforma                                                  |
| Bucket padrão, região     | Sai da tela: vêm do ambiente (região é a do projeto Supabase)                                                                                     | —                                                              |
| Upload máximo (MB)        | Aproveita                                                                                                                                         | Plataforma teto; parceiro pode baixar por plano                |
| Cota por organização (GB) | Aproveita como cota do plano (`storage.max_gb`), não campo solto; plataforma tem o padrão sem plano                                               | Plataforma padrão e teto; parceiro por plano; cliente vê o uso |
| Tipos permitidos (MIME)   | Aproveita, mas sem "vazio libera tudo": lista fechada padrão (imagens, PDF, documentos de texto, áudio); tipo conferido pelos bytes, como no logo | Plataforma; módulo pode restringir mais                        |
| Antivírus nos uploads     | Aproveita como opção desligada até haver serviço (ClamAV ou provedor); arquivos de cliente que o agente lê ou envia ganham com isso               | Só plataforma                                                  |
| (novo) Uso por workspace  | Mostrar uso e cota no /app e no /admin                                                                                                            | —                                                              |

### 6. Segurança (referência WACRM, recebida 2026-10-14)

Hoje: login é do Supabase Auth (senha, sessão, limites de tentativa e senha vazada ficam na configuração do Auth do projeto, não no nosso banco). MFA existe e já é exigida em ações sensíveis (`requireMfa`). HTTPS e HSTS são fixos no código (`src/core/security/headers.ts`); CSP com nonce (F6a). Eventos de auditoria existem (`audit_events`).

| Campo da referência                       | Decisão proposta                                                                                                                          | Nível / herança                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Tamanho mínimo, exigir símbolos e números | Aproveita, mas mora no Supabase Auth; a tela mostra o valor e muda pela API de gestão do Supabase (só com aprovação, mexe no Auth)        | Só plataforma                                                  |
| Verificar senha vazada (HIBP)             | Aproveita: recurso do Supabase Auth (plano pago), ligar em produção                                                                       | Só plataforma                                                  |
| Tempo de sessão                           | Aproveita: Supabase Auth (sessão por tempo e por inatividade)                                                                             | Plataforma; parceiro pode encurtar para o /admin dele (futuro) |
| Tentativas e bloqueio                     | Aproveita via limites do Supabase Auth; só leitura na tela                                                                                | Só plataforma                                                  |
| Forçar HTTPS                              | Sai: sempre ligado, não é opção                                                                                                           | —                                                              |
| Lista de IPs global                       | Sai como global (uma lista errada tranca todo mundo). Entra como lista opcional por área: /platform (plataforma) e /admin (cada parceiro) | Plataforma para /platform; parceiro para o /admin dele         |
| (novo) MFA obrigatória                    | Aproveita da "Central de segurança": exigir MFA por área (/platform sempre; parceiro decide para o /admin e para os clientes dele)        | Plataforma; parceiro; workspace pode exigir para a equipe      |
| Central de segurança (eventos ao vivo)    | Aproveita como tela de leitura em cima de `audit_events` (logins, MFA, chaves, mudanças de papel)                                         | Plataforma vê tudo; parceiro vê os seus                        |

Proposta: entrada "Segurança" com abas Senha e sessão, Acesso (MFA e IPs), Eventos.

### 7. Autenticação (referência WACRM, recebida 2026-10-14)

Hoje: não há cadastro público. Entra-se por convite (`/invite`, `/partner-invite`) e login com e-mail e senha (`/login`, esqueci/redefinir senha). Clientes são criados pela plataforma ou pelo parceiro. MFA por TOTP existe. Papéis: plataforma, parceiro e workspace são separados (ADR 0012).

| Campo da referência            | Decisão proposta                                                                                                                | Nível / herança                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Cadastro público               | Fica desligado; se um dia ligar, é por parceiro (página de cadastro com a marca dele, cria cliente em teste no plano escolhido) | Plataforma libera; parceiro liga para o seu domínio  |
| Workspaces só por convite      | Já é assim (padrão e único modo hoje)                                                                                           | —                                                    |
| Exigir verificação de e-mail   | Aproveita, sempre ligado (Supabase Auth); convite já confirma o e-mail                                                          | Só plataforma                                        |
| Exigir MFA para todos          | Coberto na Segurança › Acesso (por área)                                                                                        | ver item 6                                           |
| Google OAuth                   | Aproveita: login com Google; usa o mesmo app OAuth do Google da G1 (decisão pendente de quem é dono)                            | Plataforma liga; parceiro pode desligar para os seus |
| Apple OAuth                    | Sai por ora (pouco uso em B2B; exige conta Apple Developer)                                                                     | —                                                    |
| SAML SSO                       | Depois: só para clientes grandes, plano Enterprise (Supabase cobra à parte)                                                     | Plataforma; por cliente                              |
| Link mágico                    | Aproveita como opção (Supabase Auth), desligado por padrão                                                                      | Plataforma; parceiro                                 |
| Papel padrão de novos usuários | Sai como campo único: o papel vem do convite (quem convida escolhe); o padrão sugerido do convite pode ser "membro"             | —                                                    |

Login social e link mágico ligam provedores no Supabase Auth: mudança de Auth, precisa de aprovação do Marcelo.

### 8. Cobrança / Billing (referência WACRM, recebida 2026-10-14)

Hoje `/platform/billing` já é mais completo que a referência: catálogo de planos (preço mínimo, repasse mínimo da plataforma, preço base ao parceiro, intervalo, módulos), split por parceiro, prazos (atraso após 3 dias, suspensão após 7, provisórios até a D-PA-13), bloqueio de parceiro, pagamentos com evidência e estorno. Modelo: a plataforma vende ao parceiro, o parceiro vende ao cliente, split no gateway (Iugu e Stripe previstos e desligados; cobrança manual/simulada hoje, D-PA-14). Nota fiscal depende do contador (D-PA-05).

| Campo da referência                                  | Decisão proposta                                                                                                 | Nível / herança                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Moeda padrão                                         | Vem de Idiomas e região (item 3); cobrança em BRL enquanto o gateway for nacional                                | Plataforma; parceiro                                          |
| Dias de teste                                        | Aproveita: por plano (o parceiro define o teste dos planos dele dentro do teto da plataforma)                    | Plataforma teto; parceiro por plano                           |
| Carência de pagamento                                | Já existe (atraso e suspensão)                                                                                   | Plataforma; parceiro pode ser mais generoso (futuro, D-PA-13) |
| Prefixo da fatura                                    | Aproveita                                                                                                        | Plataforma para as faturas dela; parceiro para as dele        |
| Razão social, CNPJ, endereço                         | Aproveita: dados de quem emite (plataforma para o parceiro; parceiro para o cliente), usados na fatura e na nota | Plataforma; parceiro (cadastro do parceiro)                   |
| Cobrança automática na renovação                     | Aproveita quando o gateway estiver ligado (cartão ou boleto recorrente)                                          | Plataforma liga; parceiro escolhe por plano                   |
| Preços com imposto incluso                           | Aproveita, padrão "sim" no Brasil; detalhe fiscal depende da D-PA-05                                             | Plataforma                                                    |
| Painel de cobrança (faturas, inadimplência, receita) | Já existe em parte (pagamentos e evidência); receita e inadimplência entram depois                               | Plataforma vê tudo; parceiro vê os seus                       |
| (página Payments)                                    | Proposta: aba Gateway dentro de Cobrança (Iugu/Stripe, chaves cifradas, webhook)                                 | Só plataforma                                                 |

### 9. Gateways de pagamento / Payments (referência WACRM, recebida 2026-10-14)

Hoje: porta `PaymentProvider` (`src/core/billing/provider.ts`) com capacidades por provedor; adaptadores `manual` (ativo) e `planned` (Iugu e Stripe, desligados, D-PA-14). Nosso modelo exige **split** (plataforma e parceiro recebem na mesma cobrança), o que filtra gateways.

| Item da referência                                                | Decisão proposta                                                                                                                                                                                                                                          | Nível                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Lista de gateways com liga/desliga, padrão, sandbox/produção      | Aproveita como aba "Gateway" em Cobrança. Só gateways com split: Iugu, Stripe Connect (e, se quiser, Asaas ou Pagar.me, com Pix e boleto). Paddle e Lemon Squeezy saem (são revendedores, sem split ao parceiro); PayPal e Razorpay saem (fora do Brasil) | Só plataforma                           |
| Etiquetas de capacidades (checkout, portal, reembolso parcial...) | Aproveita: já existem como `capabilities` da porta                                                                                                                                                                                                        | —                                       |
| Credenciais                                                       | Aproveita: cifradas no banco como as outras chaves, mostradas mascaradas                                                                                                                                                                                  | Só plataforma                           |
| Saúde dos webhooks (entregas, falhas, latência)                   | Aproveita                                                                                                                                                                                                                                                 | Só plataforma                           |
| Enviar webhook de teste                                           | Aproveita                                                                                                                                                                                                                                                 | Só plataforma                           |
| Reprocessar webhooks com falha                                    | Aproveita (guardar o corpo recebido; reprocessar é idempotente)                                                                                                                                                                                           | Só plataforma                           |
| Histórico de mudanças                                             | Aproveita: vem do `audit_events`                                                                                                                                                                                                                          | Só plataforma                           |
| URL base do webhook                                               | Sai: derivada do `APP_URL`                                                                                                                                                                                                                                | —                                       |
| Descrição na fatura do cartão                                     | Aproveita; com split, por parceiro (nome dele na fatura do cliente)                                                                                                                                                                                       | Plataforma padrão; parceiro             |
| Captura automática                                                | Sai: assinatura não usa pré-autorização                                                                                                                                                                                                                   | —                                       |
| Tentar de novo pagamento com falha                                | Aproveita (régua de cobrança, junto com os prazos da D-PA-13)                                                                                                                                                                                             | Plataforma; parceiro por plano (futuro) |
| Painel de gateways (histórico, reembolsos, sincronia)             | Já existe em parte (pagamentos e evidência)                                                                                                                                                                                                               | Plataforma; parceiro vê os seus         |

### 10. WhatsApp (referência WACRM, recebida 2026-10-14)

Hoje: WhatsApp chega pelo Chatwoot de cada cliente (core channels, A5); não falamos direto com a Cloud API da Meta. Campanhas com template (jornada do Raio X, Meta Business Marketing) e inbox próprio estão em avaliação (Marcelo, 2026-10-14). O aviso ao comerciante sai pelo webhook do parceiro (A6a), nunca pelo número Meta.

| Campo da referência                            | Decisão proposta                                                                                              | Nível                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Versão da Graph API                            | Só se ligarmos a Cloud API direto: campo da plataforma                                                        | Só plataforma                         |
| WABA padrão                                    | Sai: WABA e números são de cada cliente, nunca da plataforma                                                  | Cliente (via Embedded Signup, futuro) |
| Limite global de mensagens/s                   | Aproveita no futuro: teto da plataforma para não estourar o limite da Meta; por cliente vem do tier do número | Plataforma teto                       |
| Tamanho máximo de mídia                        | Sai como campo: limites são da Meta (fixos por tipo); seguimos a tabela de capacidades já usada na A5c        | —                                     |
| Revisão interna de templates                   | Aproveita para campanhas: o parceiro aprova o template do cliente antes de mandar à Meta                      | Plataforma liga; parceiro revisa      |
| Plataforma WhatsApp (WABAs, números, webhooks) | Futuro: só se virarmos Tech Provider da Meta (Embedded Signup). Até lá, Integrações › Chatwoot                | —                                     |

Recomendação: não abrir entrada "WhatsApp" no menu agora; registrar como seção futura de Integrações, ligada à decisão de inbox próprio e campanhas.

### 11. Provedores de IA / AI Providers (referência WACRM, recebida 2026-10-14)

Hoje: provedores no código (`src/core/ai/providers.ts`): OpenAI, Anthropic, Google, OpenRouter. Nenhuma chave global no ambiente; cada chave é cifrada no banco e pertence a alguém: cliente (GUIDS, BYOK), parceiro (Assistente no /admin e perguntas no /app), plataforma (chave reserva por 24h, `/platform/ai/backup`). Modelos de agente em `/platform/ai/templates`. Uso registrado por turno; cota `ai-agents.max`.

| Item da referência                                          | Decisão proposta                                                                                                          | Nível                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Cartões de resumo (provedores, requisições, gasto, atenção) | Aproveita: painel de IA na plataforma, com uso e erros por provedor e por parceiro; parceiro vê o dos seus clientes       | Plataforma; parceiro                               |
| Lista de provedores com liga/desliga                        | Aproveita: plataforma liga quais provedores os clientes e parceiros podem escolher                                        | Plataforma; parceiro pode restringir para os seus  |
| Modelos por provedor e "sincronizar modelos"                | Aproveita: catálogo de modelos permitidos por provedor (hoje o cliente digita o modelo); sincronizar pela API do provedor | Plataforma; parceiro escolhe os modelos dos planos |
| Testar chave                                                | Já existe (`key-test.ts`)                                                                                                 | Todos os níveis                                    |
| Chave por "nome de segredo" do ambiente                     | Sai: nosso modelo é chave cifrada no banco, de cada dono (BYOK); não há chave global                                      | —                                                  |
| Provedor por workspace com prioridade e padrão              | Já é por dono (cliente, parceiro, plataforma reserva); prioridade vira a ordem: chave do cliente > reserva da plataforma  | Já decidido (A2)                                   |
| Base URL personalizada (gateway compatível com OpenAI)      | Aproveita como opção da plataforma (ex.: gateway próprio, Azure); só https e com DNS fixo como nos canais                 | Só plataforma                                      |
| Cotas                                                       | Aproveita: limites de uso por plano (tokens ou conversas por mês) além de `ai-agents.max`                                 | Plataforma teto; parceiro por plano                |
| Avisos (chave faltando, provedor com erro)                  | Já existe em parte (aviso de chave reserva e agente pausado); entra no painel                                             | Plataforma; parceiro; cliente                      |

Proposta de menu: "IA" com abas Painel, Provedores e modelos, Modelos de agente (já existe), Chave reserva (já existe).

### 12. API pública (referência WACRM, recebida 2026-10-14)

Hoje: API REST `/api/v1` (workspaces, plataforma, OpenAPI em `/api/v1/openapi.json`) e servidor MCP; sempre com chave (ADR 0009) com escopos; limites por minuto vêm do ambiente: 60 por chave, 120 por usuário, 300 por workspace (`src/core/api/rate-limit.ts`, Redis). Sem CORS (a API é chamada de servidor, não do navegador). Chaves: `/platform/api-keys` (plataforma) e por workspace no /app.

| Campo da referência                      | Decisão proposta                                                                                                              | Nível / herança                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| API pública ligada                       | Aproveita como "liga/desliga de emergência" da plataforma; por cliente, a API é recurso do plano (módulo/cota)                | Plataforma; parceiro por plano      |
| Exigir chave                             | Sai: sempre exigida, não é opção                                                                                              | —                                   |
| Limite padrão (req/min)                  | Aproveita: os três limites (chave, usuário, workspace) saem do ambiente para a tela, com teto da plataforma e valor por plano | Plataforma teto; parceiro por plano |
| CORS (`*` libera tudo)                   | Sai: API só de servidor para servidor; se um dia houver uso no navegador, lista fechada por cliente, nunca `*`                | —                                   |
| Versões depreciadas (aviso no cabeçalho) | Aproveita para quando houver v2 (cabeçalhos `Deprecation` e `Sunset`)                                                         | Só plataforma                       |
| (novo) Escopos permitidos por plano      | Aproveita: o plano diz quais escopos as chaves do cliente podem ter                                                           | Plataforma; parceiro por plano      |
| (novo) Uso por chave                     | Mostrar chamadas e erros por chave no /app e na plataforma                                                                    | —                                   |

Mesma regra vale para o MCP (mesmas chaves e limites).

### 13. Integrações: Google Workspace (referência WACRM, recebida 2026-10-14)

Hoje: nada de Google no código; plano da G1 em `docs/operacao/plano-g1.md` (uma conexão Google OAuth por workspace em Configurações › Integrações; Drive, Planilhas, Agenda). Pendência da G1: quem é dono do app OAuth no Google Cloud e da verificação (escopos sensíveis). Integrações por cliente já existentes: Chatwoot (Configurações › Canais, ADR 0011).

| Item da referência                                                                    | Decisão proposta                                                                                                                                                      | Nível                                                              |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Configurar o conector uma vez, usuários autorizam a própria conta                     | Aproveita: é o desenho da G1                                                                                                                                          | Plataforma configura; workspace conecta a conta                    |
| Chave de cliente e de gateway de um conector terceiro                                 | Sai: falamos direto com o Google OAuth, sem gateway intermediário (menos um terceiro com acesso aos dados)                                                            | —                                                                  |
| (no lugar) Client ID e Client Secret do app OAuth                                     | Aproveita: segredo cifrado, nunca devolvido à tela; URL de retorno mostrada só leitura                                                                                | Só plataforma                                                      |
| Dono do app OAuth                                                                     | **Decidido (Marcelo, 2026-10-14):** app da GUIDU por padrão (uma verificação só); parceiro pode cadastrar o próprio app depois para ter a marca dele no consentimento | Plataforma; parceiro opcional no /admin                            |
| (novo) Escopos liberados (Drive, Planilhas, Agenda) e status da verificação do Google | Aproveita                                                                                                                                                             | Plataforma liga; parceiro pode desligar para os seus; plano libera |
| (novo) Login com Google                                                               | Usa o mesmo app (ver item 7)                                                                                                                                          | Plataforma                                                         |

Menu: "Integrações" na plataforma lista os apps que a plataforma registra (Google; futuro: Meta/WhatsApp, item 10). Conexões do cliente (Chatwoot, conta Google) ficam no /app › Configurações.

### 14. Notificações (referência WACRM, recebida 2026-10-14)

Hoje: `src/core/notifications` com e-mail (Resend decidido, ainda não ligado), entregas gravadas em `notification_deliveries`; webhook do parceiro para avisos de lead e indicação (A6a/A6b, assinado com HMAC); sem aviso dentro do app, sem push, sem SMS.

| Canal / campo                                    | Decisão proposta                                                                                                             | Nível / herança                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| E-mail                                           | Aproveita (Resend)                                                                                                           | Plataforma liga; usuário escolhe quais recebe (exceto segurança e cobrança)                                       |
| No app (sino no cabeçalho)                       | Aproveita: novo; lista de avisos por usuário no cabeçalho de 60px (ícones à direita)                                         | Plataforma; usuário                                                                                               |
| Push (web e celular)                             | Depois: só com app ou PWA                                                                                                    | —                                                                                                                 |
| SMS                                              | Depois: sem provedor; o WhatsApp do Assistente (webhook do parceiro) cobre o caso de "chegar no celular"                     | —                                                                                                                 |
| Webhook (fan-out de eventos)                     | Já existe para avisos de lead e indicação; amplia para mais eventos (cobrança, chave, agente pausado) com a mesma assinatura | Plataforma lista eventos; parceiro cadastra o webhook dele (já em /admin › Assistente; vira /admin › Integrações) |
| Resumo periódico (digest)                        | Aproveita: diário ou semanal, opcional, junta avisos não urgentes num e-mail                                                 | Plataforma padrão; usuário escolhe                                                                                |
| Canal de status do sistema (Slack/Teams/Discord) | Aproveita para a equipe da plataforma: falhas de jobs, webhooks, chave reserva em uso                                        | Só plataforma (e parceiro, opcional, para os dele)                                                                |
| (novo) Preferências por evento                   | Matriz evento x canal, com o que é obrigatório travado                                                                       | Plataforma define; usuário ajusta                                                                                 |

### 15. Manutenção (referência WACRM, recebida 2026-10-14)

Hoje: `/platform/operations` mostra saúde (banco, workers), filas, falhas de jobs, volume e privacidade (exclusões, retenção). Não há modo manutenção.

| Campo da referência                       | Decisão proposta                                                                                                                          | Nível         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Modo manutenção (só superadmin entra)     | Aproveita: bloqueia /app e /admin com página de aviso; /platform continua para admins da plataforma; API responde 503 com `Retry-After`   | Só plataforma |
| Modo somente leitura                      | Aproveita: leituras liberadas, gravações recusadas com aviso (SmartStatusBanner); jobs e webhooks de entrada ficam na fila, não se perdem | Só plataforma |
| Início e fim agendados                    | Aproveita; antes do início, faixa de aviso para todos ("manutenção hoje às 23h")                                                          | Só plataforma |
| Mensagem aos usuários                     | Aproveita, nos 3 idiomas                                                                                                                  | Só plataforma |
| IPs liberados                             | Sai: quem entra é admin da plataforma logado (com MFA), não por IP                                                                        | —             |
| (novo) Agentes de IA durante a manutenção | GUIDS seguem respondendo nos canais em somente leitura? Proposta: em manutenção total, os canais recebem e guardam, e respondem ao voltar | Só plataforma |

Fica dentro de "Operações" (aba Manutenção), junto da saúde e das filas.

### 16. Analytics (referência WACRM, recebida 2026-10-14)

A referência mede um site de marketing (CTAs, preços, formulário de lead), que não temos. No painel logado não há rastreio hoje; a CSP com nonce bloqueia scripts de terceiros sem liberação explícita.

| Campo da referência                                              | Decisão proposta                                                                                                               | Nível                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Provedor e identificador (público)                               | Aproveita para o produto (uso do painel), não para marketing: Plausible ou PostHog, liberado na CSP só o domínio escolhido     | Só plataforma              |
| Rastrear visitas de página                                       | Aproveita, sem dados pessoais (sem e-mail, sem conteúdo de conversa); só rota e área                                           | Só plataforma              |
| Exigir consentimento de cookies                                  | Aproveita (LGPD): sem consentimento, nada é enviado; Plausible dispensa cookie                                                 | Plataforma; parceiro herda |
| Depurar no console                                               | Aproveita só fora de produção                                                                                                  | —                          |
| Eventos de site de marketing (cta, pricing, whatsapp, lead form) | Sai: não há site; eventos do produto no lugar (login, criou agente, conectou canal, ativou GUIDS)                              | —                          |
| Analytics do parceiro                                            | Proposta: parceiro pode pôr o identificador dele para a marca dele (login e /app dos clientes dele), com o mesmo consentimento | Parceiro (opcional)        |

Fica em "Geral" (aba Analytics) ou "Integrações". Depende da revisão jurídica de LGPD (D-PA-06).

### 17. Módulos / Feature toggles (referência WACRM, recebida 2026-10-14)

Hoje já existe a cascata completa: `/platform/modules` define a disponibilidade de cada módulo (ligado, manutenção, desligado); o plano lista os módulos que inclui (Cobrança › planos); o workspace liga/desliga entre os que o plano libera (Configurações › Módulos); configurações globais por módulo em `/platform/settings/modules/<módulo>`. Módulos: ai-agents (Assistente e GUIDS), crm, portfolio, google-business (só manifesto), hello-world (exemplo).

| Item da referência                        | Nosso equivalente / decisão                                                                                                | Nível                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| AI Assistant                              | `ai-agents` (Assistente GUIDU + GUIDS)                                                                                     | Plataforma > plano > workspace |
| Sales CRM                                 | `crm` (já existe; negócios e funil entram na etapa CRM)                                                                    | Idem                           |
| Campanhas (disparos, segmentos)           | Futuro: módulo de campanhas ligado ao Raio X e templates Meta                                                              | Idem                           |
| Automações sem código                     | Futuro (hoje os parceiros usam n8n por webhook)                                                                            | —                              |
| BI (relatórios, painéis)                  | Futuro; começa pelos painéis de uso (IA, API, armazenamento)                                                               | —                              |
| Base de conhecimento (RAG)                | A7, dentro de `ai-agents` (não é módulo separado)                                                                          | Plano libera                   |
| Notas internas                            | Já no Chatwoot (nota privada do handoff, A5c)                                                                              | —                              |
| Recursos beta para workspaces que aceitam | Aproveita: novo estado "beta" na disponibilidade do módulo; plataforma escolhe os workspaces (ou o parceiro, para os dele) | Plataforma; parceiro           |
| (nosso) Portfólio, Google Business        | Já são módulos                                                                                                             | —                              |

## Sugestões além da referência (Claude, 2026-10-14)

1. **Planos e limites** como entrada própria (hoje espalhado): uma tabela única com todas as chaves de cota (`seats`, `storage.max_gb`, `upload.max_mb`, `ai-agents.max`, uso de IA por mês, limites da API, escopos da API, dias de teste) com o teto da plataforma e o valor de cada plano. É o que garante "todo limite tem campo definido" antes das próximas etapas.
2. **O que o parceiro pode mudar**: uma matriz única (campo x "parceiro pode sobrescrever?") em vez de regra espalhada; vira a fonte para o /admin.
3. **Domínios**: domínio próprio do parceiro (painel e login) e domínio de envio de e-mail (verificação no Resend).
4. **Auditoria e LGPD**: retenção por tipo de dado, exportação e exclusão (hoje parte em Operações › Privacidade), registro de eventos de segurança.
5. **Jurídico**: já existe (termos e privacidade); fica no menu.

## Menu final proposto da plataforma

Geral · Marca · Idiomas e região · Segurança (Senha e sessão, Acesso, Eventos) · Autenticação · E-mail (Envio, Modelos) · Notificações · Armazenamento · Planos e limites · Cobrança (Planos, Gateway, Pagamentos) · IA (Painel, Provedores e modelos, Modelos de agente, Chave reserva) · API · Integrações (Google; futuro Meta) · Módulos · Domínios · Jurídico · Auditoria e LGPD · Operações (Saúde, Filas, Manutenção) · Analytics.
Próximo: o mesmo levantamento para o /admin (parceiro) e o /app (cliente).

## Estrutura das telas de configurações (Marcelo, 2026-10-14)

- Modelo de referência (WaDesk) vale só para a ESTRUTURA; o visual continua o nosso aprovado (shadcn, tokens, cabeçalho 60px, SmartStatusBanner).
- Página de configurações = dois cards dentro do main: à esquerda um card com o submenu (itens agrupados por rótulo de seção, item ativo destacado); à direita o conteúdo, em um ou mais cards por bloco (cada card com seu título e seu Salvar).
- Diretriz geral a partir de agora: o conteúdo do main ocupa a largura toda (ponta a ponta). Páginas já prontas ficam como estão e são ajustadas nos ajustes finos.
- Vale para /platform, /admin e /app (a mesma estrutura nos três níveis). Ao construir: registrar como revisão da ADR 0014 / docs/architecture/ui-shell.md e no catálogo de padrões.
