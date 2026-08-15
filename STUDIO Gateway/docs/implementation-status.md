# Gateway/UI Implementation Status

This is the working boundary between the browser control plane, new gateway
functionality, and modifications to existing gateway behavior. It is kept
explicitly so future work does not turn into an undifferentiated UI task.

## Local Runtime

Implemented locally:

- Gateway Worker through Wrangler at `http://localhost:8787`.
- Local D1 database through `.wrangler/state`.
- Browser UI through Vite at `http://localhost:4173`.
- Local migrations through `pnpm db:migrate --local`.
- Cross-origin development calls from the UI to the Worker.

Cloudflare deployment is not required for development. Production requires a
Worker deployment and a separate Pages deployment for `UI/dist`.

## Category Matrix

| Category | Status | Current boundary |
|---|---|---|
| UI foundations | Implemented | Standalone `UI/` app, Studio typography, neutral surfaces, dark mode, responsive shell, navigation, icons, loading/error states. |
| Dashboard | First slice implemented | 24h/7d/30d overview, request volume, model/provider/token rollups, cost, cache-read rate, latency metrics, recent requests. Empty state is honest until traffic exists. |
| Request system | Partial, usable | Request IDs, normalized persistence, filters, detail drawer, model/provider/token/application labels, finish reasons, token/cost/latency fields. Live refresh is manual; no WebSocket/SSE request stream yet. Prompt/completion bodies are intentionally not stored. |
| Users and usage analytics | Partial | API-token attribution and token rollups exist. User records, user types, user assignment, and user pages do not exist yet. |
| API tokens | First slice implemented | Create, one-time reveal, description, rate limit, enable/disable, rotate, delete, last-used metadata. Token scopes are still stored but not enforced. |
| Providers | Partial, usable | Existing provider registry, enabled toggle, encrypted credential entry/removal, provider detail/model list, all-provider sync, individual provider sync, credential status. Arbitrary provider creation and full provider profile editing are not implemented. |
| Models | First slice implemented | Catalog filtering, normalized metadata/capability display, provider/model marks, drag-and-drop production draft, explicit deploy, production `/v1/models` filtering. Canonical IDs and reliable data-policy records are not yet separate normalized fields. |
| Routing | Not implemented beyond current resolver | Current routing resolves an exposed model/provider. Fallback hierarchy, routing policies, presets, automatic routing, classifier rules, and node graphs are not implemented. |
| Media/vision routing | Partial | Vision capability guard and document preprocessing exist. Automatic whole-request vision routing and intermediate vision extraction strategies do not exist. |
| Sub-agent routing | Not implemented | No sub-agent identity, role groups, priorities, or role-aware model policies. |
| Optimization | Research only | RTK, Headroom, Caveman, Lassis, Ponytail, and context/tool compression are not integrated. |
| Infrastructure/observability | Partial | Normalized request records, request IDs, latency fields, usage extraction, cost normalization, structured logs, and health/readiness endpoints exist. A real OpenTelemetry SDK/exporter pipeline is not implemented; the existing telemetry module remains a no-op seam. |
| Database/backend | First slice implemented | Migration `007_observability.sql`, `gateway_requests`, analytics queries, token lifecycle changes, provider sync route, CORS, and catalog upsert fix. Users, applications, routing graphs, policy tables, audit logs, and dedicated analytics retention/rollup storage do not exist yet. |
| Settings | Partial | UI theme and session behavior exist. Gateway settings, retention, pricing policy, routing settings, and enterprise configuration do not exist. |
| Enterprise access policy | Partial | Token-level attribution and lifecycle exist. User/team/application ownership, model allowlists per token, scopes enforcement, quotas, audit history, and RBAC do not. |
| Deployment | Local + planned production | Local Worker/UI are runnable now. Pages deployment metadata and Worker CORS contract exist. A unified production deployment pipeline and environment setup are not implemented. |

## New Backend Functionality

- `migrations/007_observability.sql` adds normalized request records and token descriptions.
- `src/observability/request.ts` creates request IDs, extracts normalized usage, calculates model-based cost, and persists lifecycle data.
- `src/routes/admin/analytics.ts` adds analytics overview, request list/filtering, and request detail APIs.
- Token PATCH and rotate APIs extend the key lifecycle.
- Provider-specific synchronization is available at `POST /admin/providers/:id/sync`.
- CORS and UI-facing management access are available for local/separate Pages operation.

## Existing Backend Modifications

- V1 routes mark routing completion and participate in request telemetry.
- Gateway authentication attaches token identity to request records.
- Provider listing reports whether an encrypted credential exists without returning it.
- Catalog upsert SQL was corrected to match the live D1 column count.
- Error responses preserve `X-Request-ID` for V1 failures.

## Next Recommended Order

1. Add real OpenTelemetry spans/exporter while keeping normalized UI analytics as the product API.
2. Add durable user/application records and ownership on API tokens.
3. Add token/model access policies and enforce existing `scopes`.
4. Add request live updates and retention/rollup strategy.
5. Add canonical model identity, data-policy metadata, and pricing provenance.
6. Add fallback routing and policy-backed production deployment before automatic/classifier routing.
7. Add routing graph UI only after the routing policy schema and execution semantics are stable.
