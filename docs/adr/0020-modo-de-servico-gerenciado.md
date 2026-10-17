# ADR 0020 — Modo de serviço: padrão e gerenciado

- **Status:** Proposto (etapa G0); vira aceito com a aprovação do Marcelo no PR
- **Data:** 16/10/2026
- **Aprovador:** Marcelo
- **Origem:** [especificação do módulo Google Meu Negócio](../modules/google-business/especificacao.md), seção 3
- **Relaciona-se com:** [ADR 0012](0012-plataforma-de-parceiros.md) (parceiros), P4b2 (acesso de suporte temporário, `partner_support_grants`), [especificação dos Agentes de IA](../modules/ai-agents/especificacao.md), seção 12 (conversas exigem acesso de suporte)

## Contexto

Hoje o parceiro não lê dados do cliente (CRM, conversas, base de conhecimento) sem um acesso de suporte concedido por pessoa e com prazo (1 a 72 horas). Isso serve ao cliente que usa a ferramenta sozinho, mas não ao cliente que contrata a GUIDU ou o parceiro para gerenciar a presença dele: "não faz sentido o cliente me contratar para gerenciamento e não me permitir gerenciar seus dados" (Marcelo, 16/10/2026).

## Decisão

1. **Cada empresa tem um modo de serviço:** `padrao` ou `gerenciado`. O modo é da empresa (o contrato) e vale para todos os workspaces dela.
2. **Padrão** (o cliente paga a ferramenta): o cliente opera tudo; o parceiro e a GUIDU veem só a situação dos módulos, sem os dados. O suporte continua pelo acesso pontual da P4b2. É o modo de quem entra pelo onboarding.
3. **Gerenciado** (o cliente paga gestão e consultoria): a equipe do parceiro que gerencia (ou da GUIDU, no parceiro zero) tem acesso ao **workspace inteiro** da empresa (GUIDS, campanhas, avaliações, CRM, conversas e configurações), sem pedir acesso de suporte.
4. **Como o gerenciado começa:**
   - **No contrato:** o parceiro cadastra o cliente como gerenciado e a cláusula de gerenciamento entra nos termos que o cliente aceita no primeiro acesso (aceite da P4b, com prova);
   - **Por pedido:** o parceiro ou a GUIDU faz um pedido formal; o owner da empresa recebe um e-mail com link seguro (uso único, 7 dias) e aprova. Ficam registrados quem aprovou, quando e de qual IP.
5. **Volta para padrão:** o cliente pode pedir sozinho, a qualquer momento, e o acesso de quem gerencia cai na hora. O fim do contrato também devolve ao padrão.
6. **Transparência:** toda ação de quem gerencia é auditada e aparece para o cliente (linha do tempo dos módulos e auditoria do workspace).
7. **Implementação:** uma função auxiliar única (`private.partner_manages_organization`) responde se o parceiro do contexto gerencia a empresa; as políticas que hoje aceitam o acesso de suporte passam a aceitar também o gerenciado, num só lugar, sem política paralela por módulo.

## Alternativas avaliadas

| Alternativa                                          | Por que não                                                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Acesso de suporte com prazo longo                    | O acesso de suporte é por pessoa e temporário; a gestão é da equipe e contínua, e renovar a cada 72 horas não funciona |
| Acesso restrito aos dados de um módulo no gerenciado | O serviço gerenciado usa GUIDS, campanhas, avaliações e CRM juntos; restringir obrigaria a pedir suporte o tempo todo  |
| Modo por workspace ou por ficha                      | O contrato é da empresa; modos diferentes por workspace confundiriam quem é responsável pelo quê                       |

## Consequências

- Tabelas novas: `organization_service_modes` (modo e parceiro que gerencia) e `service_mode_requests` (pedidos com o hash do token, prazo, decisão e IP).
- A regra da especificação dos agentes ("o parceiro não lê conversas sem concessão") ganha a exceção do gerenciado, que deve ser refletida nela quando a GB1 implementar.
- A revisão de LGPD (D-PA-06) precisa cobrir o gerenciado: o parceiro passa a tratar dados do cliente como operador, com base no contrato.
- O cliente no padrão continua com a garantia atual: ninguém de fora vê os dados dele sem um acesso pontual que ele aprovou.
- **GB1a (mínimo):** `organization_service_modes` e `private.partner_manages_organization` existem e valem para `workspace_locations`, as tabelas `gb_*`, a leitura dos workspaces da empresa gerenciada e as execuções `google-business.*` (o worker aceita o parceiro que gerencia como quem pediu). O parceiro escolhe o modo ao cadastrar o cliente (gerenciado por padrão). `service_mode_requests`, a volta ao padrão, a cláusula nos termos e a retrofit dos outros módulos ficam para depois (pendências).
- **GB1c (completo):** `service_mode_requests` com link de uso único (7 dias, só o hash do token, gravado no envio do e-mail) e prova do consentimento (quem, quando, por onde, IP e navegador); decisão pelo link público no host do parceiro ou em Configurações › Modo de serviço; volta ao padrão só pelo owner da empresa; o parceiro deixa de poder ligar o gerenciado numa empresa existente (só no cadastro, ou por pedido aprovado) e só pode devolvê-la ao padrão; cláusula de gerenciamento como documento legal `management`, pedida só a quem entra gerenciado pelo contrato; retrofit das políticas de CRM, GUIDS, conversas, leads, canais, portfólio e configurações do workspace pela mesma função, com a chave de IA (`credentials`) fora; toda escrita de quem gerencia auditada com origem `partner`. A exceção do gerenciado foi refletida na especificação dos agentes (seções 6 e 12).
