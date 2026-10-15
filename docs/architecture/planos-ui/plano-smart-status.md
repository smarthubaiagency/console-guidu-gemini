# Plano: SmartStatusBanner no GUIDU

Referência: `SmartStatusBanner.tsx` e `StatusContext.tsx` do projeto legado, conforme a descrição do Marcelo (12/10/2026).

## Objetivo

Um único sistema de feedback no painel, no lugar de mensagem inline, `alert()` e `confirm()`. Ele vale para `/app`, `/admin` e `/platform`, com a mesma API do legado (`useStatus().showStatus(...)`), para que os exemplos e o hábito de uso venham juntos.

## Como está hoje no GUIDU

| Ponto                                                                     | Situação                                                                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `ActionForm` (formulários de servidor)                                    | 66 usos em 26 arquivos, cada um com `<p role="status">` ou `role="alert"` abaixo do botão |
| Formulários com `useActionState` próprio (CRM, Hello World, credenciais…) | 12 arquivos com mensagem inline                                                           |
| `confirm()` do navegador                                                  | 3 telas: equipe, credenciais e chaves MCP                                                 |
| Testes e2e que leem a mensagem inline                                     | 38 verificações em 11 arquivos                                                            |

## Como fica

### Peças

| Arquivo                                           | Papel                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/components/feedback/status-context.tsx`      | `StatusProvider`, `useStatus()` (`showStatus`, `dismiss`, `pauseTimer`, `resumeTimer`, `isPaused`) e o timer |
| `src/components/feedback/smart-status-banner.tsx` | O card, montado com componentes do shadcn (`Button`, `Checkbox`, `Collapsible`)                              |
| `src/components/layout/shell/shell-main.tsx`      | Monta o provider e o banner uma vez, para todas as áreas                                                     |

### Comportamento (igual ao legado)

- Uma mensagem por vez; um `showStatus` novo substitui a anterior.
- Tipos: `up` (sucesso), `oops` (aviso) e `down` (erro), com ícone e cor de cada um.
- Campos: `type`, `title`, `message`, `details` (chevron que expande), `action`, `secondaryAction`, `checkboxLabel` (habilita a ação principal só depois de marcado), `icon` e `duration` (padrão de 4000 ms; `0` não fecha sozinho).
- Barra de progresso sincronizada com o tempo. Clicar no card pausa, e o rodapé passa a dizer "Pausado. Clique × para fechar.". Com `duration: 0`, a barra fica cheia e parada.

### Ajustes em relação ao legado

1. **Posição:** o card fica centralizado logo abaixo do cabeçalho de 60 px, dentro da área de conteúdo (`absolute`, como a gaveta da ADR 0015). Ele não cobre a sidebar e acompanha o conteúdo quando a sidebar recolhe.
2. **Sem `framer-motion`:** a entrada, a saída e a barra usam `tw-animate-css` (já instalado) e uma animação CSS pausável, então nenhuma dependência nova entra.
3. **Cores pelos tokens do GUIDU** (`success`, `warning`, `danger`), nos temas claro e escuro. No lugar do `colorOverride` com variável CSS solta, entra um `tone` fechado (por exemplo `tone: "destructive"`), porque a regra P0 do lint proíbe variável CSS fora dos componentes de UI.
4. **Os pontos de atenção do legado ficam corrigidos:**
   - **A pausa pode ser retomada:** o card mostra um botão "Retomar". O timer e a barra continuam do tempo que restava, sem reiniciar.
   - **A animação de entrada sempre toca:** cada `showStatus` ganha um id próprio, então duas mensagens iguais seguidas também animam.
   - **Uma confirmação aberta não some sozinha:** `showStatus` não substitui uma confirmação pendente (`duration: 0` com `action`). O resultado só aparece depois que a pessoa escolhe.
   - **Novo atalho `confirmStatus({...}): Promise<boolean>`:** troca o `confirm()` do navegador e resolve o caso "chamar `dismiss()` antes da ação".
5. **Acessibilidade:**
   - Sucesso e aviso usam `role="status"`; erro usa `role="alert"`.
   - Uma confirmação vira `role="alertdialog"`, recebe o foco e fecha com Esc (cancelar).
6. **Idiomas:** os textos do card ("Fechar", "Ver detalhes", "Pausado…") ficam no namespace `shell`, em pt-BR, en e es.
7. **Fora do painel** (login, convites e MFA não têm o shell): `useStatus()` lança um erro claro, como no legado. Se precisar lá, o provider entra também no `AuthShell` numa etapa futura.

### Regra do projeto (ADR 0016 e AGENTS.md)

- Todo envio ou salvamento dá o retorno pelo `useStatus()`.
- `alert()`, `confirm()` e mensagem de resultado inline ficam proibidos; uma regra do ESLint (`no-restricted-globals`) trava o `alert` e o `confirm`.
- **Exceção:** o erro de validação de um campo específico continua ao lado do campo (`aria-invalid` e `aria-describedby`), por acessibilidade. O resultado do envio vai para o banner.

## Etapas (um PR cada)

### S1: componente, regra e catálogo

- Provider, banner, ADR 0016 e regra no AGENTS.md e no guia `ui-shell.md`.
- Vendorizar o `Checkbox` do shadcn.
- Página `/platform/design/status` no catálogo de padrões, com os três tipos, detalhes, ações, checkbox, `duration: 0` e confirmação, para a sua aprovação visual.
- e2e do banner: aparece, pausa, retoma, fecha, confirmação com checkbox e Esc.

### S2: migração

- `ActionForm` passa a chamar `showStatus` com o resultado, o que cobre 66 formulários de uma vez.
- Os 12 formulários com `useActionState` próprio e os 3 `confirm()` passam para o banner (confirmação com checkbox onde a ação é destrutiva, como revogar chave ou remover membro).
- Testes e2e passam a ler o banner (`getByTestId("smart-status")`) em vez da mensagem inline.

Depois disso seguem a U3 (componentes no padrão shadcn) e a F6a. A S2 vem antes da U3 porque mexe nos mesmos formulários.
