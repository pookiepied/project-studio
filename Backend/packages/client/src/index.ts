/**
 * What a client — browser, desktop build, script — needs to join the umbrella.
 * No dependency on any worker's internals: only the auth worker's HTTP surface
 * and the telemetry ingest contract.
 */

export interface UmbrellaConfig {
  authOrigin: string;
  telemetryOrigin?: string;
}

/* ── Browser ─────────────────────────────────────────────────────────────── */

/**
 * Send the browser to Google. The session comes back as a `__Host-session`
 * cookie, which JavaScript cannot read — that is deliberate. Call authenticated
 * endpoints with `credentials: "include"` and never handle the token yourself.
 */
export function beginWebLogin(cfg: UmbrellaConfig): void {
  window.location.href = `${cfg.authOrigin}/oauth/start?mode=web`;
}

export async function logout(cfg: UmbrellaConfig): Promise<void> {
  await fetch(`${cfg.authOrigin}/oauth/logout`, { method: "POST", credentials: "include" });
}

/* ── Desktop (RFC 8252 loopback) ─────────────────────────────────────────── */

function b64url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The URL to open in the *system* browser — not an embedded webview, which
 * would defeat the point by letting the app see the user's Google credentials.
 * Listen on `port`; the auth worker redirects back with `?code=`.
 *
 * Keep the returned `verifier` in memory until the exchange. It is what proves
 * the code came back to the process that asked for it: the code itself arrives
 * over a loopback URL that any other local process could race for, and without
 * the verifier, holding it would be enough.
 */
export async function beginDesktopLogin(
  cfg: UmbrellaConfig,
  port: number,
): Promise<{ url: string; verifier: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const params = new URLSearchParams({
    mode: "desktop",
    redirect: `http://127.0.0.1:${port}/`,
    challenge: b64url(digest),
  });
  return { url: `${cfg.authOrigin}/oauth/start?${params}`, verifier };
}

/**
 * Trade the one-time code for a session token. Store the result in the OS
 * keychain (Tauri: stronghold or keyring) — never in a plain file, never in
 * localStorage.
 */
export async function exchangeDesktopCode(
  cfg: UmbrellaConfig,
  code: string,
  verifier: string,
): Promise<{ token: string; expiresAt: number }> {
  const res = await fetch(`${cfg.authOrigin}/oauth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, verifier }),
  });
  if (!res.ok) throw new Error(`exchange failed: ${res.status}`);
  const body = (await res.json()) as { token: string; expires_at: number };
  return { token: body.token, expiresAt: body.expires_at };
}

/* ── Calling umbrella APIs ───────────────────────────────────────────────── */

export function createApiClient(baseUrl: string, getToken?: () => string | null) {
  return async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const token = getToken?.();
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      // Browsers carry the cookie; desktop carries the bearer. Both work.
      credentials: token ? "omit" : "include",
    });
  };
}

/* ── Telemetry ───────────────────────────────────────────────────────────── */

export interface TelemetryOptions {
  origin: string;
  /** Per-source write key. In a desktop app this is not a secret from the user
   *  who holds it — it authenticates the source, it does not authorise reads. */
  writeKey: string;
  source?: string;
  flushIntervalMs?: number;
  maxBatch?: number;
}

/** Batches events and posts them to the telemetry worker. Failures are dropped,
 *  never retried into a loop, and never surfaced to the caller: telemetry must
 *  not be able to break the thing it is observing. */
export function createTelemetry(opts: TelemetryOptions) {
  const queue: Record<string, unknown>[] = [];
  const max = opts.maxBatch ?? 50;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush(): Promise<void> {
    if (queue.length === 0) return;
    const batch = queue.splice(0, max);
    try {
      await fetch(`${opts.origin}/v1/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${opts.writeKey}`,
        },
        body: JSON.stringify(batch),
      });
    } catch {
      /* dropped on purpose */
    }
  }

  return {
    track(evt: string, fields: Record<string, unknown> = {}): void {
      queue.push({ evt, ...fields });
      if (queue.length >= max) {
        void flush();
        return;
      }
      timer ??= setTimeout(() => {
        timer = null;
        void flush();
      }, opts.flushIntervalMs ?? 5000);
    },
    flush,
  };
}
