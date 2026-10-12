# ADR 0016 — SmartStatusBanner: o retorno do painel num lugar só

- **Status:** Proposto (S1); vira aceito com a aprovação visual do Marcelo
- **Data:** 12/10/2026
- **Aprovador:** Marcelo
- **Guia:** [ui-shell.md](../architecture/ui-shell.md#avisos-adr-0016)
- **Página de referência:** `/platform/design/status` (catálogo de padrões)

## Contexto

O painel dava retorno de três jeitos diferentes:

- uma mensagem inline abaixo do botão (`ActionForm` e formulários com `useActionState`);
- `role="alert"` solto na tela;
- o `confirm()` do navegador para remover membro, revogar credencial e revogar chave MCP.

O projeto legado já tinha um sistema aprovado, o **SmartStatusBanner**: um card único abaixo do cabeçalho com estado global (`useStatus()`). Marcelo pediu que ele venha para o GUIDU em 12/10/2026.

## Decisão

1. **Todo envio ou salvamento dá o retorno pelo `useStatus()`.** O `alert()`, o `confirm()` e a mensagem de resultado inline ficam proibidos. A exceção é o erro de validação de um campo específico, que continua ao lado do campo (`aria-invalid` e `aria-describedby`).
2. **Peças** (`src/components/feedback/`):
   - `status-context.tsx`: `StatusProvider` e `useStatus()`, com `showStatus`, `confirmStatus`, `dismiss`, `pauseTimer`, `resumeTimer` e `isPaused`;
   - `smart-status-banner.tsx`: o card, feito com `Button`, `Checkbox` e `Collapsible` do shadcn.

   O shell (`ShellMain`) monta os dois uma vez, então o banner vale em `/app`, `/admin` e `/platform` sem configuração.

3. **Mesma API do legado.**
   - `StatusItem`: `type` (`up`, `oops` ou `down`), `title`, `message`, `details`, `action`, `secondaryAction`, `checkboxLabel`, `icon` e `duration` (4000 ms por padrão; `0` não fecha sozinho).
   - O `colorOverride` do legado vira `tone: "destructive"`, porque a regra P0 proíbe variável CSS solta.
4. **Posição.** O card fica centralizado logo abaixo do cabeçalho de 60 px, dentro da área de conteúdo (`absolute`), acima das gavetas da ADR 0015 e sem cobrir a sidebar. Largura máxima de 480 px (`max-w-120`).
5. **Uma mensagem por vez**, com estas correções em relação ao legado:
   - **Retomar:** a pausa (clique no card) mostra "Retomar". O timer e a barra continuam do tempo que restava.
   - **Animação:** cada `showStatus` ganha um id, então a mesma mensagem duas vezes anima de novo.
   - **Confirmação protegida:** uma confirmação aberta (`duration: 0` com `action`) não é apagada por outro aviso. O aviso espera a resposta e aparece depois.
   - **`confirmStatus(...)`:** devolve `Promise<boolean>` e substitui o `confirm()`. Cancelar, fechar e Esc respondem `false`.
6. **Acessibilidade.**
   - Sucesso e aviso usam `role="status"` (polite); erro usa `role="alert"`.
   - Uma confirmação é `role="alertdialog"` e recebe o foco.
   - Esc fecha o banner antes da gaveta que estiver embaixo; um diálogo ou menu aberto por cima fecha primeiro.
7. **Sem dependência nova.** A entrada usa `tw-animate-css`. A barra é uma animação CSS (`status-countdown`) que para com `animation-play-state` durante a pausa, sincronizada com o timer.
8. **Cores** pelos tokens `success`, `warning` e `danger`, nos temas claro e escuro.
9. **Fora do shell** (login, convites, MFA), `useStatus()` lança um erro claro. O `AuthShell` ganha o provider quando alguma tela de lá precisar.

## Consequências

- Etapa **S1** (esta): o componente, a regra e a página de catálogo `/platform/design/status`, com o e2e `e2e/status.spec.ts`.
- Etapa **S2**: o `ActionForm` (66 formulários), os formulários com `useActionState` próprio e os três `confirm()` passam para o banner; os e2e passam a ler `getByTestId("smart-status")`. Depois disso, uma regra do ESLint (`no-restricted-globals`) trava o `alert` e o `confirm`.
- O ESLint libera variável CSS e `style` também em `src/components/feedback/`, só para o tempo da barra (`--status-duration`).
