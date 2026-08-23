import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { isTauri } from '@/platform/tauri'

/**
 * How a harness request actually leaves the process.
 *
 * ---- Why this is not just `fetch` ------------------------------------------
 *
 * The harness serves no CORS headers. That is deliberate on its side and
 * should stay that way: it is a loopback service holding provider credentials,
 * and a service like that has no business being reachable by any origin a
 * browser is willing to preflight. An allow-list would not fix it either --
 * an allow-list is a config value, and config values get widened to `*` during
 * one debugging session and never narrowed again.
 *
 * But the packaged webview's origin is `http://tauri.localhost`, which is
 * cross-origin to a port on 127.0.0.1, so every browser `fetch` from the app
 * died at the preflight with "No 'Access-Control-Allow-Origin' header is
 * present". Task 16 confirmed this against a live harness and had to stand up
 * a same-origin proxy to get past it.
 *
 * A request issued from Rust has no origin, so there is no preflight and the
 * question stops existing. `@tauri-apps/plugin-http` is that: the JS call
 * marshals to the Rust side, reqwest makes the request, and the response comes
 * back. What it may reach is not decided here -- it is fixed in
 * `src-tauri/capabilities/default.json`, scoped to loopback and nothing else.
 * A URL outside that scope is refused by Rust, not by this module.
 *
 * This also puts the transport where the credential is about to live. When the
 * sidecar task lands, Rust will own the harness credential; Rust already
 * owning the transport is one less thing to move then.
 *
 * ---- Why the choice is made per request ------------------------------------
 *
 * Not at import time, and not once when a client is constructed. Two reasons.
 *
 * `isTauri()` reads `window.__TAURI_INTERNALS__`, which is injected by the
 * webview and is not guaranteed to be there the instant a module is evaluated.
 * A module-scope `const transport = isTauri() ? ... : ...` would bake in
 * whatever was true at import and be wrong forever after. The harness had this
 * exact bug in `net/own-ports.ts` and the fix was the same one: read on every
 * call.
 *
 * And `globalThis.fetch` is looked up per call rather than bound once, so a
 * test that replaces the global after a client exists still gets its stub.
 * Binding at construction would silently ignore it.
 *
 * The cost is two property reads per request, against a request that is about
 * to cross a process boundary.
 */

/**
 * Signature-compatible with `typeof globalThis.fetch` on purpose.
 *
 * The plugin's own signature is
 * `(input: URL | Request | string, init?: RequestInit & ClientOptions)`, which
 * accepts everything the standard one does -- the input union is the same set,
 * and every `ClientOptions` field is optional, so a plain `RequestInit` still
 * satisfies the intersection. That is what lets this drop into the client's
 * existing `fetch` seam with no widening of its type and no adapter.
 */
export const harnessTransport: typeof globalThis.fetch = (input, init) =>
  isTauri() ? tauriFetch(input, init) : globalThis.fetch(input, init)
