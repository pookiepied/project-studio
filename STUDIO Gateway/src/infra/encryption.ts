/**
 * Encryption for provider credentials at rest — canonical location (was `lib/encryption.ts`).
 * Uses WebCrypto AES-GCM 256. Key from Worker Secret CREDENTIAL_ENCRYPTION_KEY (base64 32 bytes).
 * Format at rest: base64(iv 12B + ciphertext + tag 16B)
 */

import { AppError } from "../lib/errors.ts";

const IV_LENGTH = 12;

function getKeyBytes(base64: string): Uint8Array {
  const raw = base64.startsWith("base64:") ? base64.slice(7) : base64;
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length !== 32) {
    throw new Error(`CREDENTIAL_ENCRYPTION_KEY must be 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  const bytes = getKeyBytes(keyBase64);
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encrypt(plaintext: string, keyBase64: string): Promise<string> {
  const key = await importKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  let bin = "";
  for (let i = 0; i < combined.length; i++) bin += String.fromCharCode(combined[i]);
  return btoa(bin);
}

export async function decrypt(encryptedBase64: string, keyBase64: string): Promise<string> {
  try {
    const key = await importKey(keyBase64);
    const bin = atob(encryptedBase64);
    const combined = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) combined[i] = bin.charCodeAt(i);
    if (combined.length < IV_LENGTH + 16) throw new Error("ciphertext too short");
    const iv = combined.slice(0, IV_LENGTH);
    const ciphertext = combined.slice(IV_LENGTH);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plain);
  } catch (e) {
    throw new AppError("DECRYPTION_ERROR", "Failed to decrypt credential", 500, { cause: e });
  }
}

export async function hashGatewayKeyAsync(rawKey: string): Promise<string> {
  const data = new TextEncoder().encode(rawKey);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateGatewayKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `sk-gw_${btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}
