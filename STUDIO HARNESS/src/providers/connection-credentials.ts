import type { CredentialStatus } from "../contracts/providers.js";
import {
  assertValidKey,
  CredentialStoreError,
  type CredentialKey,
  type SecureCredentialStore,
} from "../credentials/credential-store.js";
import { readStoredProviderCredential } from "../models/local/credential-bridge.js";
import { customProviderEnvVar } from "../models/local/runtime.js";

/**
 * The credential seam: where a connection's key is, in exactly one vocabulary.
 *
 * Two keychain locations can hold a provider's key, and both are read, in a
 * fixed order, by every consumer:
 *
 * 1. `provider-connection:<connection id>` - the connection's own entry, a
 *    raw secret, where the settings surface writes a key the user types.
 * 2. `provider:<vendor id>` - the legacy local-BYOK location, Pi's chunked
 *    JSON, where keys landed before the two provider stores were unified.
 *    Reading it here is why a connection carried by migration 16 works with
 *    the same key and nothing retyped.
 *
 * 3. The vendor's environment variable, inherited by the process.
 *
 * The order is the recency of the user's own word: a key typed into the
 * dialog outranks an entry an older build wrote. Only `CredentialStatus`
 * crosses back to any UI; the secret itself is returned solely to the one
 * caller that presents it (a probe) or resolves a turn (Pi's credential
 * store) or fills an MCP server's environment (Task 40's seam).
 */

/** The keychain entry a connection's own key lives under. */
export function connectionCredentialKey(connectionId: string): CredentialKey {
  return assertValidKey({ scope: "provider-connection", id: connectionId });
}

/** The legacy keychain entry a vendor's key lives under. */
export function legacyProviderCredentialKey(vendorId: string): CredentialKey {
  return assertValidKey({ scope: "provider", id: vendorId });
}

/** The vendor a connection's credential belongs to: the catalog vendor, or itself. */
export function vendorIdOf(connection: {
  readonly id: string;
  readonly catalogProvider?: string | undefined;
}): string {
  return connection.catalogProvider ?? connection.id;
}

async function storedConnectionSecret(
  secrets: SecureCredentialStore,
  connectionId: string,
): Promise<string | null> {
  return secrets.get(connectionCredentialKey(connectionId));
}

async function storedLegacySecret(
  secrets: SecureCredentialStore,
  vendorId: string,
): Promise<string | undefined> {
  try {
    const credential = await readStoredProviderCredential(secrets, vendorId);
    return credential?.apiKey;
  } catch {
    // An id the bridge refuses to name is a keychain miss, not a failure to
    // surface: the resolution continues to the environment variable.
    return undefined;
  }
}

function envSecret(vendorId: string): string | undefined {
  const value = process.env[customProviderEnvVar(vendorId)];
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

/**
 * Whether a credential exists, without holding it longer than the answer takes.
 *
 * The legacy location also recognises OAuth credentials - a connection whose
 * vendor was logged in through Pi's interactive flow holds a refreshable
 * token there, and "set" is the honest status for it even though no raw key
 * can be presented to a probe.
 */
export async function connectionCredentialStatus(
  secrets: SecureCredentialStore,
  connection: { readonly id: string; readonly catalogProvider?: string | undefined },
): Promise<CredentialStatus> {
  let stored: string | null;
  try {
    stored = await storedConnectionSecret(secrets, connection.id);
  } catch {
    throw keychainRefused("status");
  }
  if (stored !== null) return "set";

  const vendorId = vendorIdOf(connection);
  try {
    const credential = await readStoredProviderCredential(secrets, vendorId);
    if (credential !== undefined) return "set";
  } catch {
    throw keychainRefused("status");
  }

  return envSecret(vendorId) === undefined ? "absent" : "from-env";
}

/**
 * The secret a presenting caller needs, or undefined when none resolves.
 *
 * Resolution mirrors `connectionCredentialStatus` - the connection's own
 * entry, then the legacy vendor entry (API keys only; an OAuth credential
 * cannot be presented as a bearer), then the environment - and the value goes
 * to an outbound header or a turn's auth resolution and nowhere else: not
 * into a record, a log line, or a result a route could serialize.
 */
export async function connectionCredentialSecret(
  secrets: SecureCredentialStore,
  connection: { readonly id: string; readonly catalogProvider?: string | undefined },
): Promise<string | undefined> {
  let stored: string | null;
  try {
    stored = await storedConnectionSecret(secrets, connection.id);
  } catch {
    throw keychainRefused("secret");
  }
  if (stored !== null && stored !== "") return stored;

  const vendorId = vendorIdOf(connection);
  const legacy = await storedLegacySecret(secrets, vendorId);
  if (legacy !== undefined && legacy !== "") return legacy;

  return envSecret(vendorId);
}

/**
 * Raised when the OS credential store itself refused, as opposed to answering
 * "nothing stored". A locked keychain misread as "no key" would present a
 * 401 the provider never issued; callers report this distinctly. The
 * credential store's own "unavailable" kind is reused so the failure taxonomy
 * gains no second name for the same thing.
 */
function keychainRefused(operation: "status" | "secret"): CredentialStoreError {
  return new CredentialStoreError("unavailable", {
    message:
      operation === "status"
        ? "The credential status could not be read from the secure store."
        : "The credential could not be read from the secure store.",
  });
}
