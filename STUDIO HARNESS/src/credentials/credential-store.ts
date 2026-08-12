/**
 * Secure credential storage for Project Studio.
 *
 * Two different kinds of secret share this store: the Studio session token used
 * to call the public API, and user-owned BYOK provider keys. Neither may ever
 * reach a log line, telemetry attribute, event, prompt, persisted conversation,
 * or a plaintext file on disk. There is deliberately no file-backed fallback:
 * if the platform store is unavailable, storage fails rather than silently
 * downgrading the user's security.
 */

import { StudioError } from "../contracts/errors.js";

export type CredentialErrorKind =
  /** The OS credential store is missing, locked, or refused access. */
  | "unavailable"
  /** The key or secret was rejected before it reached the platform. */
  | "invalid"
  /** The secret is larger than the platform can store. */
  | "too_large"
  /** The platform store failed for an unclassified reason. */
  | "internal";

const MESSAGE_BY_KIND: Record<CredentialErrorKind, string> = {
  unavailable:
    "The operating system credential store is unavailable, so the secret cannot be stored securely.",
  invalid: "The credential reference or secret is not valid.",
  too_large: "The secret is too large for the operating system credential store.",
  internal: "The operating system credential store failed unexpectedly.",
};

/**
 * Never carries the secret, the key, or the platform's own error text: platform
 * messages have been observed to echo the value being stored.
 */
export class CredentialStoreError extends StudioError {
  readonly domain = "credentials" as const;
  declare readonly kind: CredentialErrorKind;

  constructor(kind: CredentialErrorKind, options: { message?: string } = {}) {
    super(kind, options.message ?? MESSAGE_BY_KIND[kind], {
      // A locked keychain can be unlocked; a rejected key or an oversized
      // secret will be rejected identically forever.
      retryable: kind === "unavailable",
      // `cause` is deliberately not accepted: platform errors echo the value
      // being stored. See the class comment.
    });
    this.name = "CredentialStoreError";
  }
}

/**
 * What a stored secret belongs to.
 *
 * `session` holds the Studio access/refresh tokens. `provider` holds one BYOK
 * credential for one provider. `mcp` holds the one secret an MCP server needs
 * — a bearer token for a remote endpoint, or the value of an environment
 * variable a local server reads a key from. Keeping them in separate entries
 * rather than one serialized bundle is a platform requirement, not a
 * preference: see `MAX_SECRET_LENGTH`.
 *
 * `mcp` is a scope here rather than a column in `mcp_server` because that is
 * the whole keychain/database split: the row says a secret exists and what it
 * is called, and the store is the only thing that holds what it is.
 */
export const CREDENTIAL_SCOPES = ["session", "provider", "mcp"] as const;

export type CredentialScope = (typeof CREDENTIAL_SCOPES)[number];

export interface CredentialKey {
  readonly scope: CredentialScope;
  /** Stable identifier within the scope, e.g. `openai` or `studio`. */
  readonly id: string;
}

/**
 * Windows Credential Manager caps a credential blob at 2560 bytes, and the
 * value is stored as UTF-16, so the usable length is 1280 code units. This was
 * measured by binary search against the real store, not read from
 * documentation: the platform's own error text says "2560 chars", which is the
 * byte budget rather than a character count and is off by a factor of two.
 *
 * macOS and Linux allow more, but the tightest limit is enforced everywhere so
 * a credential that stores on one platform stores on all of them.
 *
 * The practical consequence: one entry holds one secret. Session access and
 * refresh tokens get separate entries, and credentials are never serialized
 * into a single JSON blob, which would exceed this almost immediately.
 */
export const MAX_SECRET_LENGTH = 1280;

/** Conservative bound; ids are product-generated, not user free text. */
const MAX_ID_LENGTH = 128;
const VALID_ID = /^[a-z0-9][a-z0-9._-]*$/i;

export interface SecureCredentialStore {
  /** Returns the secret, or `null` when nothing is stored for the key. */
  get(key: CredentialKey): Promise<string | null>;
  set(key: CredentialKey, secret: string): Promise<void>;
  /** Returns whether an entry existed. Deleting a missing entry is not an error. */
  delete(key: CredentialKey): Promise<boolean>;
}

export function assertValidKey(key: CredentialKey): CredentialKey {
  // Checked against the list the type is derived from, not against a second
  // spelling of it. `mcp` was added to the type and not to the pair of literals
  // that used to be here, so every store path refused it and the scope was
  // unusable — a type that said yes and a guard that said no. One list is what
  // stops that happening to the fourth scope.
  if (!(CREDENTIAL_SCOPES as readonly string[]).includes(key.scope)) {
    throw new CredentialStoreError("invalid", {
      message: `Credential scope must be one of: ${CREDENTIAL_SCOPES.join(", ")}.`,
    });
  }
  if (
    typeof key.id !== "string" ||
    key.id.length === 0 ||
    key.id.length > MAX_ID_LENGTH ||
    !VALID_ID.test(key.id)
  ) {
    throw new CredentialStoreError("invalid", {
      message:
        "Credential id must be 1-128 characters of letters, digits, dot, dash, or underscore.",
    });
  }
  return key;
}

export function assertValidSecret(secret: string): string {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new CredentialStoreError("invalid", {
      message: "The secret must be a non-empty string.",
    });
  }
  // `String.length` counts UTF-16 code units, which is exactly the unit the
  // platform budget is expressed in, so the check matches what is enforced.
  if (secret.length > MAX_SECRET_LENGTH) {
    throw new CredentialStoreError("too_large");
  }
  return secret;
}

/**
 * The account name used inside the platform store. Scope is part of the name so
 * a provider id can never collide with a session id.
 */
export function credentialAccount(key: CredentialKey): string {
  return `${key.scope}:${key.id}`;
}
