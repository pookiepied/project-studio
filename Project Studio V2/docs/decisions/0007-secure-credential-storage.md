# ADR 0007: Secure Credential Storage

Status: Accepted

## Context

Two different secrets need somewhere to live before the harness can
authenticate as a real user or call a provider on the user's behalf:

- the Studio session token used to reach the public API and, through it, the
  private Studio Gateway;
- BYOK provider keys the user supplies for the future local model runtime.

Until now the only credential path was `PROJECT_STUDIO_GATEWAY_TOKEN`, an
environment variable documented as development-only bootstrap. That is
acceptable for a developer pointing the harness at a gateway; it is not
acceptable for a user's own API keys.

The sequencing decision was to build storage before login. A session token is
itself a credential, so wiring a login flow first would have required a
temporary plaintext-on-disk step that then had to be undone.

OpenCode stores credentials in a plaintext `auth.json` protected only by
filesystem permissions. Project Studio does not copy that.

## Decision

### Native OS storage, with no fallback

Secrets live in the operating system's own store — Windows Credential Manager,
macOS Keychain, or Linux Secret Service — behind a `SecureCredentialStore`
port. There is deliberately no file-backed or database-backed fallback: if the
platform store is unavailable, storing fails with a typed `unavailable` error
rather than silently downgrading the user's security. An architecture test
fails the build if any credential module references the filesystem or a
database.

`@napi-rs/keyring` (MIT) is the implementation. It publishes prebuilt binaries
for every platform Studio targets, including Windows x64/arm64/ia32, macOS
x64/arm64, and Linux gnu/musl, so installation needs no local toolchain.
Archived `keytar` was not considered.

### Validated against the real platform store, not documentation

The library was probed against the actual Windows Credential Manager before
adoption. Three findings shaped the interface:

- reading a missing entry returns `null` rather than throwing, so `get` returns
  `string | null` instead of using exceptions for ordinary absence;
- deleting a missing entry returns `false` rather than failing, so `delete` is
  idempotent and reports whether anything was removed;
- **a credential blob is capped at 2560 bytes.** Values are stored as UTF-16, so
  the usable length is 1280 code units. The platform's own error text says
  "2560 chars", which is the byte budget and is off by a factor of two; the real
  limit was established by binary search.

`MAX_SECRET_LENGTH` is therefore 1280 UTF-16 code units, enforced on every
platform. Enforcing the tightest limit everywhere means a credential that
stores on macOS also stores on Windows, and the contract check fires before the
platform does so the failure is the same typed error on all systems.

### One entry per secret

The size limit is not merely a validation detail; it rules out a design. A
single entry cannot hold a serialized bundle of every credential, so each
secret gets its own entry, keyed by scope and id (`session:studio`,
`provider:openai`). Scope is part of the platform account name, so a provider
id can never collide with a session id. Session access and refresh tokens will
be separate entries for the same reason.

### Errors never carry the secret

Keyring backends have been observed to include the attempted value in their
error text. `CredentialStoreError` therefore discards the platform message
rather than wrapping it, classifies the failure into `unavailable`, `invalid`,
`too_large`, or `internal`, and uses fixed caller-safe messages. This matches
the existing gateway error policy: categorize, never echo.

## Consequences

- The harness can hold user secrets safely, which unblocks harness-owned login
  and then local BYOK providers.
- Tests use an in-memory store that enforces the same key and secret validation,
  so a test cannot pass with a value the real platform would reject.
- Platform tests run against the real OS store under a separate test service
  name and skip where no store exists, such as headless Linux without a running
  Secret Service. Skipping is correct there: that is an environment fact, not a
  defect.
- Non-secret metadata — which providers are connected, labels, timestamps — is
  **not** stored yet. The keyring cannot enumerate entries, so a product-owned
  table will be needed to answer "what is connected", but that belongs with the
  settings contracts that will consume it rather than being built speculatively
  now.
