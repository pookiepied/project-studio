# ADR 0004: Observability Foundation

Status: Accepted

## Context

Project Studio needs vendor-neutral traces and metrics for agent runs, model
calls, and tools without building a second agent loop, transcript, or
persistence system. Flue already emits the runtime observations; Project Studio
owns SDK configuration, export policy, application logs, and safe error
handling.

## Decision

- Use `@flue/opentelemetry` for GenAI semantic projection and register it once
  through Flue's `instrument(...)` API.
- Configure the official OpenTelemetry Node SDK before Flue instrumentation is
  registered.
- Compose lifecycle in `src/app.ts` by initializing observability and calling
  the transport application factory. Business HTTP routes belong under the
  factory's application boundary; `app.ts` contains no route handlers or
  business routing logic.
- Default exporters are local and non-networking. OTLP is enabled only when an
  endpoint is explicitly configured. Tests may use in-memory exporters.
- GenAI content capture is disabled by default. Explicit opt-in runs captured
  values through an application redaction transform.
- Application logs use a small structured logger with optional `trace_id` /
  `span_id` correlation. The experimental OpenTelemetry Logs SDK is not the
  primary log store.
- Errors are normalized and safely serialized without stacks, credentials,
  prompt bodies, tool arguments, or environment values by default.
- Stable resource attributes are always set: `service.name`, `service.version`,
  and `deployment.environment`.
- SDK shutdown flushes exporters. Process exit is hooked so generated Flue
  shutdown still drains telemetry.

## Consequences

- Product code remains free of gateway, MCP, auth, and UI concerns.
- Future backends (Grafana, collectors, cloud APM) attach through OTLP without
  changing agent or persistence code.
- Content-bearing debug remains an explicit, redacted choice rather than a
  default production setting.
- `app.ts` is part of runtime composition for provider/bootstrap ordering,
  telemetry registration, admission, and transport-factory wiring. ADR 0001's
  earlier "no app.ts" constraint is narrowed to keep route implementation out of
  the process bootstrap.
