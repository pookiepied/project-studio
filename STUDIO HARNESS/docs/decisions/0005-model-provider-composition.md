# ADR 0005: Model-Provider Composition

Status: Accepted; partially superseded by
[ADR 0006](0006-studio-gateway-integration.md), which makes `studio-cloud`
operational. The composition, capability, and registry decisions below still
hold, as does the treatment of `local` as recognized-but-unavailable.

## Context

Project Studio needs to select between a local model gateway, the Studio cloud
gateway, and an in-process deterministic test provider without changing agent
definitions, duplicating Pi/Flue provider registries, or adding real gateway
transport before credentials and authentication are in place.

## Decision

- A `ModelProviderAdapter` contract represents an operational model source.
  Only `test` is implemented in Phase 6; it owns Flue provider registration,
  model reference resolution, and capability metadata for the deterministic
  in-process provider.
- A validated `ProviderConfig` recognizes all three source identities
  (`test`, `local`, `studio-cloud`) via `PROJECT_STUDIO_MODEL_SOURCE`
  (default: `test`). Recognizing a source is a config-parsing concern,
  separate from whether that source is operational yet.
- A `ProviderBootstrapCoordinator` runs exactly once per instance. Calling
  `bootstrap()` a second time on the same coordinator throws
  `ProviderConfigurationError`. One production singleton is exposed through
  `bootstrapModelProviders(config)`; tests construct their own coordinator
  with `createProviderBootstrapCoordinator()` so bootstrap behavior is
  testable without global-state contamination.
- Bootstrap creates the adapter for the selected source, registers it with
  Flue, builds a `ModelRegistry`, registers the adapter in that registry, and
  validates the stable default model reference through the registry. The
  `BootstrapResult` exposes the configured `ModelRegistry` and the resolved
  `ModelDescriptor`, not a detached adapter.
- Selecting `local` or `studio-cloud` fails immediately with
  `ProviderConfigurationError` during adapter creation, before Flue
  registration, registry construction, or OpenTelemetry initialization. There
  is no placeholder `LocalModelProviderAdapter` or
  `StudioCloudModelProviderAdapter` in this phase: a no-op `register()` that
  reports success for a source that cannot serve a model would hide the
  failure until an actual request was made. Failing at bootstrap keeps the
  failure immediate and visible.
- The `studio` agent references `STUDIO_MODEL_ID`
  (`"project-studio/default"`), a constant that names neither a source, a
  provider, nor an implementation. It does not change when the source
  changes, and Phase 7/8 adapters must resolve the same alias.
- The deterministic Pi provider lives entirely behind
  `TestModelProviderAdapter`. Nothing outside `src/models/` imports it for
  side effects; `studio.ts` only imports the source-neutral contract.
- `ModelProviderAdapter.resolve()` validates the incoming reference: it
  rejects a reference for another source, and rejects a provider/model
  combination it does not recognize, both with `ModelResolutionError`. It
  never rewrites a mismatched source, provider, or model onto the returned
  descriptor.
- `ModelCapability` represents text generation, streaming, reasoning, tool
  calling, vision, embeddings, reranking, image generation, video generation,
  speech generation, transcription, context window, and maximum output
  tokens. Each capability is `"supported"`, `"unsupported"`, or `"unknown"`
  (not yet described); numeric limits use `"unknown"` rather than `0` when
  undescribed. Only an operational adapter publishes concrete descriptors in
  this phase.
- `ModelRegistry` aggregates registered adapters and provides `resolve()`,
  `resolveDescriptor()`, `listModels()`, and `validate()`, all routed through
  the registered adapters. It does not duplicate Pi or Flue provider
  registries.

## Consequences

- Selecting `test` requires only a config change; the studio agent
  definition is not edited. Selecting `local` or `studio-cloud` today is a
  deliberate, visible startup failure rather than a silent no-op.
- Adding a real local or Studio cloud transport in Phase 7/8 means
  implementing a new `ModelProviderAdapter` behind the same contract and
  registering it in `createModelProviderAdapter`, not changing agent or
  persistence code.
- The deterministic provider remains the only operational source in this
  phase and keeps tests network-free.
- Canonical conversation persistence is unchanged.
