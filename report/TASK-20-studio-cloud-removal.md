# TASK 20 — Remove studio-cloud from the Harness

**Date:** 2026-08-24
**Scope:** `STUDIO HARNESS/` only. `STUDIO/` and `STUDIO (ON HOLD UI)/` untouched.
**Status:** Complete. `pnpm typecheck`, `pnpm build`, and the test suite all pass. Nothing committed — the working tree holds the changes (see "Handover notes").

---

## 1. Context

The Studio Cloud gateway was cancelled. Its Worker source was deleted in commit `bd4d389`, but that
deletion happened in a stale checkout; only new files were carried across, so the Harness kept the
*client*: an adapter, SSE parser, catalog, token plumbing, and tests for a service that does not
exist and will not be built. ADR 0031 already records that the contract was wrong. The reservation
of the name "gateway" for a possible future *user-hosted* source (prose in
`src/contracts/providers.ts`) stands untouched.

---

## 2. Files deleted (17)

### Source (11)

| Path | Role |
|---|---|
| `src/models/studio-cloud/access-token.ts` | `AccessTokenProvider` interface, env/static token providers, header-safety checks |
| `src/models/studio-cloud/catalog.ts` | `/v1/models` → `ModelDescriptor` normalization |
| `src/models/studio-cloud/client.ts` | Origin-scoped HTTPS transport, `FetchLike` |
| `src/models/studio-cloud/config.ts` | `resolveStudioGatewayConfig`, gateway env vars |
| `src/models/studio-cloud/errors.ts` | `StudioGatewayError`, the `"gateway"` error domain's only producer |
| `src/models/studio-cloud/event-mapper.ts` | Gateway events → Pi event protocol |
| `src/models/studio-cloud/request-mapper.ts` | Pi transcript/tools → gateway chat contract |
| `src/models/studio-cloud/sse-parser.ts` | SSE frame parser |
| `src/models/studio-cloud/stream-events.ts` | Gateway SSE wire vocabulary |
| `src/models/adapters/studio-cloud-adapter.ts` | `StudioCloudModelProviderAdapter` |
| `src/auth/session-token-provider.ts` | `SessionAccessTokenProvider` (see §5) |

### Tests (4 files, deleted wholesale)

| Path | Why |
|---|---|
| `tests/integration/studio-gateway.test.ts` | Every test targeted the adapter/gateway |
| `tests/integration/studio-flue.test.ts` | Existed solely to prove the studio-cloud source through a real spawned Flue server |
| `tests/unit/sse-parser.test.ts` | Tested the deleted SSE parser |
| `tests/unit/event-mapper.test.ts` | Tested the deleted event mapper |

---

## 3. Files edited (11)

| File | Change |
|---|---|
| `src/contracts/models.ts` | Removed `"studio-cloud"` from `modelSourceSchema` (`ModelSource` is now `"local" \| "test"`) |
| `src/contracts/errors.ts` | Removed the `"gateway"` member from `StudioErrorDomain` (judgment call — see §7, doubt #1) |
| `src/models/provider-config.ts` | Dropped the studio-cloud doc bullet; error message now "Expected one of: test, local." |
| `src/models/bootstrap.ts` | Removed `StudioCloudBootstrapOverrides`, the `studioCloud` bootstrap option, the adapter factory, `GatewayAuthMode` / `resolveGatewayAuthMode`, `createConfiguredAccessTokenProvider`, and all studio-cloud/auth imports. Replaced the pre-existing `source as string` cast with `String(source)` |
| `src/app.ts` | Removed the studio-cloud auth-mode log block and the `resolveGatewayAuthMode` import |
| `tests/unit/errors.test.ts` | Removed import; edited the taxonomy enumeration test; deleted 3 gateway-only tests |
| `tests/unit/architecture.test.ts` | Deleted 3 studio-cloud-only architecture tests; trimmed `studio-cloud-adapter` from the agent-purity regex; edited the domain-reachability test |
| `tests/unit/model-providers.test.ts` | Edited "recognizes test and local"; deleted 2 studio-cloud tests |
| `tests/integration/auth-login.test.ts` | Deleted the "session access token provider" describe (8 tests) and its imports; stripped the mock auth service's `/refresh` endpoint and refresh tracking (no remaining test exercises it) |
| `README.md` | Removed the code-map, test-map, feature-list, and settings-table entries for studio-cloud; removed the four "Studio Gateway *" sections; added a short historical blockquote explaining the cancellation and what remains |
| `.env.example` | Removed `PROJECT_STUDIO_GATEWAY_*` variables and the studio-cloud source comment; sign-in section kept |

`src/contracts/providers.ts` (`ProviderSource`) was **not touched** — see §4.

---

## 4. Only-for-studio-cloud vs general, per referencing file

| File | Call | Reasoning |
|---|---|---|
| `src/contracts/models.ts` | **General** | `ModelSource` is the source-selection contract generally; only the studio-cloud member was removed |
| `src/contracts/providers.ts` | **Untouched** | `ProviderSource` is `"local" \| "test"` with "gateway" reserved in prose only. It never contained studio-cloud. The task's stop condition ("provider contract must not change") was never triggered |
| `src/contracts/errors.ts` | **General** | Removed only the `"gateway"` domain member. Every other domain in the union has a live producer, and `architecture.test.ts` enforces "every declared domain reachable from a real error class" — keeping a dead member would silently violate the codebase's own invariant |
| `src/models/provider-config.ts` | **General** | Source resolution generally; studio-cloud bullet/message removed |
| `src/models/bootstrap.ts` | **General** | Coordinator serves test/local; only the studio-cloud branch and its exclusive helpers removed |
| `src/app.ts` | **General** | Composition root; removed the studio-cloud log block only |
| `src/auth/*` (login, session, auth-client, cli, google-login, config, errors) | **General — kept entirely** | The sign-in flow is a live harness surface (`pnpm auth sign-in/status/sign-out` in package.json), distinct from the model gateway. `SessionStore` is load-bearing for `login.ts` |
| `src/net/own-ports.ts` | **General** | Its auth reference is to `google-login.ts`, which stays |

**Finding on source values:** studio-cloud's source value lived in `ModelSource`
(`contracts/models.ts`), *not* in `ProviderSource`. The two contracts were already cleanly
separated, so no provider-contract change was needed — consistent with the task's expectation.

---

## 5. What happened to `session-token-provider.ts` — deleted

- Its **only production consumer** was `createStudioCloudAdapter` inside `bootstrap.ts` (via
  `createConfiguredAccessTokenProvider`).
- Checked the alternatives the task named: the local/BYOK path builds `KeyringCredentialStore` →
  `PiCredentialStore` (the credential bridge) directly; provider connections, retrieval settings,
  and MCP servers all use `KeyringCredentialStore` directly. **Nothing local reads it.** Not
  load-bearing → deleted, with its 8 tests.

**Deliberate leftovers inside the retained auth flow (flagged, not removed):**
`StudioAuthClient.refresh` and the `needsRefresh` / `accessTokenExpiryMs` / `assertSession`
helpers in `src/auth/session.ts` now have **no caller in `src/`**. They were kept because they
belong to the sign-in feature (which stays), not to the gateway client. If the sign-in flow's
session-renewal surface is not wanted, prune them in a follow-up (see §7, doubt #2).

---

## 6. Migrations and stored data

- **No migration added — none needed.** All 13 migrations concern provider settings, permissions,
  trust, extensions, MCP servers, and the model catalog. No table, column, or persisted record
  exists for studio-cloud. `assertNoSecretColumns` is untouched and still enforced inside every
  migration transaction and on every database open.
- **Stored data:** a signed-in Project Studio session (two OS-keychain entries: service
  "Project Studio", scope `session`, ids `studio-access` / `studio-refresh`) may exist on a user's
  machine. **Chosen: leave it.** The sign-in flow that owns it remains live, and
  `pnpm auth sign-out` removes it cleanly. `PROJECT_STUDIO_GATEWAY_TOKEN` (dev env var) is simply
  ignored from now on and documented nowhere.
- `data/` dev databases (`flue.db`, `studio.db`) were not touched; `dist/` was rebuilt.

---

## 7. Doubts and follow-ups

### Judgment calls a dev may want to revisit

1. **The `"gateway"` error domain was removed** from `StudioErrorDomain` in
   `src/contracts/errors.ts`. Rationale: the union otherwise contains only domains with live
   producers, and the architecture test enforces exactly that invariant, so keeping a dead member
   would make that test's name a lie. Counter-argument: if "gateway" should stay *reserved* for a
   future user-hosted gateway (the way `ProviderSource` reserves it in prose), re-add the union
   member and accept the declared-but-unreachable state, or also relax the test. One-line either
   way. The `ProviderSource` reservation itself was not touched.
2. **`StudioAuthClient.refresh` + session expiry helpers are now caller-less** (see §5). Keep
   (auth feature surface, likely wanted when the desktop app drives sign-in) or prune (dead code
   today). Needs a decision, not urgent.
3. **The sign-in flow's purpose going forward.** The cloud is cancelled, yet `pnpm auth` (Google
   PKCE → Project Studio session) remains a first-class surface whose only *consumer* of tokens was
   the deleted gateway client. `auth/cli.ts` says "The desktop app will later drive the same flow."
   If the account system itself is cancelled too, the whole of `src/auth/` plus the stored keychain
   sessions become dead surface — that is a product decision above this task's pay grade, so
   everything was left working.

### Needs attention

4. **Uncommitted changes.** Git operations (commit etc.) were forbidden by the task rules. The
   working tree holds: 11 modified files, 17 deletions (all inside `STUDIO HARNESS/`). Review and
   commit.
5. **Pre-existing, environmental test failures on this machine — not caused by this task.**
   `tests/desktop-host.ts` refuses to guess between two sibling Host directories
   (`STUDIO/` and `STUDIO (ON HOLD UI)/` both contain `src-tauri/src/harness/`), so
   `tests/unit/harness-environment-parity.test.ts` and one other file fail **at load** on every run,
   before and after. Fix by naming the shipping Host in the resolver. Until then a fully green local
   suite is impossible on a machine with both checkouts.
6. **Baseline discrepancy.** The task stated 1330 passing / 87 files; this machine's baseline was
   1320 / 88 with the 2 environmental load-failures above (≈10 tests never ran in either run). The
   like-for-like delta is exactly the 58 deliberately deleted tests. Worth reconciling if the stated
   numbers came from a different checkout state.

### Later / cosmetic

7. **ADR 0006 ("Studio Gateway integration") and ADR 0002 ("Two-gateway model") still describe the
   cancelled direction** and remain linked from the Harness README's decision index. Historical
   records may stay, but a "superseded" status note (the way ADR 0031 amended them) would help
   future readers.
8. **`AUDIT-2026-08-18.md`** (inside `STUDIO HARNESS/`) still cites
   `models/studio-cloud/errors.ts:71`. It is a dated audit snapshot — left as history.
9. The README now carries a short blockquote documenting the cancellation and pointing at `bd4d389`
   and ADR 0031 — the permitted "citation that explains history."

---

## 8. Test counts and the full list of deleted tests

**Before: 1320 passed / 25 skipped, 88 files. After: 1262 passed / 25 skipped, 84 files.**
Delta: **−58 passing tests**, every one deliberately deleted:

**`tests/integration/studio-gateway.test.ts` (24)**
1. bootstraps the authenticated studio source and resolves the stable alias
2. rejects unsafe base URL configuration before anything is registered
3. accepts an https gateway and normalizes the base URL
4. requires an explicit default model rather than inventing one
5. rejects an unusable timeout
6. rejects a default model that is absent from the loaded catalog
7. normalizes /v1/models into descriptors and capabilities
8. resolves the alias before the catalog is loaded
9. rejects a reference for another source or provider
10. surfaces a gateway failure as a typed error without the upstream body
11. streams text and reasoning without duplicating compatibility events
12. emits compatibility-only output when the gateway sends no canonical twin
13. preserves every tool call, its id, and its order
14. preserves usage and the finish reason
15. turns a terminal stream error into a safe typed Pi error
16. turns an HTTP failure into a safe typed Pi error
17. closes the upstream stream when the caller cancels
18. sends the transcript, tools, and tool results the gateway needs to continue
19. sends the token only to the configured gateway origin
20. keeps the token out of descriptors, errors, and stream events
21. rejects a token that is not a valid Authorization header value
22. does not truncate a healthy generation that streams longer than the timeout
23. still fails as a timeout when the gateway never sends headers
24. reaches loadCatalog through the configured registry

**`tests/unit/sse-parser.test.ts` (11)** — keeps the event name with its data · joins multi-line
data with newlines · ignores comment lines · drops a block with no data (keep-alive) · reads whole
frames · joins a frame split anywhere in the middle · keeps a CRLF frame whole when the chunk ends
on the carriage return · survives a CRLF cut at every position · reads a stream using lone carriage
returns · discards a truncated trailing frame · handles a multi-byte character split across chunks

**`tests/unit/event-mapper.test.ts` (5)** — closes an open text block when the stream fails ·
closes an open thinking block when the stream is aborted · keeps the partial text in the message it
failed with · does not close a block twice when a completed turn reports an error · emits nothing
more after it has settled

**`tests/integration/studio-flue.test.ts` (2)** — runs a full tool-continuation turn against the
mock gateway · closes the upstream request when the run is cancelled

**`tests/integration/auth-login.test.ts` (8)** — the entire "session access token provider"
describe: returns the stored token while it is still valid · refuses to produce a token when signed
out · renews an expiring token and stores the rotated refresh token · performs only one refresh for
concurrent callers · lets one caller cancel without failing the others · cancels the caller who
asked, not the refresh itself · clears the session when the refresh token is rejected · keeps the
session when a refresh fails for a transient reason

**`tests/unit/errors.test.ts` (3)** — keeps the gateway out of the models domain · marks only
transient gateway failures as retryable · keeps the gateway's transport detail out of the reported
shape

**`tests/unit/architecture.test.ts` (3)** — does not create a studio-cloud adapter without
validated configuration · does not leak the gateway's Vercel AI SDK types into the harness · keeps
the gateway wire vocabulary independent of the Pi protocol

**`tests/unit/model-providers.test.ts` (2)** — fails clearly for studio-cloud when it is not
configured · fails clearly when studio-cloud is selected without configuration

Edited in place (not deleted): "recognizes test and local" (model-providers), both domain-taxonomy
enumeration tests (errors, architecture), and the agent-purity regex lost its
`studio-cloud-adapter` alternative. No hollowed-out or placeholder tests remain.

---

## 9. Verification output (exact)

```
$ pnpm typecheck
> tsc --noEmit
(no output — clean)

$ pnpm test        # = pnpm build && vitest run
Test Files  2 failed | 81 passed | 1 skipped (84)
     Tests  1262 passed | 25 skipped (1287)
# the 2 failures are the pre-existing desktop-host resolver issue (§7.5),
# identical before and after this change; both fail at file load, so their
# tests are not part of either run's counts

$ pnpm build
done built dist\server.mjs
done ready dist
(exit 0)
```

Final grep over `src/` and `tests/` for `studio-cloud`, `studioCloud`, `StudioCloud`:

```
(no matches — exit 1)
```

Only two mentions remain in the whole tree (excluding node_modules/dist/data), both historical
prose: `AUDIT-2026-08-18.md` (dated audit snapshot) and the explanatory blockquote in `README.md`.

---

## 10. Compliance notes

- No `git checkout` / `switch` / `stash` / `reset` / `clean` / `commit` / `rebase` was run.
- `STUDIO/` and `STUDIO (ON HOLD UI)/` untouched.
- No `any`, no `as`, no non-null `!` introduced (one pre-existing `as` in `bootstrap.ts` was
  replaced with `String(...)`).
- All edited files verified UTF-8 without BOM.
- No green placeholder tests; studio-cloud tests were deleted, not hollowed.
- No migrations rewritten; none needed.
- Stop conditions never triggered: no live-and-wanted feature broke (sign-in flow intact and
  passing), and neither `ProviderSource` nor the provider contract changed.
