# ADR 0019 — Subagente especialista acionado pelo Assistente

- **Status:** Proposto (etapa G0); vira aceito com a aprovação do Marcelo no PR
- **Data:** 16/10/2026
- **Aprovador:** Marcelo
- **Origem:** [especificação do módulo Google Meu Negócio](../modules/google-business/especificacao.md), seção 4
- **Relaciona-se com:** [ADR 0017](0017-sdk-dos-agentes-de-ia.md) (motor), [especificação dos Agentes de IA](../modules/ai-agents/especificacao.md) (Assistente GUIDU e GUIDS, seções 3, 7 e 9)

## Contexto

O motor de agentes tem dois tipos: o Assistente GUIDU (um por parceiro, conversa com quem está logado e com o comerciante) e os GUIDS (agentes do cliente). O agente GMN não é nenhum dos dois: é um especialista da plataforma que cuida das fichas do Google, não conversa com o cliente e precisa rodar tanto quando o Assistente pede quanto sozinho, em gatilhos e rotinas. Ele também precisa de regras próprias de chave (gerenciado usa a chave da plataforma ou do parceiro; padrão usa a do cliente) e de skills editáveis com partes travadas.

## Decisão

1. **Novo tipo de agente no motor: `specialist`.** Um especialista é definido pela plataforma (nome, instruções base, ferramentas permitidas e skills de base) e instanciado por empresa. O primeiro é o agente GMN; o formato serve para outros especialistas (por exemplo, o do site do negócio).
2. **Acionamento.** O especialista roda em três situações: (a) quando o Assistente chama a ferramenta `delegate_to_specialist` com um pedido estruturado; (b) em gatilhos e rotinas, como job do worker; (c) na gaveta, quando quem opera conversa com ele diretamente. Em (a), a resposta volta ao Assistente como dado estruturado (proposta, relatório ou pergunta), validado por Zod; o Assistente decide como falar com o cliente.
3. **O especialista não fala com o cliente final** nem com o visitante. Avisos e aprovações saem pelo Assistente (WhatsApp, sino, e-mail).
4. **Contexto vem do servidor.** Empresa, ficha e modo de serviço saem do job ou da sessão; nenhum argumento de ferramenta escolhe empresa ou ficha. As ferramentas seguem a allowlist em código, com guarda de tempo, de tamanho e auditoria, como nos GUIDS.
5. **Chave por modo de serviço** (ADR 0020): gerenciado usa a chave do parceiro, ou da plataforma no parceiro zero; padrão usa a chave do cliente. A chave reserva da plataforma segue a regra da A2c.
6. **Skills em camadas.** Skills da plataforma são travadas (não editáveis nem desligáveis); parceiro e empresa podem duplicar e criar skills próprias, que só escolhem entre as ferramentas permitidas e só entram em uso depois de um teste com sucesso. Cada versão é guardada.
7. **Escrita só por proposta.** Toda alteração externa (ficha, resposta, postagem) passa pelo mecanismo de propostas da F4d e pela autonomia configurada; "automático" é uma proposta aprovada pela regra, registrada igual às outras.

## Alternativas avaliadas

| Alternativa                                      | Por que não                                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Pôr as ferramentas de ficha direto no Assistente | Mistura o agente de conversa com um especialista de operação; o Assistente cresceria sem limite e as skills de ficha não teriam dono          |
| Tratar o agente GMN como um GUIDS                | GUIDS é do cliente, conta no limite do plano e usa a chave do cliente; o gerenciado precisa da chave do parceiro e do acesso de quem gerencia |
| Orquestrador externo (n8n, control plane)        | O motor fica dentro da plataforma (ADR 0017); estado, consumo e auditoria nas nossas tabelas                                                  |

## Consequências

- O motor ganha o tipo `specialist`, a ferramenta `delegate_to_specialist` no Assistente e a tabela de skills com escopo (`ai_agent_skills`).
- O consumo do especialista entra no painel de IA (CF6a) separado do Assistente e dos GUIDS.
- O editor de abas dos modelos (A3a) e o "Testar agente" (A4b) são reaproveitados para Agente, Soul e Skills.
