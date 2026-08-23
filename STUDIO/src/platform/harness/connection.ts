/**
 * Where the harness is, and what proves we may talk to it.
 *
 * This is the ONLY place in STUDIO that decides the source of the harness
 * address and credential. Everything else -- the client, the panes that will
 * use it -- takes them as arguments. That is the point of the module: when the
 * Tauri sidecar task lands, it replaces the body of `resolveHarnessAddress`
 * and nothing else in the frontend changes.
 *
 * What that task will do, and why it is not done here: the harness is launched
 * by a host process that hands it a readiness frame on fd 3 (host, port,
 * clientId, sessionId) and a bootstrap credential on fd 4, using Node's
 * `stdio` array (`STUDIO HARNESS/src/host/harness-launcher.ts`). Windows has
 * no equivalent inherited-fd channel for a Rust parent, so that handoff needs
 * its own design and its own task. Until then the harness is started by hand
 * and its address is configuration.
 *
 * Today that configuration is two Vite env vars, read at build time and
 * inlined:
 *
 *   VITE_HARNESS_BASE_URL   e.g. http://127.0.0.1:4319
 *   VITE_HARNESS_TOKEN      the bearer credential that launch printed
 *
 * With neither set this returns `null` and the app runs exactly as it does
 * today, with no harness and no network calls at all. Callers must treat
 * `null` as the normal case, not an error.
 *
 * Two things this module must never become. It must never write either value
 * anywhere -- not the Tauri store, not localStorage -- because a credential
 * that outlives the launch that minted it is a credential someone can steal
 * from a plaintext file. And it must never log the token; the only thing worth
 * saying out loud is whether an address was found.
 *
 * A note on the env vars themselves: `import.meta.env` is inlined into the
 * bundle at build time, so `VITE_HARNESS_TOKEN` set during a production build
 * would be baked into a shipped artifact. It is a development affordance. The
 * `.env` file that carries it is gitignored, and `.env.example` documents both
 * names without any value.
 */

import type { HarnessAddress } from './client'

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
 * Resolves the harness address, or `null` when none is configured.
 *
 * Async because the sidecar implementation will be -- it will await a Tauri
 * command that starts the process and waits for its readiness frame. Making
 * the signature async now means the swap touches this function alone.
 */
export async function resolveHarnessAddress(): Promise<HarnessAddress | null> {
  const rawBaseUrl: unknown = import.meta.env.VITE_HARNESS_BASE_URL
  const rawCredential: unknown = import.meta.env.VITE_HARNESS_TOKEN

  const configuredBaseUrl = envValue(rawBaseUrl)
  const credential = envValue(rawCredential)
  if (configuredBaseUrl === null || credential === null) return null

  const baseUrl = harnessBaseUrl(configuredBaseUrl)
  if (baseUrl === null) return null

  return { baseUrl, credential }
}
