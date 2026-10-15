# CF3. E-mail e notificações

Pedido do Marcelo em 14/10/2026: "sim, sem o hook, pode começar". Os e-mails de login (confirmar e-mail, redefinir senha) continuam saindo do Supabase Auth; o "Send Email Hook" fica para uma etapa à parte, que depende de aprovação porque mexe no Auth.

Base: levantamento.md, itens 4 (E-mail) e 14 (Notificações).

## O que já existe

- `src/core/notifications`: um ponto de entrada (`notify`), modelos em código nos 3 idiomas, idioma do destinatário e marca do parceiro.
- Os eventos atuais são: convite, cobrança em atraso, cobrança suspensa, chave reserva da IA em uso e agente pausado.
- `notification_deliveries` registra cada entrega com uma chave de idempotência.
- O transporte está desligado, então toda entrega fica como "skipped / no_provider".
- O convite não manda e-mail: a tela mostra o link para copiar.

## Divisão proposta

### CF3a. Envio (Resend): feita, PR #80

- **Transporte Resend** pela API HTTP, sem SDK. A chave de idempotência vai no cabeçalho `Idempotency-Key`.
  - Variáveis: `RESEND_API_KEY` e `EMAIL_FROM_ADDRESS` (endereço de domínio verificado no Resend).
  - Sem a chave, o transporte continua desligado, como hoje.
- **Configurações em cascata** (catálogo da CF1):
  - `email.from_name`: vazio usa o nome da marca;
  - `email.reply_to`: vazio usa o e-mail de suporte da marca.
  - Níveis: plataforma e parceiro. O cliente não muda nada.
- **Endereço do remetente:** é sempre o da plataforma. O endereço próprio do parceiro depende de verificar o domínio dele no Resend e entra junto com "domínio de envio" (CF7).
- **Telas** em Configurações › E-mail, na /platform e no /admin, com o card Envio:
  - estado do provedor (só leitura);
  - nome do remetente e responder para;
  - botão "Enviar e-mail de teste" para o próprio usuário.
- **Convite por e-mail:** passa a sair pelo `notify`, com a marca do host. O link para copiar continua na tela.

### CF3b. Modelos: feita, PR #81

Ficou de fora: ligar e desligar (todos os eventos atuais são essenciais), logo no e-mail, e o texto padrão ainda não lê as edições de Plataforma › Idiomas.

- Assunto e corpo por evento e idioma, editáveis.
- **Tags:** só `{{...}}` simples, sem lógica, e só as do evento. Todo valor é escapado.
- **Quem edita:** a plataforma edita a base e o parceiro sobrescreve para os clientes dele. O cliente não edita.
- Prévia na tela e botão para voltar ao texto padrão.
- **Ligar e desligar:** só os e-mails não essenciais. Segurança e cobrança não desligam.

### CF3c. Sino e preferências: feita em 15/10/2026, branch claude/cf3c-sino (commit 09844e7), aguardando PR

- Avisos dentro do app (tabela por usuário) e um sino no cabeçalho, à direita, com contagem de não lidos, lista e "marcar como lido".
- Preferências em Minha conta: uma matriz evento × canal (e-mail, app), com os obrigatórios travados.
- O `notify` passa a distribuir para os canais conforme as preferências.

Cada parte é um PR com testes SQL, de integração e e2e. As migrations são aplicadas no dev pelo Marcelo depois do PR.

## Decisões tomadas sem perguntar

- A API do Resend é chamada por `fetch`, sem pacote novo.
- Nesta etapa não há SMTP próprio do parceiro.
- Push, SMS, resumo periódico e canal de status (Slack) ficam para depois, como no levantamento.
