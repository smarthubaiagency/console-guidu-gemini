# C10 — Chave mestra obrigatória, segredos fora de URL e erros seguros

> Copie todo o conteúdo abaixo da linha para o Antigravity.

---

Você vai trabalhar no repositório **console-guidu-gemini** (Next.js 16, Prisma 6, Supabase, pnpm).

**Antes de qualquer alteração, leia:** `AGENTS.md`, a Especificação §13 (raiz de criptografia fora do banco), §15 (erros com `code`, mensagem segura e `requestId`), §16 (cofre) e §24 (AC07), `src/core/credentials/crypto.ts`, `src/core/agents/providers/executor.ts`, todas as `*-actions.ts` e `docs/correcoes/README.md` (regras comuns, que valem integralmente).

**Branch:** `fix/C10-chave-mestra-erros-seguros`, a partir da `main` atualizada. Entregue via PR.

## Contexto

1. `getMasterKey()` em `crypto.ts`: sem `ENCRYPTION_KEY`, usa uma chave **derivada de uma string fixa do repositório**. Em produção, um esquecimento de configuração cifraria todos os segredos BYOK com uma chave pública. Além disso, qualquer string é aceita e derivada por SHA-256 (KDF fraca para segredo humano).
2. O payload não identifica qual chave cifrou, o que impede rotação.
3. `executor.ts` envia a chave do Gemini na **query string** (`?key=...`), que costuma aparecer em logs de proxy e de observabilidade.
4. As server actions devolvem `err.message` cru ao navegador, inclusive o corpo de erro do provedor de IA (`OpenAI API error [401]: {...}`), contrariando a §15 e o AC07.
5. Não existe a camada de erros compartilhada prevista em `src/shared/errors/` (pasta vazia).

## Objetivo

Falhar fechado quando faltar a chave mestra, permitir rotação, tirar segredos de URLs e padronizar erros seguros com `requestId`.

## Requisitos

1. **Chave mestra** (`crypto.ts`):
   - `ENCRYPTION_KEY` obrigatória em **todos** os ambientes, exceto quando `NODE_ENV === "test"` **e** o teste a define explicitamente. Remova o fallback fixo;
   - formato aceito: exatamente 32 bytes, em hex (64 caracteres) ou base64 (44 caracteres). Qualquer outro formato lança erro na inicialização. Remova a derivação SHA-256 de string arbitrária;
   - **versão de chave:** `ENCRYPTION_KEY_ID` (por exemplo `k1`) gravado no payload (`kid`). Para rotação, suportar `ENCRYPTION_KEYS_PREVIOUS` (`kid:chave,kid:chave`), usado só para **decifrar**;
   - **compatibilidade:** payloads atuais sem `kid` (dev só tem dados sintéticos) podem ser tratados como `kid` legado só para leitura. Se for mais simples, documente que credenciais antigas de dev precisam ser recadastradas. **Não** apague dados por conta própria;
   - atualizar o `.env.example` (`ENCRYPTION_KEY`, `ENCRYPTION_KEY_ID`) e o CI (job `db` e o rig E2E), com chaves geradas na hora (`openssl rand -hex 32`) e mascaradas (`::add-mask::`).
2. **Segredo fora de URL:** no `executor.ts`, o Gemini usa o header `x-goog-api-key`. Nenhum provedor recebe a chave em URL.
3. **Erros seguros:**
   - criar `src/shared/errors/app-error.ts`: `AppError { code: "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid_input" | "rate_limited" | "unavailable" | "provider_error" | "internal"; safeMessage: string; cause?: unknown }` e `toSafeError(err, requestId)`, que mapeia os erros de domínio conhecidos (`PermissionDeniedError`, `WorkspaceNotFoundError`, `SeatLimitExceededError`, `Invitation*Error`, `ModuleUnavailableError`, `CredentialNotFoundError`…) para `code` + mensagem segura em português, e qualquer outro erro para `internal` ("Não foi possível concluir a operação.");
   - `requestId`: gerar por requisição (`crypto.randomUUID()`) ou reutilizar um header existente;
   - log no servidor: `console.error` estruturado com `requestId`, `code` e nome do erro. **Nunca** o corpo do provedor, a chave, o token, o payload cifrado ou o e-mail completo. Crie um `redact()` simples para os padrões `sk-`, `sk-ant-`, `AIza`, `gdu_live_`, `eyJ` e URLs com senha;
   - todas as server actions (`credentials-actions`, `api-keys-actions`, `agents/actions`, `team-actions`, `security/actions`, `mfa/actions`, `login`, `forgot-password` e `reset-password`, conferindo o que já é seguro) devolvem `{ error: safeMessage, code, requestId }`;
   - as rotas `src/app/api/v1/**` devolvem `{ error: { code, message, requestId } }` com o status HTTP adequado (401, 403, 404, 409, 422, 429 e 500), sem stack trace.
4. **Erros do provedor:** em `executor.ts`, o `throw` passa a carregar só o status HTTP e o nome do provedor (`ProviderError { provider, status }`). O corpo da resposta é descartado ou, no máximo, truncado e redigido só no log do servidor.

## Testes

- Unitários de `crypto.ts`: sem chave lança erro; formato inválido lança erro; roundtrip com `kid`; decifrar com chave anterior; `kid` desconhecido lança erro.
- Unitários de `toSafeError` e `redact` (cada padrão de segredo).
- Teste que garante que nenhuma action devolve `err.message` cru: por exemplo, mock de um serviço que lança `Error("sk-secret-123 leaked")` e a resposta não contém `sk-`.
- Teste do executor: a URL do Gemini não contém a chave; o header contém.

## Aceite

- `pnpm generate && pnpm typecheck && pnpm lint && pnpm test && pnpm build` sem erros, e CI verde.
- `git grep -n "guidu-default-development-encryption-key"` vazio.
- `git grep -n "err.message\|error.message" src/core src/app` sem retorno ao cliente. Justifique no PR os usos que só logam.
