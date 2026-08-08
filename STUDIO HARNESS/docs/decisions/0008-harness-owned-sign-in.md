# ADR 0008: Harness-Owned Sign-In

Status: Accepted

## Context

Until now the harness authenticated to the Studio gateway with
`PROJECT_STUDIO_GATEWAY_TOKEN`, a development-only environment variable. A real
user session was needed before the gateway source could be used by anyone other
than a developer.

Project Studio already owns an authentication service: the `auth` worker signs
in with Google and issues Studio access and refresh JWTs, and the public `api`
worker verifies them. Nothing new had to be invented; the question was only who
runs the login flow for a local harness.

Two options were considered. The desktop app could own login and hand a token
to the harness, which keeps the harness simple but makes nothing testable until
the desktop integration exists. Or the harness could own login, which works
headless and from a terminal today. The harness-owned flow was chosen; the
desktop app will drive the same flow rather than reimplementing it.

Storage was built first (ADR 0007). A session token is itself a credential, so
wiring login first would have required a temporary plaintext step.

## Decision

### PKCE with a loopback redirect, and a separate Google client

The harness is a **public client**: it ships on the user's machine and can keep
no secret. It therefore uses Google's authorization-code flow with PKCE and a
loopback redirect, which is the flow Google prescribes for native applications.

This requires a second Google OAuth client of type "Desktop app", distinct from
the web client. Reusing the web client was rejected: exchanging its codes
requires a client secret, which would have to be embedded in software running on
the user's machine.

The auth worker's audience check therefore accepts a list rather than a single
id — `GOOGLE_CLIENT_ID` plus an optional `GOOGLE_DESKTOP_CLIENT_ID`. Only client
ids configured on the worker are accepted, so tokens are still pinned to Project
Studio's own OAuth clients. Leaving `GOOGLE_DESKTOP_CLIENT_ID` unset simply
means desktop sign-in is not enabled for that deployment.

The redirect target is a short-lived server on `127.0.0.1` with an OS-assigned
port. The `state` parameter is compared in constant time; it is the defence
against another local process posting an attacker's authorization code to that
port.

### Two exchanges, one stored result

Google proves who the person is and returns an ID token. The Studio auth service
then decides whether that person may use Studio and issues Studio's own tokens.
Only the Studio session is stored — the Google ID token is used once and
discarded, and the harness holds no Google credential.

### Refresh is single-flight

`SessionAccessTokenProvider` implements the same `AccessTokenProvider` interface
the gateway adapter already consumed, so the adapter is unchanged and still
cannot tell where its token came from.

The provider renews a token shortly before expiry, using the `exp` claim read
from the JWT without verifying its signature — the harness is the token's
holder, not its verifier, and a token whose expiry cannot be read is treated as
expired rather than trusted.

Concurrent refreshes are collapsed into one in-flight attempt. This is not an
optimization: the auth service **rotates** refresh tokens, so a second
concurrent exchange would be redeeming a token the first had already
invalidated, and the user would be signed out by their own parallel model calls.

When a refresh is rejected as expired or not permitted, the session is cleared,
because keeping it would make every later call fail identically. A transient
failure such as a 503 leaves the session intact.

### The development token remains, but is visible

`PROJECT_STUDIO_GATEWAY_TOKEN` still works and still takes precedence, since
setting it is a deliberate act. The active mode is logged at startup rather than
applied silently: a stale variable shadowing a real session would otherwise be
invisible.

## Consequences

- `pnpm auth sign-in`, `status`, and `sign-out` give the flow a real caller
  instead of leaving it exercised only by tests.
- The full flow is tested against a local mock Google and mock auth service: the
  loopback server, PKCE challenge/verifier pair, state rejection, consent
  denial, token rotation, single-flight refresh, and session clearing all run
  for real, with no OAuth client and no network required.
- Building it surfaced a genuine race: the flow originally attached its redirect
  listener after launching the browser, so a fast redirect — exactly what
  happens when the user already has a live Google session — would arrive before
  anything was listening. Listening now starts first.
- Running against production still needs a Desktop-type OAuth client id, in the
  harness as `PROJECT_STUDIO_GOOGLE_CLIENT_ID` and on the auth worker as
  `GOOGLE_DESKTOP_CLIENT_ID`. Everything else is complete.
- Sign-in does not yet gate startup: the harness boots signed out and fails at
  the first model call with `signed_out`. That is deliberate — the harness must
  start so the user can sign in — but a product-facing status surface belongs
  with the settings contracts.
