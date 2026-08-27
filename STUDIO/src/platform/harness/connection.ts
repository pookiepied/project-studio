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
 * Resolves the harness address, or `null` when there is none.
 *
 * Async because the Tauri branch awaits a command; the browser branch is
 * along for the signature.
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

  if (!import.meta.env.DEV) return null

  const rawBaseUrl: unknown = import.meta.env.VITE_HARNESS_BASE_URL
  const rawCredential: unknown = import.meta.env.VITE_HARNESS_TOKEN

  const configuredBaseUrl = envValue(rawBaseUrl)
  const credential = envValue(rawCredential)
  if (configuredBaseUrl === null || credential === null) return null

  const baseUrl = harnessBaseUrl(configuredBaseUrl)
  if (baseUrl === null) return null

  return { baseUrl, credential }
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
 * Outside Tauri there is no supervisor and nothing to ask, so the answer is
 * no: a browser's harness is started by hand and configured by env var.
 */
export async function startHarness(): Promise<boolean> {
  if (!isTauri()) return false
  try {
    const report = await invoke<{ readonly url?: unknown }>('restart_harness')
    return typeof report === 'object' && report !== null
  } catch {
    // The supervisor's own sentence is already on screen through
    // `get_harness_status`; a second one invented here would compete with it.
    return false
  }
}
