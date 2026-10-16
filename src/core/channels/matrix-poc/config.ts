import "server-only";

/**
 * PROVA DE CONCEITO (IN1, docs/modules/inbox/prova-de-conceito.md). Não é o
 * adaptador Matrix do núcleo: esse nasce na IN3, com tabelas, cofre, fila e
 * testes. Tudo aqui fica atrás de `GUIDU_INBOX_POC=1` e lê os segredos do
 * ambiente (gerados por scripts/local/synapse-poc.sh), nunca do banco.
 */

export type MatrixPocConfig = Readonly<{
  homeserverUrl: string;
  serverName: string;
  asToken: string;
  hsToken: string;
  asSender: string;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  /** Arquivo JSON que faz o papel das tabelas da IN3 (salas e contas). */
  storePath: string;
}>;

export function inboxPocEnabled(): boolean {
  return process.env.GUIDU_INBOX_POC === "1";
}

export function matrixPocConfig(): MatrixPocConfig | null {
  if (!inboxPocEnabled()) return null;
  const env = process.env;
  const required = [
    "MATRIX_HOMESERVER_URL",
    "MATRIX_SERVER_NAME",
    "MATRIX_AS_TOKEN",
    "MATRIX_HS_TOKEN",
    "MATRIX_JWT_SECRET",
  ] as const;
  if (required.some((name) => !env[name])) return null;
  return {
    homeserverUrl: env.MATRIX_HOMESERVER_URL!.replace(/\/$/, ""),
    serverName: env.MATRIX_SERVER_NAME!,
    asToken: env.MATRIX_AS_TOKEN!,
    hsToken: env.MATRIX_HS_TOKEN!,
    asSender: env.MATRIX_AS_SENDER || "_guidu_core",
    jwtSecret: env.MATRIX_JWT_SECRET!,
    jwtIssuer: env.MATRIX_JWT_ISSUER || "guidu-console-dev",
    jwtAudience: env.MATRIX_JWT_AUDIENCE || "guidu-matrix-dev",
    storePath: env.MATRIX_POC_STORE || "/tmp/guidu-inbox-poc-store.json",
  };
}
