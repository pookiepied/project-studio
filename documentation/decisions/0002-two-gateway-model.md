# ADR 0002: Two-Gateway Model

Status: Superseded by [ADR 0009](0009-local-byok-providers.md) — 2026-08-24.
The centrally operated cloud gateway — the second of the two paths this
records — is cancelled: its Worker went in `bd4d389`, the Harness client in
`45233d5`. The first path did not become a "local gateway"; it became
in-process BYOK over Pi, which ADR 0009 records. A user-hosted gateway is
still a reserved possibility (`ProviderSource` in
`STUDIO HARNESS/src/contracts/providers.ts` keeps the name "gateway" for it),
so that half is deferred rather than dead. The text below is left as written.

Status: Accepted

## Context

Project Studio will support two different model access paths:

1. a local gateway that can use user-controlled provider credentials; and
2. the centrally operated Studio cloud gateway.

Their authentication, model discovery, and transport behavior are different.

## Decision

The harness depends only on a model-source identifier and model reference. Gateway registration is
an application bootstrap concern behind a model-provider port. Agent definitions do not contain
gateway URLs, access tokens, provider keys, or Cloudflare-specific headers.

Phases 1-4 use an in-process deterministic test provider. No concrete gateway transport is added.

## Consequences

- Adding either gateway does not change the agent loop or persisted conversation format.
- The selected gateway becomes explicit run metadata.
- Model IDs can be resolved by the selected gateway without merging both catalogs prematurely.
