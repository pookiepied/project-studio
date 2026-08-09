# Project Studio — Multi-Service Plan (Decision-Held)

**Umbrella:** Project Studio (not "Studio") — product.
**Services (distinct):**
- **STUDIO HARNESS** — local-first agent harness (`../STUDIO HARNESS/`) — Flue + OTel + SQLite + permission kernel
- **Studio Web MCP** — Cloudflare Worker, remote MCP search+fetch (`./studio-web-mcp/`) — this plan
- **Gateway** — model-context gateway (supports all popular providers, image/video generation/editing)
- **Workers** — `worker-activity` (track all user activity), `worker-user-data` (manage user data)
- **Engines** — image generation, image editing, video generation — micro-services

Future engines accumulate; the harness is the foundation but not the whole product.

---

## 1. Decisions Pending (held, not frozen)

Per your list:

- exact error format
- handling of every error
- logging mechanism
- administration path
- admin URL

This file **holds** them with a concrete proposal (see `studio-web-mcp/docs/errors.md` + `studio-web-mcp/docs/admin.md`) derived from the harness (`STUDIO HARNESS/docs/decisions/0011-shared-error-contract.md`).

---

## 2. Error + Logging — Opinion by looking at harness

### What harness already does right (keep)

- `src/contracts/errors.ts:25` closed `StudioErrorDomain` — adding a subsystem is a type error until registered. This keeps the taxonomy honest as phases 9–18 add permissions/tools/MCP.
- `StudioError` base (`domain`+`kind` → `code=${domain}.${kind}`), `retryable` declared by subsystem, `toReport()` strips `stack`/`cause` — only safe shape leaves the process.
- `src/observability/errors.ts:33` `normalizeError`/`safeSerializeValue` + `redaction.ts:59` catalog — no secrets in logs.
- `src/observability/logger.ts:28` structured JSON + `correlationFields()` (trace_id/span_id).
- `src/observability/error-reporter.ts:49` single reporting path: logger + span event + `project_studio.errors` counter.

### What's missing for multi-service

- Bare `domain.kind` collides across services (harness `gateway.rate_limited` vs future gateway service).
- No numeric alias for your requested user-facing code (`4025` / `20`).
- Workers can't run Node OTel SDK; need Workers equivalent.

### Proposed format (scaffolded in `studio-web-mcp/src/errors/*`)

```
code: ${service}.${domain}.${kind}          ← primary, e.g. web-mcp.provider.rate_limited
codeNumeric: 2xxx                            ← alias, e.g. 2201, for UI/support (your 4025 idea)
service: harness | web-mcp | gateway | worker-activity | …
domain: config | provider | validation | search | fetch | mcp | …
kind: rate_limited | invalid_url | search_failed | …
```

- `code` is what you `group by` in Grafana; `codeNumeric` is what you show in a toast (`"Search failed (2201)"`) or ask for in support.
- `ERROR_CODES` registry in `studio-web-mcp/src/errors/codes.ts` also stores `status`, `retryable`, `fallbackEligible` so runtime knows when to try fallback (blueprint §14: 429/timeout/5xx → fallback; 401/403/validation/config → never).
- Raw provider details → logs only, never the MCP response (same as harness `StudioErrorReport` has no `cause`).

**Pipeline:** `Provider throw → normalizeError() → StudioError → shouldFallback() → formatMcpError()` → `{ isError:true, error:{ code, codeNumeric, message, retryable, requestId } }`

All scaffolded and tested: `studio-web-mcp/tests/errors/normalization.test.ts` (5 tests pass).

### Logging mechanism to adopt

- **Keep harness path** for Node services (harness, future gateway Node): `@opentelemetry/sdk-node` + `@flue/opentelemetry` + structured logger (same schema).
- **For Workers** (web-mcp, edge gateway, image/video edge): same JSON schema + redaction, but:
  - writer = `console.log` JSON (Cloudflare Logpush/Tail captures it)
  - correlation = `x-request-id` (generated) + `cf-ray` + `traceparent` header (no Node `trace.getSpan`)
  - counters = Cloudflare Analytics Engine / Workers Trace Events (same attributes: `error.code`, `error.domain`, `service`)
- Content capture stays `false` by default (same as harness `captureContent`); redacted opt-in only.

When gateway/workers land, extract shared `packages/studio-observability` — the string `service.*` codes mean no existing codes change.

---

## 3. Administration — Proposal

Do **not** put every service behind one `/admin` path on one host; each service owns its admin, plus a future umbrella proxy.

| Service | Example base | Admin URL | Auth |
|---|---|---|---|
| harness | `http://localhost:3415` (Flue) | **No HTTP admin** — CLI (`pnpm auth`) | OS keyring |
| web-mcp | `https://web-mcp.studio.example` | `https://web-mcp.studio.example/admin` (`ADMIN_PATH`, stub in `src/server/handler.ts:26`) | `ADMIN_TOKEN` (wrangler secret) → `Bearer` |
| gateway | `https://gateway.studio.example` | `https://gateway.studio.example/admin/v1/...` | gateway session + role |
| workers | internal | via gateway admin proxy | — |
| studio (umbrella, future) | `https://studio.example` | `https://studio.example/admin` → proxies to each service's admin | Studio session |

- `GET /admin` returns nothing secret — only booleans (`{ secrets: { tavily: true } }`), provider selection, version, and the error catalog (`GET /admin/errors`).
- When `ADMIN_TOKEN` is unset, `GET /admin/*` returns 404 (undiscoverable). For production put it behind **Cloudflare Access** instead of a shared token.

Full spec: `studio-web-mcp/docs/admin.md`.

---

## 4. What's already built (scaffold)

```
MCP/
  BLUEPRINT.MD                         ← original mental model (not frozen)
  PROJECT_STUDIO_PLAN.md               ← this file (held decisions + opinion)
  studio-web-mcp/                      ← scaffolded Cloudflare Worker
    src/errors/{error.ts,codes.ts,normalize.ts,response.ts}  ← service-prefixed + numeric
    src/observability/logger.ts        ← Workers structured logger (harness-shaped)
    src/config/env.ts                 ← valibot env + provider registry (code, not if-else)
    src/validation/url.ts              ← SSRF gate
    src/server/handler.ts              ← /mcp stub + /admin/* + /health
    docs/{errors.md,architecture.md,admin.md}
    tests/errors/normalization.test.ts ← 5 pass
    wrangler.jsonc, .dev.vars.example
```

Build: `pnpm typecheck` clean, `pnpm test` 5/5 pass.

---

## 5. Next steps — when you're ready

1. Review `studio-web-mcp/docs/errors.md` — confirm `service.domain.kind` + numeric alias vs pure numeric.
2. Decide admin auth: `ADMIN_TOKEN` vs Cloudflare Access (recommend Access for prod).
3. When you approve the format, extract `packages/studio-errors` and `packages/studio-observability` so harness + web-mcp + gateway share the registry.
4. Then wire MCP SDK 2026-07-28 in `studio-web-mcp` Phase 1 (the handler stub is ready for it).
