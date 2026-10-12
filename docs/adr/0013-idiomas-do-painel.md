# ADR 0013 — Idiomas do painel

- **Status:** Proposto (aceito com o PR da I1)
- **Data:** 11/10/2026
- **Aprovador:** Marcelo
- **Plano:** [plano-i18n.md](../operacao/plano-i18n.md)

## Contexto

O painel nasceu só em português, com os textos escritos direto no código. Marcelo pediu suporte a vários idiomas, começando por português, inglês e espanhol. Os requisitos são:

- **Idiomas na plataforma:** um menu em Plataforma › Configurações › Idiomas para adicionar idiomas e editar cada texto do painel, com tradução automática no futuro.
- **Escolha do idioma:** um idioma padrão por workspace e um idioma por pessoa, que vale mais que o do workspace.
- **API e MCP:** as descrições do MCP e as mensagens da API ficam em inglês.

## Decisão

1. **Biblioteca:** [next-intl](https://next-intl.dev) (4.14.6), com Server Components e Server Actions. Não há idioma na URL: o painel é autenticado, então rotas como `/en/...` não trazem ganho e mudariam todas as rotas.
2. **Escolha do idioma de cada requisição:**
   1. o idioma da pessoa (`profiles.locale`);
   2. o padrão do workspace no caminho (`workspaces.default_locale`);
   3. o idioma do navegador, só para visitantes sem sessão;
   4. o padrão da plataforma (`platform_languages.is_default`).

   Só contam os idiomas ativos.

3. **Textos:** o código traz os textos em `src/i18n/messages/<idioma>.json`. O pt-BR é a origem: toda chave nasce nele. O CI exige que en e es tenham as mesmas chaves e as mesmas variáveis.
4. **Edições da plataforma:** a tabela `platform_translations` guarda uma edição por idioma e chave, por cima do texto do código. A ordem de leitura é: edição da plataforma, depois arquivo do idioma, depois texto de origem. Um idioma criado na tela não tem arquivo e começa com os textos em português até ser traduzido. Voltar ao texto do sistema apaga a edição.
5. **Leitura em toda página, com ou sem sessão:** feita por funções SECURITY DEFINER (`private.ui_languages`, `private.ui_translations`, `private.ui_workspace_locale`), com cache de 30 segundos em memória. A tela de edição limpa o cache do processo na hora.
6. **Componentes de navegador:** recebem só os grupos de mensagens de que precisam (`CLIENT_NAMESPACES`), para a página não crescer a cada tela traduzida.
7. **Permissão:** `platform.languages.manage`, para os papéis internos owner e operations.

## Consequências

- Cada tela passa a usar chaves em vez de frases. A migração é por etapas (I2 a I4), e telas ainda não migradas continuam em português em qualquer idioma.
- Rótulos de menu e manifestos sem chave mantêm o texto do código, que é o comportamento esperado para módulos ainda não traduzidos.
- Com várias instâncias, uma edição leva até 30 segundos para aparecer nas outras.
- A tradução automática usa a mesma tabela, com `origin = machine`, e fica marcada para revisão. Provedor: Claude, pela API da Anthropic (`claude-opus-5-5`), escolhido em 12/10/2026 por preservar a sintaxe ICU e usar o contexto das chaves (I6).
