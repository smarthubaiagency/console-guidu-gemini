/**
 * ============================================================================
 * File: src/core/credentials/crypto.ts
 * Module: BYOK Secret Vault Cryptographic Engine
 *
 * Maintenance Rationale:
 * - Implements AES-256-GCM envelope encryption for all sensitive tokens & secrets
 *   persisted in the database.
 * - Adheres strictly to the invariant: "nenhum segredo no client" (Spec §16, §25).
 * - Generates masked representation preserving only non-identifying prefix and
 *   suffix for UI identification (e.g., "sk-...a1b2").
 * - Payload contains authentication tag ensuring integrity and tampering detection.
 * ============================================================================
 */

import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag

/**
 * Resolves the 256-bit encryption key from environment or fallback derivation.
 */
function getMasterKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    if (envKey.length === 64) {
      // Hex-encoded 32-byte key
      return Buffer.from(envKey, "hex");
    }
    if (Buffer.byteLength(envKey) === 32) {
      return Buffer.from(envKey, "utf8");
    }
    // Derive 32 bytes using SHA-256 if key is arbitrary length
    return crypto.createHash("sha256").update(envKey).digest();
  }

  // Development / test deterministic key
  return crypto
    .createHash("sha256")
    .update("guidu-default-development-encryption-key-32bytes")
    .digest();
}

export type EncryptedResult = {
  encryptedPayload: string;
  maskedValue: string;
};

/**
 * Creates a safe masked string for display purposes, revealing only the
 * first few chars (or provider prefix) and the last 4 characters.
 *
 * Examples:
 * - "sk-proj-abc12345678xyz" -> "sk-...7xyz"
 * - "AIzaSyD1234567890abcd" -> "AIza...abcd"
 * - "short" -> "***"
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
 * Encrypts a sensitive string using AES-256-GCM.
 *
 * @param secret Plaintext sensitive token / API key
 * @returns Serialized encrypted payload and safe masked display string
 */
export function encryptSecret(secret: string): EncryptedResult {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  const payload = JSON.stringify({
    iv: iv.toString("hex"),
    tag: authTag.toString("hex"),
    data: ciphertext.toString("hex"),
    alg: ALGORITHM,
  });

  return {
    encryptedPayload: payload,
    maskedValue: maskSecret(secret),
  };
}

/**
 * Decrypts an AES-256-GCM payload back to its original plaintext string.
 *
 * @param encryptedPayload Serialized JSON string produced by `encryptSecret`
 * @throws Error if authentication tag mismatch or malformed payload
 */
export function decryptSecret(encryptedPayload: string): string {
  const key = getMasterKey();

  let parsed: { iv: string; tag: string; data: string; alg?: string };
  try {
    parsed = JSON.parse(encryptedPayload);
  } catch {
    throw new Error("Invalid encrypted payload format: not valid JSON");
  }

  if (!parsed.iv || !parsed.tag || !parsed.data) {
    throw new Error("Invalid encrypted payload: missing required fields");
  }

  const iv = Buffer.from(parsed.iv, "hex");
  const authTag = Buffer.from(parsed.tag, "hex");
  const ciphertext = Buffer.from(parsed.data, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
