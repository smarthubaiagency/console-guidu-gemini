import { createHmac, randomBytes } from "node:crypto";

/**
 * RFC 6238 TOTP, used by the Auth test double and by the tests themselves.
 *
 * Implementing it here means the MFA specs compute a real code from the
 * enrolment secret instead of agreeing on a magic number, so a broken
 * challenge/verify round trip actually fails.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_SECONDS = 30;
const DIGITS = 6;

export function generateBase32Secret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of secret.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpCode(secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", base32Decode(secret))
    .update(counterBuffer)
    .digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/** Accepts the current window and the one before it, like Supabase does. */
export function totpMatches(secret: string, code: string): boolean {
  const now = Date.now();
  return (
    code === totpCode(secret, now) ||
    code === totpCode(secret, now - PERIOD_SECONDS * 1000)
  );
}
