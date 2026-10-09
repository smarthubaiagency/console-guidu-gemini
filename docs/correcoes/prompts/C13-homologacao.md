# C13 — Homologação das correções

> Copie todo o conteúdo abaixo da linha para o Antigravity.

---

Você vai trabalhar no repositório **console-guidu-gemini** (Next.js 16, Prisma 6, Supabase, Playwright, pnpm).

**Antes de qualquer alteração, leia:** `AGENTS.md`, `docs/correcoes/README.md`, `docs/auditoria/2026-10-08-verificacao-execucao-gemini.md`, a Especificação §24 e `.github/workflows/ci.yml`.

**Branch:** `fix/C13-homologacao`, a partir da `main` com C01 a C12 integradas. Entregue via PR.

## Contexto

Depois das correções C01–C12, é preciso provar o resultado com evidência executada. AGENTS.md: "não marcar como aprovado o que não foi executado". Lacunas conhecidas:
- o E2E `e2e/auth-blocked.spec.ts`, criado na Task 03 (`git show d1b942e:e2e/auth-blocked.spec.ts`), não existe mais no tree;
- o CI não roda E2E;
- os testes de banco pulam localmente sem variáveis.

## Objetivo

Restaurar a cobertura perdida, levar o E2E ao CI e produzir um relatório final de conformidade.

## Requisitos

1. **Restaurar `e2e/auth-blocked.spec.ts`** a partir do commit `d1b942e`, adaptado ao código atual. Ele prova o AC03: identidade bloqueada com JWT ainda válido é barrada.
2. **CI:** adicionar um job `e2e` em `.github/workflows/ci.yml` que instala o Chromium do Playwright (`pnpm exec playwright install --with-deps chromium`) e roda `pnpm test:e2e` com o rig existente (`e2e/support/`). Use variáveis geradas na hora e mascaradas (`ENCRYPTION_KEY`, `APP_NAME`, `APP_URL`) e publique o relatório do Playwright como artifact em caso de falha. **Não** use credenciais remotas no CI.
3. **Execução completa** (local ou CI), com a saída anexada ao PR:
   - `pnpm install --frozen-lockfile && pnpm generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build`;
   - suíte de banco **contra o `console-guidu`**, com as variáveis apontando para o remoto (ADR 0010): `pnpm test:core`, com contagem de testes executados maior que zero e nenhum pulado por falta de variável;
   - testes SQL (`tests/core/*.sql`, `tests/auth/*.sql`) contra o remoto, como `app_migrations`;
   - `pnpm test:e2e`.
4. **Conferência do banco remoto**, só leitura:
   - `schema_migrations` igual à lista de arquivos;
   - nenhuma tabela `public` sem `FORCE RLS`;
   - `anon`/`authenticated` sem grants;
   - `app_runtime` sem acesso fora de `public`/`private`;
   - advisors de segurança sem ERROR. Liste os WARN.
5. **Relatório final:** criar `docs/auditoria/<data>-homologacao-correcoes.md` com:
   - tabela C01–C12: status (concluída, parcial, não feita), PR e evidência;
   - tabela dos ADRs 0001–0010: conforme, parcial ou pendente;
   - tabela AC01–AC18: atendido, parcial, não iniciado ou fora do escopo da etapa;
   - ações manuais M1–M4: confirmar com Marcelo se foram feitas (não presuma);
   - lista do que fica para F2, F3 e F4, copiada do README de correções e atualizada.
6. Atualizar `docs/pendencias.md` só com fatos novos (por exemplo, o default técnico de vagas, já da C09). Não resolva pendências por inferência.

## Aceite

- CI verde com os jobs `quality`, `db` e `e2e`.
- Relatório final publicado no PR, com a saída real dos comandos. Sem "deve funcionar".
- Toda falha conhecida registrada com causa e próximo passo.
