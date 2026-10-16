import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Integrity seal of an event (H1, ADR 0022 §5): `content_hash` is the
 * HMAC-SHA256 of the canonical JSON (keys sorted at every level) of the
 * event's type, ids, moment, author, data and the seal before it in its
 * chain, with a secret key of the platform (`EVENTS_HMAC_KEY`, version
 * `EVENTS_HMAC_KEY_ID`). HMAC rather than a plain hash: short data (a
 * phone, a CPF) would be found by trying. The database never sees the key.
 *
 * The previous seal (`prev_hash`) is inside the sealed material too, so a
 * removed or reordered event breaks the next seal and not only a column
 * anyone with database access could rewrite.
 *
 * Dependency-free (only `node:crypto`), so the e2e rig seeds sealed events
 * with the same code.
 */

export type SealMaterial = Readonly<{
  id: string;
  type: string;
  partnerId: string | null;
  organizationId: string | null;
  workspaceId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  createdBy: string | null;
  occurredAt: Date;
  data: unknown;
  prevHash: string | null;
}>;

export type SealKey = Readonly<{ version: string; secret: string }>;

export class EventsKeyMissingError extends Error {
  constructor(detail: string) {
    super(
      `Central de Eventos sem chave do selo (${detail}): defina EVENTS_HMAC_KEY e EVENTS_HMAC_KEY_ID.`,
    );
    this.name = "EventsKeyMissingError";
  }
}

const KEY_VERSION = /^[A-Za-z0-9_.-]{1,32}$/;
export const MIN_KEY_LENGTH = 32;

type Env = Readonly<Record<string, string | undefined>>;

/** The current key; throws when it is missing or too short. */
export function currentSealKey(env: Env = process.env): SealKey {
  const secret = env.EVENTS_HMAC_KEY?.trim() ?? "";
  const version = env.EVENTS_HMAC_KEY_ID?.trim() ?? "";
  if (!secret) throw new EventsKeyMissingError("EVENTS_HMAC_KEY ausente");
  if (secret.length < MIN_KEY_LENGTH) {
    throw new EventsKeyMissingError(
      `EVENTS_HMAC_KEY com menos de ${MIN_KEY_LENGTH} caracteres`,
    );
  }
  if (!KEY_VERSION.test(version)) {
    throw new EventsKeyMissingError("EVENTS_HMAC_KEY_ID ausente ou inválido");
  }
  return { version, secret };
}

/**
 * Every key that can verify a seal: the current one and the previous ones
 * of a rotation (`EVENTS_HMAC_KEYS_PREVIOUS="k0:<key>,k-old:<key>"`).
 */
export function sealKeys(env: Env = process.env): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  for (const entry of (env.EVENTS_HMAC_KEYS_PREVIOUS ?? "").split(",")) {
    const at = entry.indexOf(":");
    if (at <= 0) continue;
    const version = entry.slice(0, at).trim();
    const secret = entry.slice(at + 1).trim();
    if (KEY_VERSION.test(version) && secret.length >= MIN_KEY_LENGTH) {
      keys.set(version, secret);
    }
  }
  try {
    const current = currentSealKey(env);
    keys.set(current.version, current.secret);
  } catch {
    // Without the current key only the previous ones verify.
  }
  return keys;
}

/** The value as JSON keeps it: dates as ISO text, no `undefined`. */
export function normalizeData(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

/** JSON with the keys of every object sorted; arrays keep their order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

/** The text that is sealed. */
export function sealedText(material: SealMaterial): string {
  return canonicalJson({
    id: material.id,
    type: material.type,
    partner_id: material.partnerId,
    organization_id: material.organizationId,
    workspace_id: material.workspaceId,
    subject_type: material.subjectType,
    subject_id: material.subjectId,
    created_by: material.createdBy,
    occurred_at: material.occurredAt.toISOString(),
    data: normalizeData(material.data),
    prev_hash: material.prevHash,
  });
}

export function computeSeal(material: SealMaterial, secret: string): string {
  return createHmac("sha256", secret)
    .update(sealedText(material))
    .digest("hex");
}

export type SealCheck = "ok" | "mismatch" | "unknown_key";

/** Recomputes the seal with the key of its version and compares. */
export function checkSeal(
  material: SealMaterial,
  contentHash: string,
  keyVersion: string,
  keys: ReadonlyMap<string, string> = sealKeys(),
): SealCheck {
  const secret = keys.get(keyVersion);
  if (!secret) return "unknown_key";
  const expected = Buffer.from(computeSeal(material, secret), "hex");
  const given = Buffer.from(contentHash, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given)
    ? "ok"
    : "mismatch";
}

/** The chain of an event: its workspace, else its partner, else the platform. */
export function chainKeyOf(
  ids: Readonly<{ workspaceId: string | null; partnerId: string | null }>,
): string {
  if (ids.workspaceId) return `ws:${ids.workspaceId}`;
  if (ids.partnerId) return `partner:${ids.partnerId}`;
  return "platform";
}
