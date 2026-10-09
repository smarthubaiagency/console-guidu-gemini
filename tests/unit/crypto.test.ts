import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  getMasterKeyConfig,
  getPreviousKeys,
} from "@/core/credentials/crypto";

describe("Master Encryption Key & Vault Cryptography (C10, Spec §13, §16)", () => {
  const originalEnv = process.env;

  const validHexKey1 =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const validHexKey2 =
    "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
  // 32 bytes base64 (256 bits)
  const validBase64Key = Buffer.from(
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "hex",
  ).toString("base64");

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ENCRYPTION_KEY = validHexKey1;
    process.env.ENCRYPTION_KEY_ID = "k1";
    delete process.env.ENCRYPTION_KEYS_PREVIOUS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Key Parsing and Environment Validation", () => {
    it("fails closed when ENCRYPTION_KEY is missing or empty", () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => getMasterKeyConfig()).toThrowError(
        /Master encryption key is missing/,
      );

      process.env.ENCRYPTION_KEY = "   ";
      expect(() => getMasterKeyConfig()).toThrowError(
        /Master encryption key is missing/,
      );
    });

    it("fails when ENCRYPTION_KEY is not 32 bytes (invalid length or encoding)", () => {
      process.env.ENCRYPTION_KEY = "too-short";
      expect(() => getMasterKeyConfig()).toThrowError(
        /Invalid key format for ENCRYPTION_KEY/,
      );

      // 62 chars hex (31 bytes)
      process.env.ENCRYPTION_KEY =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd";
      expect(() => getMasterKeyConfig()).toThrowError(
        /Invalid key format for ENCRYPTION_KEY/,
      );

      // 66 chars hex (33 bytes)
      process.env.ENCRYPTION_KEY = validHexKey1 + "aa";
      expect(() => getMasterKeyConfig()).toThrowError(
        /Invalid key format for ENCRYPTION_KEY/,
      );

      // 64 chars with non-hex characters
      process.env.ENCRYPTION_KEY = validHexKey1.substring(0, 62) + "zz";
      expect(() => getMasterKeyConfig()).toThrowError(
        /Invalid key format for ENCRYPTION_KEY/,
      );
    });

    it("accepts valid 64-char hex key", () => {
      process.env.ENCRYPTION_KEY = validHexKey1;
      const config = getMasterKeyConfig();
      expect(config.key.length).toBe(32);
      expect(config.keyId).toBe("k1");
    });

    it("accepts valid 44-char base64 key", () => {
      process.env.ENCRYPTION_KEY = validBase64Key;
      const config = getMasterKeyConfig();
      expect(config.key.length).toBe(32);
      expect(config.keyId).toBe("k1");
    });

    it("defaults keyId to 'k1' when ENCRYPTION_KEY_ID is not configured", () => {
      delete process.env.ENCRYPTION_KEY_ID;
      const config = getMasterKeyConfig();
      expect(config.keyId).toBe("k1");
    });

    it("parses previous keys from ENCRYPTION_KEYS_PREVIOUS", () => {
      process.env.ENCRYPTION_KEYS_PREVIOUS = `k0:${validHexKey2},kbase:${validBase64Key}`;
      const prevKeys = getPreviousKeys();
      expect(prevKeys.has("k0")).toBe(true);
      expect(prevKeys.has("kbase")).toBe(true);
      expect(prevKeys.get("k0")?.length).toBe(32);
      expect(prevKeys.get("kbase")?.length).toBe(32);
    });

    it("throws on malformed ENCRYPTION_KEYS_PREVIOUS entry", () => {
      process.env.ENCRYPTION_KEYS_PREVIOUS = "k0:invalid-key";
      expect(() => getPreviousKeys()).toThrowError(
        /Invalid key format for ENCRYPTION_KEYS_PREVIOUS/,
      );
    });
  });

  describe("Encryption & Decryption Roundtrip", () => {
    it("encrypts secret embedding current kid and decrypts with fidelity", () => {
      const plaintext = "sk-proj-openai-production-secret-123456789";
      const { encryptedPayload, maskedValue } = encryptSecret(plaintext);

      expect(maskedValue).toBe("sk-...6789");
      expect(encryptedPayload).not.toContain(plaintext);

      const parsed = JSON.parse(encryptedPayload);
      expect(parsed.kid).toBe("k1");
      expect(parsed.alg).toBe("aes-256-gcm");
      expect(typeof parsed.iv).toBe("string");
      expect(typeof parsed.tag).toBe("string");
      expect(typeof parsed.data).toBe("string");

      const decrypted = decryptSecret(encryptedPayload);
      expect(decrypted).toBe(plaintext);
    });

    it("decrypts ciphertext using rotated previous key from ENCRYPTION_KEYS_PREVIOUS", () => {
      // Step 1: Encrypt with key k1
      process.env.ENCRYPTION_KEY = validHexKey1;
      process.env.ENCRYPTION_KEY_ID = "k1";
      const plaintext = "secret-stored-under-k1";
      const { encryptedPayload } = encryptSecret(plaintext);

      // Step 2: Rotate active key to k2, configure k1 as previous key
      process.env.ENCRYPTION_KEY = validHexKey2;
      process.env.ENCRYPTION_KEY_ID = "k2";
      process.env.ENCRYPTION_KEYS_PREVIOUS = `k1:${validHexKey1}`;

      const decrypted = decryptSecret(encryptedPayload);
      expect(decrypted).toBe(plaintext);
    });

    it("throws when kid is not found in active key or previous keys", () => {
      // Encrypt with key k1
      process.env.ENCRYPTION_KEY = validHexKey1;
      process.env.ENCRYPTION_KEY_ID = "k1";
      const { encryptedPayload } = encryptSecret("secret-value");

      // Switch active to k2 without k1 in ENCRYPTION_KEYS_PREVIOUS
      process.env.ENCRYPTION_KEY = validHexKey2;
      process.env.ENCRYPTION_KEY_ID = "k2";
      delete process.env.ENCRYPTION_KEYS_PREVIOUS;

      expect(() => decryptSecret(encryptedPayload)).toThrowError(
        /Unknown encryption key ID "k1"/,
      );
    });

    it("decrypts legacy payload without kid using active key", () => {
      // Encrypt with k1
      const { encryptedPayload } = encryptSecret("legacy-test-secret");
      const parsed = JSON.parse(encryptedPayload);
      delete parsed.kid; // simulate legacy payload prior to C10
      const legacyPayload = JSON.stringify(parsed);

      const decrypted = decryptSecret(legacyPayload);
      expect(decrypted).toBe("legacy-test-secret");
    });

    it("decrypts legacy payload without kid using previous key when active key differs", () => {
      const { encryptedPayload } = encryptSecret("legacy-rotated-secret");
      const parsed = JSON.parse(encryptedPayload);
      delete parsed.kid;
      const legacyPayload = JSON.stringify(parsed);

      // Rotate active to k2, k1 in previous
      process.env.ENCRYPTION_KEY = validHexKey2;
      process.env.ENCRYPTION_KEY_ID = "k2";
      process.env.ENCRYPTION_KEYS_PREVIOUS = `k1:${validHexKey1}`;

      const decrypted = decryptSecret(legacyPayload);
      expect(decrypted).toBe("legacy-rotated-secret");
    });

    it("detects ciphertext tampering and fails decryption", () => {
      const { encryptedPayload } = encryptSecret("my-tamper-target");
      const parsed = JSON.parse(encryptedPayload);
      parsed.data = parsed.data.substring(0, parsed.data.length - 2) + "aa";

      expect(() => decryptSecret(JSON.stringify(parsed))).toThrow();
    });

    it("detects authentication tag tampering and fails decryption", () => {
      const { encryptedPayload } = encryptSecret("my-tamper-target");
      const parsed = JSON.parse(encryptedPayload);
      parsed.tag = parsed.tag.substring(0, parsed.tag.length - 2) + "00";

      expect(() => decryptSecret(JSON.stringify(parsed))).toThrow();
    });

    it("throws on corrupted or non-JSON payload string", () => {
      expect(() => decryptSecret("not-valid-json")).toThrow();
    });
  });

  describe("maskSecret", () => {
    it("masks sk- prefixed keys", () => {
      expect(maskSecret("sk-1234567890abcdef")).toBe("sk-...cdef");
    });

    it("masks AIza prefixed keys", () => {
      expect(maskSecret("AIzaSyD1234567890wxyz")).toBe("AIza...wxyz");
    });

    it("masks gdu_live_ prefixed keys", () => {
      expect(maskSecret("gdu_live_0123456789abcdef")).toBe("gdu_...cdef");
    });

    it("masks general long secret with last 4 characters", () => {
      expect(maskSecret("super-secret-password-1234")).toBe("supe...1234");
    });

    it("masks short secret with asterisks", () => {
      expect(maskSecret("abc")).toBe("***");
    });
  });
});
