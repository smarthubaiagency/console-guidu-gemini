/**
 * ============================================================================
 * File: src/core/credentials/crypto.ts
 * Module: BYOK Secret Vault Cryptographic Engine
 *
 * Maintenance Rationale:
 * - Implements AES-256-GCM envelope encryption for all sensitive tokens & secrets
 *   persisted in the database.
 * - Adheres strictly to the invariant: "nenhum segredo no client" (Spec §16, §25).
 * - Enforces mandatory 32-byte master key via ENCRYPTION_KEY (hex or base64) with
 *   no static fallback key.
 * - Supports key versioning (ENCRYPTION_KEY_ID, default "k1") stored as `kid`
 *   in the payload and rotation via ENCRYPTION_KEYS_PREVIOUS ("kid:key,kid:key").
 * - Supports legacy read-only fallback for payloads without `kid`.
 * ============================================================================
 */

import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag

/**
 * Validates and parses a raw key string into a 32-byte Buffer.
 * Accepts exactly 32 bytes encoded in 64 hex characters or 44 base64 characters.
 */
export function parseKeyBuffer(rawKey: string, keyName = "ENCRYPTION_KEY"): Buffer {
  const trimmed = rawKey.trim();

  // 64-char hex string (32 bytes)
  if (trimmed.length === 64 && /^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  // 44-char base64 string (32 bytes)
  if (trimmed.length === 44 && /^[A-Za-z0-9+/]{43}=$/.test(trimmed)) {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length === 32) {
      return buf;
    }
  }

  throw new Error(
    `Invalid key format for ${keyName}: must be exactly 32 bytes encoded in 64 hex characters or 44 base64 characters.`,
  );
}

/**
 * Resolves the active 256-bit encryption key and its key ID from environment.
 * Throws immediately if ENCRYPTION_KEY is missing or invalid.
 */
export function getMasterKeyConfig(): { key: Buffer; keyId: string } {
  const envKey = process.env.ENCRYPTION_KEY;
  if (!envKey || !envKey.trim()) {
    throw new Error(
      "Master encryption key is missing. Set ENCRYPTION_KEY environment variable (32 bytes in hex or base64).",
    );
  }

  const key = parseKeyBuffer(envKey, "ENCRYPTION_KEY");
  const keyId = process.env.ENCRYPTION_KEY_ID?.trim() || "k1";

  return { key, keyId };
}

/**
 * Parses previous keys configured in ENCRYPTION_KEYS_PREVIOUS for rotation.
 * Format: "kid:chave,kid:chave" (only used for decryption).
 */
export function getPreviousKeys(): Map<string, Buffer> {
  const map = new Map<string, Buffer>();
  const raw = process.env.ENCRYPTION_KEYS_PREVIOUS;
  if (!raw || !raw.trim()) {
    return map;
  }

  const pairs = raw.split(",");
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex <= 0) {
      throw new Error(
        `Invalid ENCRYPTION_KEYS_PREVIOUS entry "${trimmed}": expected format "kid:key".`,
      );
    }
    const kid = trimmed.substring(0, colonIndex).trim();
    const keyRaw = trimmed.substring(colonIndex + 1).trim();
    if (!kid || !keyRaw) {
      throw new Error(
        `Invalid ENCRYPTION_KEYS_PREVIOUS entry "${trimmed}": kid and key must not be empty.`,
      );
    }
    const keyBuf = parseKeyBuffer(keyRaw, `ENCRYPTION_KEYS_PREVIOUS[${kid}]`);
    map.set(kid, keyBuf);
  }

  return map;
}

export type EncryptedResult = {
  encryptedPayload: string;
  maskedValue: string;
};

export type EncryptedPayloadStructure = {
  kid: string;
  iv: string;
  tag: string;
  data: string;
  alg: string;
};

/**
 * Creates a safe masked string for display purposes, revealing only the
 * first few chars (or provider prefix) and the last 4 characters.
 */
export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 8) {
    return "***";
  }

  const prefix = trimmed.startsWith("sk-")
    ? "sk-"
    : trimmed.substring(0, 4);
  const suffix = trimmed.slice(-4);

  return `${prefix}...${suffix}`;
}

/**
 * Encrypts a sensitive string using AES-256-GCM and the active key ID.
 *
 * @param secret Plaintext sensitive token / API key
 * @returns Serialized encrypted payload (with kid) and safe masked display string
 */
export function encryptSecret(secret: string): EncryptedResult {
  const { key, keyId } = getMasterKeyConfig();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  const payload: EncryptedPayloadStructure = {
    kid: keyId,
    iv: iv.toString("hex"),
    tag: authTag.toString("hex"),
    data: ciphertext.toString("hex"),
    alg: ALGORITHM,
  };

  return {
    encryptedPayload: JSON.stringify(payload),
    maskedValue: maskSecret(secret),
  };
}

/**
 * Decrypts an AES-256-GCM payload back to its original plaintext string.
 * Resolves key by `kid` (active key or previous rotation key).
 * Falls back to legacy key resolution when `kid` is missing.
 *
 * @param encryptedPayload Serialized JSON string produced by `encryptSecret`
 * @throws Error if authentication tag mismatch, unknown key ID or malformed payload
 */
export function decryptSecret(encryptedPayload: string): string {
  let parsed: { kid?: string; iv: string; tag: string; data: string; alg?: string };
  try {
    parsed = JSON.parse(encryptedPayload);
  } catch {
    throw new Error("Invalid encrypted payload format: not valid JSON");
  }

  if (!parsed.iv || !parsed.tag || !parsed.data) {
    throw new Error("Invalid encrypted payload: missing required fields");
  }

  const { key: currentKey, keyId: currentKeyId } = getMasterKeyConfig();
  let keyToUse: Buffer | undefined;

  if (parsed.kid) {
    if (parsed.kid === currentKeyId) {
      keyToUse = currentKey;
    } else {
      const prevKeys = getPreviousKeys();
      keyToUse = prevKeys.get(parsed.kid);
      if (!keyToUse) {
        throw new Error(
          `Unknown encryption key ID "${parsed.kid}": key not found in current or previous keys.`,
        );
      }
    }
  } else {
    // Legacy payload without kid (dev legacy data): try current key first
    keyToUse = currentKey;
  }

  const iv = Buffer.from(parsed.iv, "hex");
  const authTag = Buffer.from(parsed.tag, "hex");
  const ciphertext = Buffer.from(parsed.data, "hex");

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, keyToUse, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    // If it was a legacy payload without kid and current key failed, attempt previous keys
    if (!parsed.kid) {
      const prevKeys = getPreviousKeys();
      for (const [, prevKey] of prevKeys.entries()) {
        try {
          const decipher = crypto.createDecipheriv(ALGORITHM, prevKey, iv, {
            authTagLength: AUTH_TAG_LENGTH,
          });
          decipher.setAuthTag(authTag);
          const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
          ]);
          return decrypted.toString("utf8");
        } catch {
          // Continue to next key candidate
        }
      }
    }
    throw new Error("Decryption failed: authentication tag mismatch or corrupted ciphertext.");
  }
}
