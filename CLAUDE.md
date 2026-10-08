# Instruções para Claude Code — rascunho

> Rascunho inicial da F0.3. Deve ser completado no bootstrap F1.1. O contrato comum de trabalho está em [AGENTS.md](AGENTS.md) e também se aplica ao Claude Code.

## Fontes obrigatórias

Antes de alterar o projeto, leia [docs/context.md](docs/context.md), a [especificação v1.0](docs/spec/especificacao-v1.0.md), o [adendo v1.1](docs/spec/adendo-modulos-v1.1.md), os [ADRs](docs/adr/) e as [pendências](docs/pendencias.md). ADR aceito prevalece em caso de conflito.

## Forma de trabalho

Estruture toda tarefa como **Contexto → Objetivo → Requisitos → Lógica → Plano → Testes → Aceite**. Trabalhe somente no branch/worktree isolado atribuído à issue. Não altere a branch padrão diretamente, não use `--no-verify`, não contorne hooks e não force-push trabalho alheio.

Não preencha regras internas de módulos por suposição. Não execute SQL remoto fora da exceção estrita da ADR 0008. Toda mudança de schema precisa nascer em migration versionada, sem editar migration já aplicada. Nunca exponha segredos ou conteúdo de `.env`.

Preserve as invariantes de segurança descritas em [docs/context.md](docs/context.md) e entregue evidência verificável de testes, CI e limitações. Operações irreversíveis ou sobre produção exigem aprovação explícita do Marcelo registrada no Paperclip.
