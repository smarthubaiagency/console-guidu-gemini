import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { MatrixPocConfig } from "./config";

/**
 * PROVA DE CONCEITO (IN1). Um arquivo JSON no lugar das tabelas que a IN3
 * cria (contas Matrix e salas por `room_id`): a prova não tem migration.
 * Sem trava entre processos; só um app de dev escreve.
 */

export type PocStore = {
  /** workspaceSlug → mxids dos atendentes provisionados. */
  attendants: Record<string, string[]>;
  /** room_id → workspace e consumidor, como a tabela de salas da IN3. */
  rooms: Record<string, { workspaceSlug: string; consumer: string; createdAt: string }>;
  /** `event_id` já processados (o Synapse repete transações em caso de falha). */
  transactions: string[];
};

export function readStore(config: MatrixPocConfig): PocStore {
  try {
    return JSON.parse(readFileSync(config.storePath, "utf8")) as PocStore;
  } catch {
    return { attendants: {}, rooms: {}, transactions: [] };
  }
}

export function updateStore(
  config: MatrixPocConfig,
  change: (store: PocStore) => void,
): PocStore {
  const store = readStore(config);
  change(store);
  store.transactions = store.transactions.slice(-5000);
  mkdirSync(dirname(config.storePath), { recursive: true });
  writeFileSync(config.storePath, JSON.stringify(store, null, 2));
  return store;
}
