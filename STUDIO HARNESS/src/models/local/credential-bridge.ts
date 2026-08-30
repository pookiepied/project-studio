import type {
  ApiKeyCredential,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";

import {
  CredentialStoreError,
  MAX_SECRET_LENGTH,
  type CredentialKey,
  type SecureCredentialStore,
} from "../../credentials/credential-store.js";

/**
 * Presents Project Studio's OS keychain as Pi's `CredentialStore`.
 *
 * This is the whole BYOK integration point: Pi owns provider auth resolution,
 * OAuth refresh, and ambient environment lookups, but it never chooses where
 * secrets live. Everything Pi persists lands in the platform keychain, so BYOK
 * keys are never written to a file the way OpenCode's `auth.json` is.
 */

/**
 * Provider ids are restricted more tightly than the credential store's own key
 * rule: `.` is reserved as the chunk separator below, so allowing it in an id
 * would let provider `openai.1` collide with the second chunk of `openai`.
 * Every Pi built-in id uses only lowercase letters, digits, and hyphens.
 */
const VALID_PROVIDER_ID = /^[a-z0-9][a-z0-9-]*$/;

/** Entry holding the list of provider ids, since a keychain cannot enumerate. */
const INDEX_ID = "index";

/**
 * Chunk budget. A credential is JSON, and an OAuth credential carrying both an
 * access and a refresh token exceeds the platform's 1280-code-unit ceiling on a
 * single entry (ADR 0007), so values are split across numbered entries. The
 * margin leaves room for the header on the first chunk.
 */
const CHUNK_SIZE = MAX_SECRET_LENGTH - 32;
const HEADER = "v1";

export function assertValidProviderId(providerId: string): string {
  if (!VALID_PROVIDER_ID.test(providerId)) {
    throw new CredentialStoreError("invalid", {
      message:
        "Provider id must be lowercase letters, digits, and hyphens, starting with a letter or digit.",
    });
  }
  return providerId;
}

export class PiCredentialStore implements CredentialStore {
  readonly #secrets: SecureCredentialStore;
  /**
   * Resolves a provider's key from the merged connection store, when the
   * bridge is wired to one. Checked before the legacy entry: a key the user
   * typed into the settings surface outranks one an older build wrote to the
   * bridge's own location. Without it, the bridge reads only its own entries,
   * which is the whole of the legacy behaviour.
   */
  readonly #connectionKey:
    | ((providerId: string) => Promise<string | undefined>)
    | undefined;

  /**
   * Per-provider write serialization. Pi documents `modify` as the only write
   * path precisely so a refresh and a login cannot interleave; without this
   * queue two concurrent refreshes could each read the same credential and the
   * later write would resurrect a rotated token.
   */
  readonly #queues = new Map<string, Promise<unknown>>();

  constructor(
    secrets: SecureCredentialStore,
    connectionKey?: (providerId: string) => Promise<string | undefined>,
  ) {
    this.#secrets = secrets;
    this.#connectionKey = connectionKey;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    assertValidProviderId(providerId);
    if (this.#connectionKey !== undefined) {
      const fromConnection = await this.#connectionKey(providerId);
      if (fromConnection !== undefined && fromConnection !== "") {
        const credential: ApiKeyCredential = { type: "api_key", key: fromConnection };
        return credential;
      }
    }
    return this.#read(providerId);
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const ids = await this.#readIndex();

    const infos: CredentialInfo[] = [];
    for (const providerId of ids) {
      const credential = await this.#read(providerId);
      // The index is a hint, not the truth: a partially deleted entry simply
      // does not appear rather than failing the whole listing.
      if (credential) infos.push({ providerId, type: credential.type });
    }
    return infos;
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    assertValidProviderId(providerId);

    return this.#serialize(providerId, async () => {
      const current = await this.#read(providerId);
      const next = await fn(current);

      // Pi's contract: undefined means "leave the entry unchanged".
      if (next === undefined) return current;

      await this.#writeRaw(providerId, JSON.stringify(next));
      await this.#addToIndex(providerId);
      return next;
    });
  }

  async delete(providerId: string): Promise<void> {
    assertValidProviderId(providerId);

    await this.#serialize(providerId, async () => {
      await this.#writeRaw(providerId, undefined);
      await this.#removeFromIndex(providerId);
    });
  }

  #serialize<T>(providerId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(providerId) ?? Promise.resolve();
    // `then(work, work)` runs the next write whether or not the previous one
    // succeeded, so one failure cannot wedge the queue for that provider.
    const next = previous.then(work, work);

    this.#queues.set(
      providerId,
      next.catch(() => undefined),
    );
    return next;
  }

  async #read(providerId: string): Promise<Credential | undefined> {
    const raw = await this.#readRaw(providerId);
    if (raw === undefined) return undefined;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return undefined;
      const type = (parsed as { type?: unknown }).type;
      if (type !== "api_key" && type !== "oauth") return undefined;
      return parsed as Credential;
    } catch {
      // A stored value that will not parse is unusable. Reporting "not
      // configured" lets the user re-connect instead of hitting a hard failure
      // on every request.
      return undefined;
    }
  }

  async #readRaw(id: string): Promise<string | undefined> {
    const first = await this.#secrets.get(key(id));
    if (first === null) return undefined;

    const match = /^v1:(\d+):/.exec(first);
    if (!match) return undefined;

    const count = Number(match[1]);
    let value = first.slice(match[0].length);
    for (let index = 1; index < count; index += 1) {
      const chunk = await this.#secrets.get(key(`${id}.${index}`));
      // A missing chunk means a partial write; treat the value as absent
      // rather than returning a truncated credential.
      if (chunk === null) return undefined;
      value += chunk;
    }
    return value;
  }

  /** Writes a value across as many entries as it needs, or clears it entirely. */
  async #writeRaw(id: string, value: string | undefined): Promise<void> {
    const chunks: string[] = [];
    if (value !== undefined) {
      for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
        chunks.push(value.slice(offset, offset + CHUNK_SIZE));
      }
      if (chunks.length === 0) chunks.push("");
    }

    if (chunks.length === 0) {
      await this.#secrets.delete(key(id));
    } else {
      await this.#secrets.set(key(id), `${HEADER}:${chunks.length}:${chunks[0]}`);
      for (let index = 1; index < chunks.length; index += 1) {
        await this.#secrets.set(key(`${id}.${index}`), chunks[index] as string);
      }
    }

    // Remove trailing chunks left by a previously longer value, so a shorter
    // credential cannot be read back with stale data appended.
    for (let index = Math.max(chunks.length, 1); ; index += 1) {
      const removed = await this.#secrets.delete(key(`${id}.${index}`));
      if (!removed) break;
    }
  }

  async #readIndex(): Promise<string[]> {
    const raw = await this.#readRaw(INDEX_ID);
    if (raw === undefined) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [];
    } catch {
      return [];
    }
  }

  async #addToIndex(providerId: string): Promise<void> {
    const ids = await this.#readIndex();
    if (ids.includes(providerId)) return;
    ids.push(providerId);
    ids.sort();
    await this.#writeRaw(INDEX_ID, JSON.stringify(ids));
  }

  async #removeFromIndex(providerId: string): Promise<void> {
    const ids = await this.#readIndex();
    const remaining = ids.filter((id) => id !== providerId);
    if (remaining.length === ids.length) return;
    await this.#writeRaw(
      INDEX_ID,
      remaining.length === 0 ? JSON.stringify([]) : JSON.stringify(remaining),
    );
  }
}

function key(id: string): CredentialKey {
  return { scope: "provider", id };
}

/**
 * Reads one provider credential from the bridge's own keychain format, for
 * callers outside this module that need to know whether a legacy entry exists
 * and what it holds.
 *
 * The merged connection store resolves a connection's key from its own entry
 * first and this legacy location second, which is how a provider connected
 * before the stores were unified keeps working with nothing retyped. The
 * value is returned to the caller only - never logged, never stored elsewhere.
 */
export async function readStoredProviderCredential(
  secrets: SecureCredentialStore,
  providerId: string,
): Promise<{ readonly type: "api_key" | "oauth"; readonly apiKey?: string } | undefined> {
  assertValidProviderId(providerId);
  const raw = await readRawChunked(secrets, providerId);
  if (raw === undefined) return undefined;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return undefined;
    const type = parsed.type;
    if (type !== "api_key" && type !== "oauth") return undefined;
    return {
      type,
      ...(type === "api_key" && typeof parsed.key === "string" ? { apiKey: parsed.key } : {}),
    };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readRawChunked(secrets: SecureCredentialStore, id: string): Promise<string | undefined> {
  const first = await secrets.get(key(id));
  if (first === null) return undefined;

  const match = /^v1:(\d+):/.exec(first);
  if (!match) return undefined;

  const count = Number(match[1]);
  let value = first.slice(match[0].length);
  for (let index = 1; index < count; index += 1) {
    const chunk = await secrets.get(key(`${id}.${index}`));
    // A missing chunk means a partial write; treat the value as absent
    // rather than returning a truncated credential.
    if (chunk === null) return undefined;
    value += chunk;
  }
  return value;
}
