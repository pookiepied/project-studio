# ADR 0009: Local BYOK Providers

Status: Accepted

## Context

The Studio Gateway serves a curated catalog paid for by Project Studio. Users
also need to bring their own provider accounts — for models the gateway does not
carry, for local servers such as Ollama and LM Studio, and to pay their own way.

OpenCode was studied first, since it solves the same problem. The decisive
finding was that its provider breadth does **not** come from the SDK it chose:
every OpenCode provider plugin instantiates a Vercel AI SDK package. Breadth
comes from two other things — a downloaded catalog (models.dev) instead of
hand-written provider definitions, and `openai-compatible` as a universal
fallback that covers anything speaking the OpenAI wire format.

That reframed the decision. "Vercel AI SDK versus Pi" was never what determined
provider coverage.

## Decision

### Pi is the local runtime; the AI SDK does not enter the harness

Local BYOK runs on Pi's `Models` collection. Bringing the Vercel AI SDK into the
harness for the local path would mean an in-process AI-SDK-to-Pi bridge — a
second protocol translation doing in-process what the gateway adapter already
does over HTTP — plus two model runtimes in one binary. The gateway keeps its AI
SDK implementation because it is a separate deployed service.

Pi already provides what OpenCode built by hand: an injectable credential store,
provider-owned login flows, OAuth refresh under a lock, dynamic model lists,
auth source labels, and 36 built-in providers with a generated model catalog.

### The keychain is the credential store

`PiCredentialStore` presents the OS keychain (ADR 0007) as Pi's `CredentialStore`
interface. That one adapter is the entire BYOK storage integration: Pi persists
every credential it owns, and all of it lands in the platform keychain rather
than a file. OpenCode's plaintext `auth.json` is explicitly not copied.

Credentials are JSON and an OAuth credential holding both tokens exceeds the
platform's 1280-code-unit entry ceiling, so values are **chunked** across
numbered entries with a version header, and writes clear trailing chunks left by
a longer previous value. A keychain also cannot enumerate its entries, so the
bridge maintains an index entry listing the connected provider ids.

Writes are serialized per provider. Pi runs OAuth refresh inside `modify`
precisely so concurrent requests cannot double-refresh a rotated token; that
guarantee is only real if the store honors it.

### Custom providers are configuration, not code

A user-declared provider needs an id, a base URL, and a wire protocol — that is
the whole extensibility story, and it is what makes Ollama, LM Studio, LiteLLM,
vLLM, and proxy services work without provider-specific code. Plain HTTP is
allowed only for loopback hosts; a remote endpoint receiving a user's key must
use TLS.

Keyless local servers get a documented placeholder key. This was found by
testing rather than assumed: Pi's OpenAI-compatible implementation refuses to
send a request with no API key, while Ollama and LM Studio require none and
ignore the header. The placeholder is used **only** for loopback endpoints — a
remote provider configured without a key should fail with Pi's own error instead
of sending a meaningless token over the network.

### The stable alias is a wire protocol

The agent only ever names `project-studio/default`. The adapter registers that
alias as its own Pi wire protocol and forwards each request to
`Models.stream()` with the configured target model, so Pi resolves credentials
and dispatches to the owning provider. The alias never reaches the wire; the
real model id does.

Model specifiers split on the **first** separator only, because model ids
routinely contain slashes — `openrouter/anthropic/claude-sonnet-4` addresses
provider `openrouter`.

## Consequences

- `local` is operational. Selecting it with no default model configured is a
  clean startup failure, not a silent fallback to the gateway.
- `pnpm providers list | connect | disconnect` manages credentials, giving the
  flow a real caller. Keys are read without echo and never printed.
- Local and Studio catalogs stay separate, with local models carrying
  provider-qualified ids so the credential owner remains visible.
- Capabilities are mapped honestly: Pi's model record has no tool-calling flag,
  so `toolCalling` is `"unknown"` rather than guessed.
- Custom providers are declared through `PROJECT_STUDIO_LOCAL_PROVIDERS`. This is
  interim: provider connection belongs in product settings with a real store,
  which is the next subphase. Environment configuration keeps the runtime honest
  without inventing a settings surface no UI consumes yet.
- The ceiling: a provider with a bespoke, non-OpenAI-shaped protocol that Pi does
  not implement cannot be added by configuration alone. In practice the industry
  has converged on the OpenAI wire format, but that is the real limit.
