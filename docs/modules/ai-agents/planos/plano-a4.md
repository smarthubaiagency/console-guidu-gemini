# Plano da A4: telas do `/app` (GUIDS) e "Testar agente"

Marcelo deu o "pode começar" em 13/10/2026, depois do merge da A3c (PR #67). A base é a especificação (`docs/modules/ai-agents/especificacao.md`, seções 5.1 a 5.4), `campos.md` e o que a A1, a A2 e a A3 deixaram na `main`.

## O que já existe

- `listGuids`, `listGuidTemplates` e `createGuid` (com o limite do plano), no módulo.
- `testGuidKey` (A2c): testa a chave e marca `lastTestedAt`.
- `sendGuidTestMessage`: cria uma conversa de teste (canal `test`) e enfileira o turno no worker. As ferramentas, porém, **gravam de verdade**; ainda não existe modo simulado.
- O editor de 5 abas, com os editores `customer` e `customer_custom` prontos, e o cofre de chaves do workspace (`listWorkspaceCredentials`).
- Faltam: abrir um GUIDS com a configuração, salvar, personalizar, excluir, indicações pelo `/app`, ler as mensagens de uma conversa de teste e o chat na gaveta.

## Como dividir

Duas PRs, cada uma com o seu "pode começar" depois da primeira:

| Parte   | Entrega                                                                                                                                                                                                                                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A4a** | Telas do `/app`: lista dos GUIDS com o limite do plano; criar a partir de um modelo ou "Personalizado"; editor na gaveta (o cliente muda a conexão de modelo; quando personaliza, também visão geral, escopo, regras e indicações); escolher a chave do cofre do workspace e testá-la; ligar e pausar; personalizar; excluir; "Alterado por <parceiro> em <data>" |
| **A4b** | **Testar agente**: chat na gaveta com o prompt e a conexão reais e as ferramentas em modo simulado (mostram o que fariam, sem gravar), contando no consumo; registro do teste com sucesso na versão atual da configuração                                                                                                                                         |

## Decisões

- **Personalizar:** a configuração passa a ser do GUIDS; o modelo de origem fica só como referência (§5.2). Não volta atrás; pede confirmação.
- **Indicações no `/app`:** só quando o GUIDS está personalizado (§5.2: "só quando personaliza"). Elas valem para o workspace inteiro.
- **Excluir GUIDS:** só owner e admin do workspace (`ai_agents.manage`), com confirmação. O editor do workspace vê e testa, mas não altera.
- **Ativar só depois de testar** (§5.3): aprovado por Marcelo em 13/10/2026, entrou na A4b.
- **Campos do negócio:** o cliente preenche o resumo do negócio e os produtos e serviços sem personalizar (Marcelo, 13/10/2026).

## Regras que valem para as duas

- shadcn (ADR 0014), gaveta interna (ADR 0015), SmartStatusBanner (ADR 0016), `NativeSelect`, textos em pt-BR, en e es.
- O servidor confere de novo cada campo (mesma divisão do editor) e audita antes e depois, sem segredo.
- Continua atrás da flag `GUIDU_MODULE_AI_AGENTS_ENABLED`.

## Testes

- Integração dos serviços novos com RLS, unitários onde houver regra pura e e2e de cada tela, no passo do CI com a flag ligada.
- Aceite local completo em cada parte.

## Como ficou a A4a

- **Sem migration.** As políticas da A1 já deixam o workspace alterar e excluir os seus GUIDS e as indicações.
- **Tela** `/app/<workspace>/ai-agents`: lista com o limite do plano ("0 de 1"), "Novo agente" (modelo publicado ou Personalizado) e o editor na gaveta.
- **Seguindo o modelo**, o cliente muda só a conexão de modelo (chave do cofre do workspace, modelo) e liga ou pausa. Os campos do negócio (resumo, produtos e serviços) que o modelo não traz ficam com o parceiro no `/admin`, ou o cliente personaliza.
- **Personalizar** pede confirmação e não volta. Depois disso o cliente muda visão geral, escopo, regras e indicações; ferramentas, resultado esperado e destino dos leads continuam do parceiro.
- **Ligar** exige os campos mínimos e uma chave que não esteja com falha; trocar a chave ou passar no "Testar chave" libera.
- **Excluir** pede confirmação; as conversas vão junto e o consumo fica.
- **Indicações** num componente compartilhado entre `/admin` e `/app`.
- Um teste de tradução automática que contava qualquer `{` como argumento passou a usar o mesmo critério do validador; quebrou só porque o número de textos mudou.

## Como ficou a A4b

- **Migration** `20261104090000_a4b_guid_test.sql`: o GUIDS guarda a versão da configuração que passou no teste (`tested_config_hash`, `tested_at`). Só a função do motor grava; o web não consegue marcar uma configuração como testada.
- **Testar agente** na gaveta: chat com prompt, chave e modelo reais; a tela relê a conversa até a resposta chegar. Ferramentas simuladas (mostram o que fariam com `simulated: true`); só a memória da conversa de teste é gravada. O consumo conta. Funciona com o GUIDS pausado ou em rascunho; com a chave em falha pede o "Testar chave" antes.
- **Ligar** exige um teste com sucesso, com a chave do cliente, da configuração que está sendo salva. Um GUIDS já ligado continua ligado se a configuração mudar; a gaveta avisa que a nova versão não foi testada.
- **Campos do negócio** liberados ao cliente sem personalizar.
- As ferramentas com efeito real (contato, nota, pontuação, transferência) seguem cobertas por teste direto até os canais da A5.
