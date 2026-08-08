# ADR 0002: Two-Gateway Model

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
