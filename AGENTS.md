# Instruções de trabalho — rascunho

> Rascunho inicial da F0.3. Deve ser completado no bootstrap F1.1.

## Antes de começar

Leia [docs/context.md](docs/context.md), a [especificação v1.0](docs/spec/especificacao-v1.0.md), o [adendo v1.1](docs/spec/adendo-modulos-v1.1.md), os [ADRs](docs/adr/) e as [pendências](docs/pendencias.md). ADR aceito prevalece quando houver conflito.

## Fluxo de cada tarefa

Registre e execute: **Contexto → Objetivo → Requisitos → Lógica → Plano → Testes → Aceite**. Leia primeiro o repositório e estas instruções; proponha solução concreta; implemente apenas o escopo; rode os testes relevantes; informe arquivos, evidências e limitações.

## Git e coordenação

Use branch e worktree isolados por agente/issue, baseados na branch padrão. Não troque, renomeie ou reaproveite o worktree de outra execução. Defina um proprietário por alteração, evite migrations concorrentes e não faça revisão simultânea do mesmo arquivo. Nunca faça push direto na branch padrão, force-push em branch alheia, `--no-verify` ou bypass de hooks.

## Banco e segurança

- É proibido executar SQL remoto em qualquer ambiente, exceto no projeto Supabase de desenvolvimento autorizado pela ADR 0008 e dentro das condições dela.
- Toda mudança de schema nasce em `supabase/migrations`; não execute alteração ad hoc nem edite migration já aplicada.
- Nunca exponha credenciais, tokens, chaves ou conteúdo de `.env`.
- Preserve as invariantes de [docs/context.md](docs/context.md): contexto obrigatório, autorização no servidor, segredos fora do client, grants MCP, privilégio mínimo e nenhuma suposição de regra interna de módulo.
- Migration de produção, dado real, exclusão, serviço, DNS ou infraestrutura exige aprovação explícita do Marcelo registrada no Paperclip.

## Evidência

Afirmações exigem arquivo e linha, consulta ou run de CI. Contagens usam `count(*)`. Não deduza comportamento pelo nome. Uma entrega só é concluída após revisão, aprovação e validação previstas no fluxo da issue.

