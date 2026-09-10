/**
 * Where the harness is, and what proves we may talk to it.
 *
 * This is the ONLY place in STUDIO that decides the source of the harness
 * address and credential. Everything else — the client, the panes that will
 * use it — takes them as arguments. That is the point of the module: the
 * Tauri supervisor landed (tasks 15-19), and this body now asks Rust where
 * the harness is instead of reading configuration.
 *
 * ---- Inside Tauri ----------------------------------------------------------
 *
 * The supervisor in `src-tauri/src/harness/` owns the harness process, and
 * `get_harness_status` reports whether it is running and where. That is the
 * address. The credential is NOT here and cannot be: no Tauri command returns
 * it any more, because the transport (`service_fetch`, via `transport.ts`)
 * attaches it in Rust. The `credential` field the client's interface requires
 * is filled with `HOST_ATTACHED_CREDENTIAL` — a marker, not a token. It
 * rides in the client's `Authorization` header only until `service_fetch`
 * replaces that header with the real bearer; if the marker ever reached a
 * harness by mistake it would be refused as an unknown credential, which is
 * the safe direction to fail.
 *
 * `null` when the supervisor is not running (still starting, failed,
 * stopped): callers treat that as the normal no-harness case and the pane
 * falls back to the built-in catalog. A status the command cannot answer is
 * the same thing rather than an error — there is no address to use either
 * way, and the hook that calls this has no error state for it to become.
 *
 * The base URL inside Tauri is advisory. It builds the URLs the client hands
 * to the transport, and the transport reduces them to paths; Rust re-resolves
 * the address on every request, so if the harness restarted since this
 * resolved, the next request still goes to the live one.
 *
 * ---- Outside Tauri ---------------------------------------------------------
 *
 * A browser has no supervisor, so a harness started by hand is configuration:
 * two Vite env vars, read only where `import.meta.env.DEV` is true —
 * `vite dev`, and vitest. The gate is load-bearing: `import.meta.env` is
 * inlined at build time, so a reference that survived into a production
 * build would bake the value into the shipped bundle. The gate makes the
 * read dead code in every build, which is what keeps that from happening
 * whatever `.env` happens to contain on the machine that runs `pnpm build`.
 * See `.env.example`.
 *
 *   VITE_HARNESS_BASE_URL   e.g. http://127.0.0.1:4319
 *   VITE_HARNESS_TOKEN      the bearer credential that launch printed
 *
 * With neither set this returns `null` and the app runs with no harness and
 * no network calls at all. Callers must treat `null` as the normal case, not
 * an error.
 *
 * ---- A browser Studio itself served ----------------------------------------
 *
 * There is a third way a browser meets this bundle: Studio's own listener
 * (ADR 0050) serves the built frontend to paired devices, from the same
 * origin the page runs on. That page has no env vars and no supervisor — what
 * it has is the listener, and the listener answers `GET /api/pairing/state`
 * on its origin and nowhere else. A 200 from that route is identity, not
 * data: only the listener serves the path, so an answer says this page was
 * served by Studio. The address is then this page's own origin — an empty
 * base URL, which `join` turns into the relative paths the conversation
 * client already uses in a browser — and the credential is the same
 * host-attached marker as inside Tauri, because the proxy in Rust replaces it
 * with the per-launch bearer on the way through, exactly as `service_fetch`
 * does.
 *
 * The listener does not stop at the address. The supervisor's own answers —
 * whether the harness is running, and a restart — are served by this process
 * on the same origin, to any request the pairing gate admits, so a paired
 * browser can read a down harness and start it again the way the desktop
 * window does through its commands. `httpHarnessStatus`, `startHarness` and
 * `harnessFailureReason` below use that, and only ever from a page the
 * listener served: a dev-configured browser keeps its env-var arrangement,
 * where the harness has no status route to answer.
 *
 * Two things this module must never become. It must never write either value
 * anywhere — not the Tauri store, not localStorage — because a credential
 * that outlives the launch that minted it is a credential someone can steal
 * from a plaintext file. And it must never log the token; the only thing worth
 * saying out loud is whether an address was found.
 */

import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/platform/tauri'
import type { HarnessAddress } from './client'

/**
 * What `get_harness_status` reports. Only the fields read here are typed;
 * the command also returns identity fields (pid, clientId, sessionId) that
 * nothing on this side has a use for.
 */
interface HarnessStatusReport {
  readonly state: string
  readonly endpoint: { readonly url: string } | null
  /** Present exactly when `state` is `failed`, redacted at its source. */
  readonly error?: string | null
}

/**
 * Stands in the `credential` field inside Tauri, where the real bearer never
 * reaches JS at all. Rust attaches it in `service_fetch`, overwriting the
 * `Authorization` the client built from this marker.
 */
const HOST_ATTACHED_CREDENTIAL = 'host-attached'

/**
 * Reads one Vite env var as `unknown`.
 *
 * `import.meta.env` is typed loosely by `vite/client`; funnelling every read
 * through a single `unknown` return means nothing downstream inherits that
 * looseness and every value is checked before use.
 */
function envValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * An http(s) origin, with any trailing slash removed.
 *
 * Anything else is refused rather than repaired. A base URL that is not a URL
 * is a configuration mistake, and a client that silently prepends a scheme to
 * it would send the credential somewhere the author did not name.
 */
function harnessBaseUrl(value: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return value.replace(/\/+$/, '')
}

/**
 * Asks this page's own origin whether the request carrying its cookies is
 * paired with Studio.
 *
 * `true` or `false` when Studio's listener answered; `null` when nothing
 * answered with the listener's one shape — a different host (`vite dev`, a
 * static server) 404s the route or refuses the request, and `null` is how
 * this module says "nobody here is Studio's listener". Only Studio's listener
 * serves the path, so an answer is identity, not data; the pairing screen and
 * the address resolution below both read the same route for that reason, and
 * each at its own moment rather than through a shared cache that could drift
 * from the truth by one pairing.
 */
export async function readPairingState(): Promise<boolean | null> {
  let response: Response
  try {
    response = await fetch('/api/pairing/state')
  } catch {
    return null
  }
  if (!response.ok) return null

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const paired: unknown = (body as { paired?: unknown }).paired
  return typeof paired === 'boolean' ? paired : null
}

/**
 * Resolves the harness address, or `null` when there is none.
 *
 * Async because the Tauri branch awaits a command; the browser branches each
 * await an answer of their own.
 */
export async function resolveHarnessAddress(): Promise<HarnessAddress | null> {
  if (isTauri()) {
    let report: HarnessStatusReport
    try {
      report = await invoke<HarnessStatusReport>('get_harness_status')
    } catch {
      // A status that cannot be answered is not an address.
      return null
    }
    if (report.state !== 'running' || report.endpoint === null) return null

    const baseUrl = harnessBaseUrl(report.endpoint.url)
    return baseUrl === null ? null : { baseUrl, credential: HOST_ATTACHED_CREDENTIAL }
  }

  // A harness started by hand is configuration, and stays a dev-only read:
  // `import.meta.env` is inlined at build time, so the gate is what keeps the
  // read dead code in every shipped bundle.
  if (import.meta.env.DEV) {
    const rawBaseUrl: unknown = import.meta.env.VITE_HARNESS_BASE_URL
    const rawCredential: unknown = import.meta.env.VITE_HARNESS_TOKEN

    const configuredBaseUrl = envValue(rawBaseUrl)
    const credential = envValue(rawCredential)
    if (configuredBaseUrl !== null && credential !== null) {
      const baseUrl = harnessBaseUrl(configuredBaseUrl)
      if (baseUrl !== null) return { baseUrl, credential }
    }
  }

  // Then the listener-served case: the same route the pairing gate reads.
  // Whether the answer says paired or not, the page came from Studio and the
  // address is its own origin — while it is unpaired the app is behind the
  // pairing gate and never mounts the provider stack that would use it.
  if ((await readPairingState()) !== null) {
    return { baseUrl: '', credential: HOST_ATTACHED_CREDENTIAL }
  }

  return null
}

/**
 * Reads the harness status over HTTP, the way a listener-served page sees it.
 *
 * The route is the proxy's own, answered by the desktop process before the
 * forwarding: `GET /api/harness/status` reports the same shape the Tauri
 * command does, without the pairing gate ever being crossed. `null` when
 * nothing answered with that answer — a page not served by Studio has no
 * such route, and a 404 or a refused request is the same absence as the
 * Tauri command failing: no status is not an address, and here it is not a
 * harness either.
 */
export async function httpHarnessStatus(): Promise<HarnessStatusReport | null> {
  let response: Response
  try {
    response = await fetch('/api/harness/status')
  } catch {
    return null
  }
  if (!response.ok) return null

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  if (typeof (body as { state?: unknown }).state !== 'string') return null
  return body as HarnessStatusReport
}

/**
 * Asks the supervisor to start the harness, and says whether it came up.
 *
 * This exists because the app had no way to say it. `restart_harness` has been
 * a Tauri command since the supervisor landed, and nothing in the webview had
 * ever called it — so a harness that failed to start, or died mid-session, was
 * unrecoverable without quitting the app, while the refusal notice told people
 * to start it "from the status bar", a control that was never built. A sentence
 * naming a remedy the software does not offer is worse than no sentence.
 *
 * It belongs in this module for the same reason resolving the address does:
 * this is the one place that talks to the supervisor. The credential is not
 * involved and never crosses — the command answers with the endpoint view,
 * which carries no bearer, and this reduces it to a yes or a no.
 *
 * When the answer is no, the reason is not invented here and not lost either:
 * the supervisor keeps the sentence it failed with (redacted at its source)
 * and answers it again through `harnessFailureReason`. A start that was
 * refused and a start that never happened are different screens, and the
 * difference is that sentence.
 *
 * A browser asks the process that served it — the same route, answered by the
 * listener rather than proxied, and admitted by the same pairing gate whose
 * cookie this page already carries. A page with no Studio behind it gets a
 * 404 or a refusal, which is the same "no" as no supervisor: a harness
 * started by hand is started by hand.
 */
export async function startHarness(): Promise<boolean> {
  if (!isTauri()) {
    try {
      const response = await fetch('/api/harness/restart', { method: 'POST' })
      return response.ok
    } catch {
      return false
    }
  }
  try {
    const report = await invoke<{ readonly url?: unknown }>('restart_harness')
    return typeof report === 'object' && report !== null
  } catch {
    // The sentence stays with the supervisor, which `harnessFailureReason`
    // reads; nothing is added to it here because nothing is known here.
    return false
  }
}

/**
 * The supervisor's own sentence for why the harness is not running, if it
 * keeps one.
 *
 * A failed start used to be invisible. The status command has always carried
 * the reason — an eager start fails before any window exists, so the
 * supervisor was built to hold the sentence for whoever asks later — but no
 * surface ever asked, and the state a start refusal left on screen was
 * identical to the state of never having tried. This is the ask.
 *
 * `null` when there is nothing to say: the harness is running, coming up, or
 * was stopped on purpose — an absence with no failure behind it, which is the
 * normal case and reads as one. A listener-served browser asks the same
 * supervisor over HTTP; a page with no Studio behind it has nothing holding
 * a sentence, so the answer is `null` there too, and the remedy remains
 * configuration rather than a start.
 */
export async function harnessFailureReason(): Promise<string | null> {
  if (!isTauri()) {
    const report = await httpHarnessStatus()
    if (report === null || report.state !== 'failed') return null
    return report.error ?? null
  }
  let report: HarnessStatusReport
  try {
    report = await invoke<HarnessStatusReport>('get_harness_status')
  } catch {
    return null
  }
  if (report.state !== 'failed') return null
  return report.error ?? null
}
