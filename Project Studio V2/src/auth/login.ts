import { KeyringCredentialStore } from "../credentials/keyring-store.js";
import type { SecureCredentialStore } from "../credentials/credential-store.js";
import { StudioAuthClient, type FetchLike, type StudioUser } from "./auth-client.js";
import { resolveStudioAuthConfig, type StudioAuthConfig } from "./config.js";
import { loginWithGoogle, type BrowserOpener } from "./google-login.js";
import { SessionStore } from "./session.js";

export interface SignInOptions {
  readonly config?: StudioAuthConfig;
  readonly credentials?: SecureCredentialStore;
  readonly fetchImpl?: FetchLike;
  readonly openBrowser?: BrowserOpener;
  readonly onPrompt?: (url: string) => void;
  readonly signal?: AbortSignal;
}

/**
 * Signs in and stores the resulting session.
 *
 * Two exchanges happen here and only the second produces anything durable:
 * Google proves who the person is and returns an ID token, then the Studio auth
 * service decides whether that person may use Studio and issues Studio's own
 * tokens. The Google ID token is used once and discarded — the harness stores
 * no Google credential.
 */
export async function signIn(options: SignInOptions = {}): Promise<StudioUser> {
  const config = options.config ?? resolveStudioAuthConfig();
  const credentials = options.credentials ?? new KeyringCredentialStore();
  const sessions = new SessionStore(credentials);
  const client = new StudioAuthClient(config, options.fetchImpl);

  const idToken = await loginWithGoogle({
    config,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.openBrowser === undefined ? {} : { openBrowser: options.openBrowser }),
    ...(options.onPrompt === undefined ? {} : { onPrompt: options.onPrompt }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  const { session, user } = await client.signInWithGoogle(idToken, options.signal);
  await sessions.save(session);

  return user;
}

/** Removes the stored session from this machine. */
export async function signOut(
  credentials: SecureCredentialStore = new KeyringCredentialStore(),
): Promise<void> {
  await new SessionStore(credentials).clear();
}

/** Whether a usable session is stored, without revealing any token. */
export async function isSignedIn(
  credentials: SecureCredentialStore = new KeyringCredentialStore(),
): Promise<boolean> {
  return (await new SessionStore(credentials).load()) !== null;
}
