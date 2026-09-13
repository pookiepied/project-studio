import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { spawn } from "node:child_process";

import { registerOwnPort, unregisterOwnPort } from "../net/own-ports.js";
import type { StudioAuthConfig } from "./config.js";
import { isAbortError } from "./auth-client.js";
import { StudioAuthError } from "./errors.js";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Opens the system browser at the sign-in URL. Injectable for tests. */
export type BrowserOpener = (url: string) => void | Promise<void>;

export interface GoogleLoginOptions {
  readonly config: StudioAuthConfig;
  readonly fetchImpl?: FetchLike;
  readonly openBrowser?: BrowserOpener;
  /** Called with the URL so a caller can print it when the browser cannot open. */
  readonly onPrompt?: (url: string) => void;
  readonly signal?: AbortSignal;
}

const SCOPES = "openid email profile";

/**
 * Runs Google's authorization-code flow with PKCE and a loopback redirect.
 *
 * This is the flow Google prescribes for native applications. The harness is a
 * public client: it ships on the user's machine, so it holds no client secret,
 * and PKCE is what replaces one. The authorization code is bound to a verifier
 * that never leaves this process, so intercepting the redirect is not enough to
 * redeem the code.
 *
 * The redirect target is a short-lived server on 127.0.0.1 with an OS-assigned
 * port. Loopback redirects are exempt from Google's pre-registration rules
 * precisely because the port cannot be known in advance.
 *
 * Returns the Google ID token, which is then exchanged for a Studio session.
 * No Google token is persisted: the ID token is used once and discarded.
 */
export async function loginWithGoogle(
  options: GoogleLoginOptions,
): Promise<string> {
  const { config } = options;
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(randomBytes(16));

  const server = createServer();
  const redirectUri = await listenOnLoopback(server);

  try {
    const authorizeUrl = new URL(config.googleAuthorizeUrl);
    authorizeUrl.searchParams.set("client_id", config.googleClientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", SCOPES);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", state);
    // Without this Google may skip returning a fresh consent for a returning
    // user, which is fine, but being explicit keeps the flow predictable.
    authorizeUrl.searchParams.set("prompt", "select_account");

    // Listening starts before the browser is sent anywhere. Otherwise a
    // redirect that arrives quickly — which is exactly what happens when the
    // user already has a live Google session — reaches a server with no
    // handler attached and the flow deadlocks waiting for a request it has
    // already missed.
    const codePromise = awaitAuthorizationCode(server, state, options.signal);
    // Nothing is awaiting it yet; without this a failure before the await below
    // would surface as an unhandled rejection instead of the real error.
    codePromise.catch(() => {});

    const url = authorizeUrl.toString();
    options.onPrompt?.(url);
    await (options.openBrowser ?? openSystemBrowser)(url);

    const code = await codePromise;
    return await exchangeCodeForIdToken({
      code,
      verifier,
      redirectUri,
      config,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
    });
  } finally {
    // Unregistered before the close completes, and in a `finally`, because a
    // port left in the set outlives the listener and would refuse a destination
    // that is now somebody else's — the guard turning into a false accusation
    // instead of a defence.
    const address = server.address();
    if (address && typeof address !== "string") unregisterOwnPort(address.port);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

async function listenOnLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new StudioAuthError("internal", {
      message: "Could not open a local port to receive the sign-in redirect.",
    });
  }

  // This port receives an authorization code, so while it is open it is part of
  // our control plane rather than somewhere on the network. The destination
  // guard refuses a port we are listening on to every caller and whoever wrote
  // the address — and it can only do that for ports it has been told about.
  //
  // Nothing can reach it today, because `fetch` refuses every loopback address
  // whatever the port. That stops being true when the direct HTTP client makes
  // loopback reachable, and a registration added then would have been missing
  // for exactly as long as it mattered.
  registerOwnPort(address.port);

  return `http://127.0.0.1:${address.port}/callback`;
}

/**
 * Waits for Google to redirect the browser back to the loopback server.
 *
 * The `state` value is compared in constant time. It is the defence against a
 * different page on the user's machine posting to this port and injecting an
 * attacker's authorization code.
 */
function awaitAuthorizationCode(
  server: Server,
  expectedState: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const settle = (fn: () => void) => {
      server.removeListener("request", onRequest);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const onAbort = () => settle(() => reject(new StudioAuthError("aborted")));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    function onRequest(request: IncomingMessage, response: ServerResponse) {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname !== "/callback") {
        response.writeHead(404).end();
        return;
      }

      const error = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state") ?? "";

      if (!constantTimeEquals(state, expectedState)) {
        respond(response, "Sign-in could not be verified. You can close this window.");
        settle(() =>
          reject(
            new StudioAuthError("protocol", {
              message: "The sign-in redirect did not match the expected state value.",
            }),
          ),
        );
        return;
      }

      if (error !== null || code === null) {
        respond(response, "Sign-in was cancelled. You can close this window.");
        settle(() => reject(new StudioAuthError("aborted")));
        return;
      }

      respond(response, "Signed in to Project Studio. You can close this window.");
      settle(() => resolve(code));
    }

    server.on("request", onRequest);
  });
}

function respond(response: ServerResponse, message: string): void {
  const body = `<!doctype html><meta charset="utf-8"><title>Project Studio</title><body style="font:16px system-ui;padding:3rem">${message}</body>`;
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
}

function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface ExchangeOptions {
  readonly code: string;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly config: StudioAuthConfig;
  readonly fetchImpl?: FetchLike | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Redeems the authorization code. No client secret is sent: the PKCE verifier
 * is what proves this is the same client that started the flow.
 */
async function exchangeCodeForIdToken(options: ExchangeOptions): Promise<string> {
  const doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));

  const body = new URLSearchParams({
    client_id: options.config.googleClientId,
    code: options.code,
    code_verifier: options.verifier,
    grant_type: "authorization_code",
    redirect_uri: options.redirectUri,
  });

  let response: Response;
  try {
    response = await doFetch(options.config.googleTokenUrl, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) {
      throw new StudioAuthError("aborted");
    }
    throw new StudioAuthError("unavailable");
  }

  if (!response.ok) {
    // Google's error body describes the code and client; it is not surfaced.
    throw new StudioAuthError("protocol", {
      message: "Google rejected the sign-in request.",
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new StudioAuthError("protocol");
  }

  const idToken = (payload as { id_token?: unknown })?.id_token;
  if (typeof idToken !== "string" || idToken.length === 0) {
    throw new StudioAuthError("protocol");
  }
  return idToken;
}

/**
 * Best-effort browser launch. A failure here is not fatal: the URL has already
 * been offered through `onPrompt`, so the user can open it manually.
 */
function openSystemBrowser(url: string): void {
  const command =
    process.platform === "win32"
      ? { file: "cmd", args: ["/c", "start", "", url] }
      : process.platform === "darwin"
        ? { file: "open", args: [url] }
        : { file: "xdg-open", args: [url] };

  try {
    const child = spawn(command.file, command.args, {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Ignored deliberately; the caller prints the URL.
  }
}
