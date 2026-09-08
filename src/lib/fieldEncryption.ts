import crypto from "node:crypto";

const PREFIX = "enc:v1:";
function key(): Buffer | null {
  const raw = process.env.FIELD_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY must be a 32-byte base64 key");
  return decoded;
}

/** AES-256-GCM envelope for high-sensitivity free-text/identity fields. */
export function encryptSensitive(value: string | null | undefined, context: string): string | null {
  if (!value) return null;
  if (value.startsWith(PREFIX)) return value;
  const encryptionKey = key();
  if (!encryptionKey) {
    if (process.env.NODE_ENV === "production") throw new Error("Sensitive-data encryption is not configured");
    return value;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptSensitive(value: string | null | undefined, context: string): string | null {
  if (!value) return null;
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext, migrated on next write
  const encryptionKey = key();
  if (!encryptionKey) throw new Error("Sensitive-data encryption is not configured");
  const packed = Buffer.from(value.slice(PREFIX.length), "base64url");
  if (packed.length < 29) throw new Error("Encrypted value is invalid");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
}
