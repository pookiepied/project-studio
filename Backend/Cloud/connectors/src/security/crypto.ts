import type { Env } from "../types";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getEncryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptJson(env: Env, payload: unknown): Promise<{ ciphertext: string; nonce: string }> {
  if (!env.CONNECTORS_ENCRYPTION_KEY) {
    throw new Error("CONNECTORS_ENCRYPTION_KEY is not configured");
  }

  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await getEncryptionKey(env.CONNECTORS_ENCRYPTION_KEY);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    textEncoder.encode(JSON.stringify(payload)),
  );

  return {
    ciphertext: toBase64(new Uint8Array(encrypted)),
    nonce: toBase64(nonce),
  };
}

export async function decryptJson<T>(env: Env, ciphertext: string, nonce: string): Promise<T> {
  if (!env.CONNECTORS_ENCRYPTION_KEY) {
    throw new Error("CONNECTORS_ENCRYPTION_KEY is not configured");
  }

  const key = await getEncryptionKey(env.CONNECTORS_ENCRYPTION_KEY);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(nonce) },
    key,
    fromBase64(ciphertext),
  );

  return JSON.parse(textDecoder.decode(decrypted)) as T;
}
