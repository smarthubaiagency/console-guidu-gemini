# Avaliação do framework eve (vercel/eve) para o módulo Agentes de IA

- **Data:** 09/10/2026
- **Estado:** avaliação, sem código nem dependência adicionada. **Não autoriza implementação.**
- **Versão avaliada:** `eve` 0.75.1 (npm), commit `8c55ea7` de `github.com/vercel/eve`, licença Apache-2.0, **beta** sob os termos de beta da Vercel.
- **Pedido de origem:** "olhar o `npx skills add vercel/eve` e empacotar no módulo de agente de IA, seguindo a documentação e as ADRs".

## 1. O que é

`npx skills add vercel/eve` instala apenas a skill `skills/eve/SKILL.md` para assistentes de código. Ela não traz funcionalidade: só manda o assistente ler `node_modules/eve/docs/`. O que importa é o pacote **`eve`**, um framework de agentes duráveis:

- O agente é um diretório: `agent/agent.ts` (modelo), `instructions.md` (prompt de sistema), `tools/`, `skills/`, `channels/` (HTTP, Slack, MCP…), `schedules/`, `subagents/`.
- Cada sessão é um **workflow durável** do Workflow SDK, com checkpoint por passo, retomada após queda e espera "estacionada" por aprovação humana.
- O runtime é um **serviço Nitro separado**. Em Next.js, `withEve(nextConfig)` sobe esse serviço ao lado e reescreve `/eve/v1/*` para ele. O React usa `useEveAgent` de `eve/react`.
- Estado durável fica num "world": em disco (`.eve/.workflow-data`) por padrão fora da Vercel, Vercel Workflow na Vercel, ou um pacote como `@workflow/world-postgres` (linha `5.0.0-beta`).
- Modelos: uma string de modelo passa pelo **Vercel AI Gateway**. Para ir direto ao provedor, usa-se um `LanguageModel` do AI SDK. Os helpers `eve/models/*` leem `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` do ambiente.
- Ferramentas padrão incluem `bash`, `read_file`, `write_file` num sandbox (Docker, microsandbox, just-bash ou Vercel Sandbox), a menos que `defaultTools: false`.
- A autenticação nos canais recusa por padrão (_fail closed_). `AuthFn` customizada permite verificar sessão ou chave própria e carimbar `tenantId` no principal.

## 2. Conformidade com as ADRs e invariantes

| Referência                                               | Situação               | Motivo                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR 0003, ordem das fases**                            | ❌ Bloqueia agora      | Agentes de IA é módulo, fase F5 ou posterior. F2 (contrato de módulos), F3 (auditoria, quotas, jobs) e F4 (API/MCP) não existem.                                                                                                                                                                                                      |
| **Decisão de 09/10, C04**                                | ❌ Bloqueia agora      | Marcelo decidiu congelar o módulo atrás de flag desligada até existir especificação. A C04 ainda não foi executada e mexe nos mesmos arquivos.                                                                                                                                                                                        |
| **Pendência "Configurações dos módulos"**                | ❌ Bloqueia agora      | Ferramentas, modelos, prompts, canais e regras do módulo continuam em aberto. Escolher o eve já fixa boa parte disso por suposição (§1, §14, §25).                                                                                                                                                                                    |
| **ADR 0001, Prisma como caminho único**                  | ⚠️ Conflito estrutural | Transcrições, payloads de modelo e de ferramenta e estado de sessão ficam no world do eve, fora do Prisma, fora de `withContext` e sem RLS por workspace. Com `@workflow/world-postgres` o dado iria para o nosso Postgres, mas num schema próprio, com papel próprio e sem policies `app.*`.                                         |
| **ADR 0002, jobs no pg-boss com worker separado**        | ⚠️ Conflito estrutural | O eve traz um segundo motor de execução durável (Workflow SDK) e cron próprio (`schedules/`). Teríamos dois motores, dois modelos de retry e idempotência, e a concorrência por workspace do pg-boss não se aplicaria. A hospedagem em contêiner com processos separados é compatível com `eve start`, mas soma um terceiro processo. |
| **ADR 0006, manifesto único**                            | ⚠️ Desenho pendente    | O eve tem seu próprio manifesto em diretório. Sem `registry.ts` não há como dizer como `agent/` se liga a `configurationSchema` e `settings`.                                                                                                                                                                                         |
| **ADR 0009 e §17, MCP por chaves**                       | ⚠️ Conflito se usado   | O canal MCP do eve (`/eve/v1/mcp`) seria uma terceira superfície MCP, ao lado de `/mcp/workspace` e `/mcp/admin`. Só seria aceitável sem esse canal, ou atrás da nossa validação de chave e escopo.                                                                                                                                   |
| **Invariante: nenhuma ferramenta genérica privilegiada** | ⚠️ Exige configuração  | `bash`/`write_file` vêm ligados por padrão. Seria obrigatório `defaultTools: false` e uma lista explícita de ferramentas que chamam nossos serviços.                                                                                                                                                                                  |
| **§16, cofre BYOK por workspace**                        | ⚠️ Exige código        | As chaves dos helpers vêm do ambiente, ou seja, são globais. BYOK por workspace exige modelo dinâmico em `step.started`, montando o `LanguageModel` com a chave decifrada do nosso cofre dentro do runtime eve.                                                                                                                       |
| **Pendência "Provedores e cobrança"**                    | ⚠️ Decisão de produto  | A rota padrão pelo AI Gateway acrescenta a Vercel como intermediária de dados e cobrança. Só usar provedor direto até haver decisão.                                                                                                                                                                                                  |
| **Pendência "Retenção e privacidade"**                   | ⚠️ Decisão de produto  | O world guarda payloads e transcrições pelo prazo dele. Exclusão e exportação por workspace (AC12–AC13) precisariam alcançar esse armazenamento também.                                                                                                                                                                               |
| **AC08, módulo indisponível bloqueia tudo**              | 🟡 Viável              | A `AuthFn` do canal pode chamar `assertModuleAvailable` e revalidar membership e permissão a cada turno.                                                                                                                                                                                                                              |
| **AC14 e quotas**                                        | 🟡 Viável              | Hooks e eventos de passo dão consumo de tokens e chamadas de ferramenta, o que permitiria alimentar `audit_events` e `usage_events`, que ainda não existem.                                                                                                                                                                           |
| **ADR 0007, independência**                              | ✅                     | Sem relação com o CartãoPRO.                                                                                                                                                                                                                                                                                                          |

### Riscos técnicos

- **Maturidade:** 0.x em beta, com releases quase diárias (0.70 → 0.75 recentes) e dependências em beta (`nitro 3.0.x-beta`, `@workflow/* 5.0.0-beta`). O próprio changelog documenta migrações de modelo de execução.
- **Next.js 16.4:** o `withEve` envolve `next.config.ts` e reescreve rotas. Isso precisa ser verificado contra o nosso `proxy.ts` e contra o guia de `node_modules/next/dist/docs/`.
- **Telemetria do CLI:** ligada por padrão. CI e máquinas de dev precisariam de `EVE_TELEMETRY_DISABLED=1`.
- **Conexões:** a chamada ao modelo fica fora da transação `withContext`, o que resolve um problema conhecido do engine atual. Em troca, as ferramentas precisam abrir a própria transação contextualizada a cada chamada.

## 3. Como seria a integração, se aprovada

Fica aqui só como insumo para a especificação do módulo. Não deve ser implementado sem as decisões da seção 4.

1. `src/modules/ai-agents/agent/` com `agent.ts` (`defaultTools: false`, `experimental.workflow.world` escolhido por ADR, `retention` conforme a política de privacidade) e `instructions.md` vindo da configuração do workspace, não de texto fixo.
2. Um único canal `eve` com `AuthFn` que valida a sessão Supabase SSR, resolve o workspace no servidor, chama `assertModuleAvailable("ai-agents")` e a permissão `agents.use`, e carimba `workspaceId`/`organizationId` em `attributes`. Sem canal MCP, Slack ou outros.
3. Ferramentas finas que chamam serviços do domínio dentro de `withContext`, com o contexto vindo de `ctx.session.auth.current` e nunca de argumento do modelo.
4. Modelo dinâmico em `step.started` com a chave BYOK do workspace e provedor direto, sem AI Gateway.
5. Hooks de passo gravando consumo e auditoria nas tabelas da F3.
6. As tabelas `agent_sessions`/`agent_messages` viram projeção de domínio sob RLS, como a ADR 0002 já pede para as telas de execução, ou são substituídas, conforme decisão.

## 4. Decisões necessárias (Marcelo)

1. **Momento:** confirmar que isto fica para depois de F2–F4 e da especificação do módulo, conforme a ADR 0003 e a C04. Recomendação: sim.
2. **Motor de execução:** aceitar um segundo motor durável (Workflow SDK) ao lado do pg-boss, ou exigir que agentes rodem sobre o pg-boss. Se aceitar, isso pede uma ADR nova que ajuste a 0002.
3. **Onde ficam as transcrições:** world Postgres no nosso banco (schema e papel dedicados, por migration) ou fora dele. Isso afeta a ADR 0001, a retenção e a exclusão por workspace.
4. **Provedor:** só provedor direto com BYOK, ou também AI Gateway.
5. **Maturidade:** aceitar dependência beta 0.x em produção ou esperar a versão estável.

Recomendação: **não adotar agora**. Reavaliar quando a especificação do módulo existir, com as decisões 2 e 3 tomadas e o eve fora do beta. Se o interesse for prático, um protótipo isolado, fora deste repositório e sem dados reais, mede a integração com `withEve` no Next 16.4 sem tocar a fundação.
