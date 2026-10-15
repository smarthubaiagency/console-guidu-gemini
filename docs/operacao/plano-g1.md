# Plano da G1: integração com o Google (prevista)

Etapa prevista em 13/10/2026, a pedido do Marcelo ("não precisa tudo agora mas deixar previsto"), para depois da A5d. Começa só com o "pode começar" dele.

> **Atualização (CF6b, 15/10/2026):** a conexão já existe. O app OAuth da GUIDU fica em Plataforma › Configurações › Google, o parceiro pode cadastrar o dele e desligar escopos em Admin › Configurações › Google, e owner e admin do workspace conectam a conta em Configurações › Integrações (tokens cifrados, `workspace_google_connections`). Detalhes no [plano da CF6b](../configuracoes/plano-cf6b.md) e no [guia](integracao-google.md). Falta a G1 propriamente dita: as ferramentas do GUIDS, a escolha da planilha, da pasta e da agenda, e a renovação do token de acesso com o refresh token.

## Por quê

O pequeno comerciante usa Google Drive, planilhas e agenda no dia a dia. A integração deixa o GUIDS trabalhar com o que o cliente já tem:

- **Drive:** enviar documentos do Drive do cliente sem precisar de link público (hoje, A5d, o documento é um link do item do Portfólio e precisa estar compartilhado como "qualquer pessoa com o link").
- **Planilhas:** gravar os contatos e leads que o agente atende numa planilha do cliente, além do CRM da GUIDU.
- **Agenda:** consultar horários livres e marcar compromissos na agenda do cliente.

## Como (proposta)

- **Conexão no núcleo**, como os canais (ADR 0011): em Configurações › Integrações, owner e admin conectam a conta Google do workspace por OAuth. Os tokens ficam cifrados no cofre, como as chaves de IA.
- **Escopos mínimos:** `drive.file` (só arquivos escolhidos pelo cliente), `spreadsheets` (a planilha escolhida) e `calendar.events` (a agenda escolhida). O cliente escolhe a planilha, a pasta e a agenda na tela da integração.
- **Ferramentas novas do GUIDS**, na allowlist de `src/core/ai/config/tools.ts`: salvar contato na planilha, consultar horários e marcar na agenda; o Drive entra como origem dos documentos do Portfólio. Na conversa de teste, simuladas como as outras.
- **Guarda:** cada chamada com o contexto do workspace, limite de tempo e de tamanho, e auditoria, como as ferramentas do CRM.

## Decisões em aberto (Marcelo)

1. ~~Projeto e app OAuth no Google Cloud~~: decidido em 14/10/2026, app da GUIDU por padrão e do parceiro opcional (feito na CF6b). Falta a conta do Google Cloud e o pedido de verificação (escopos sensíveis), no [guia](integracao-google.md).
2. Ordem: planilha primeiro (o pedido mais forte), depois agenda, depois Drive.
3. Colunas da planilha de contatos e se a planilha é criada pela GUIDU ou escolhida pelo cliente.
4. Agenda: duração padrão, antecedência mínima e se o agente marca sozinho ou só propõe horários.
