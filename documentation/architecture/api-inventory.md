# API Inventory — Task 008.4 (ex-008.44)

> **Source:** `008.4` in [`documentation/archive/phase-11-mcp/008-phase-1-11-completion.md`](../archive/phase-11-mcp/008-phase-1-11-completion.md) — inventory every Harness HTTP route, request/response/error/scope/stream contract and add compatibility/version rules. **Status: 3 of 5.** **The open items are named rather than counted, because a count is what let them stay open unnoticed:** (1) the *inventory* was wrong — grant listing and revocation are described as routes and neither exists nor has a caller, meta-task **#73**; (2) the version rule below was specified and never built, meta-task **#40**, resolved by deleting the rule rather than leaving the promise.
>
> The three that stand are the UUID policy (`src/identity/uuid.ts:17`), the execution identity graph (`src/execution/context.ts`), and initial-admission idempotency. **Idempotency is provisional:** it exists only as vendored `@flue` patches, and meta-task **#12** deletes them and accepts lost-ack as `unknown` for 1.0. When that lands this line becomes 2 of 5.
>
> Task 008 records this section as 5/5. It is not. The discrepancy is meta-task **#39**; the full set of corrections to that file is meta-task **#42**, recorded in its header.

## 1. Route Inventory (Harness HTTP surface)

All routes are behind `src/transport/http/middleware/admission.ts:34` `createAdmissionMiddleware` which validates `Authorization: Bearer <ADMISSION_CREDENTIAL>` (32B base64url, `src/admission/credential.ts:19`) and injects `AuthContext` + `ExecutionContext` (`X-Project-Studio-Request-Id` if valid UUID else new). `src/transport/http/create-app.ts:25` composes.

| Route | Method | Scope | Request | Response | Errors | Stream | Owner |
|---|---|---|---|---|---|---|---|
| `/agents/:name/:id` | POST | `agent:run` (`src/admission/scopes.ts`) | `{message:string, images?:{data,mimeType,filename}[], idempotencyKey?: via Idempotency-Key header}` (`src/application/harness-client.ts:43`, patched `@flue/sdk`) | `202 {streamUrl, offset, submissionId}` (`src/transport/http/create-app.ts:25` via `flue()`), `200 {result, streamUrl, offset, submissionId}` if `?wait=result` | `401 unauthenticated`, `400 invalid_request` (bad JSON), `409 conflict` (Idempotency-Key payload mismatch, `conversation-projections-XMug3C6A.mjs:661`), `500 internal_error` | Durable Streams `Last-Event-ID` via `offset` | Flue |
| `/agents/:name/:id` | GET/HEAD | `agent:run` | `?live=sse` or `offset` | `FlueConversationSnapshot` / `FlueConversationState` via `client.agents.history/observe` | `401`, `404` stream not found | `text/event-stream` | Flue |
| `/agents/:name/:id/abort` | POST | `agent:run` | `{}` | `{aborted:boolean}` | `401`, `405` | — | Flue |
| `/agents/:name/:id/attachments/:attachmentId` | GET | `agent:run` | — | `image/*` bytes | `401`, `404` | — | Flue |
| `/api/mcp/servers` | GET | `extension:management` (`src/transport/http/routes/mcp.ts:117`) | — | `McpServerRecord[]` with `status` (`src/extend/mcp/supervisor.ts:198`) | `401`, `403` scope_required | — | `McpAdministration` (`src/application/mcp-management.ts`) |
| `/api/mcp/servers` | POST | `extension:management` | `McpServerInput` (`src/extend/mcp/registry.ts:54`, `routes/mcp.ts:54`) `{id,title,transport,command,args,env,url,auth,authHeader,authEnvVar}` | `201 {record+status}` | `400` + `code:extend.internal` (validation via `assertSafeMcpPayload`), `401`, `403` | — | `McpManagementPort.save` |
| `/api/mcp/servers/:id` | PATCH | `extension:management` | Partial `McpServerInput` | `200 {record+status}` | `400`, `404`, `401`, `403` | — | `McpManagementPort.save` |
| `/api/mcp/servers/:id` | DELETE | `extension:management` | — | `204` | `400`, `404`, `401`, `403` | — | `McpManagementPort.remove` |
| `/api/mcp/servers/:id/status` | GET | `extension:management` | — | `{record, status: McpServerStatus}` (`registry.ts:105`) | `404` | — | `McpManagementPort.status` |
| `/api/mcp/servers/:id/credential` | PUT | `extension:management` | `{secret:string}` | `204` | `400 credentials.invalid`, `404` | — | `SecureCredentialStore` (`mcp` scope) |
| `/api/mcp/servers/:id/credential` | DELETE | `extension:management` | — | `204` | `404` | — | `SecureCredentialStore` |
| `/api/mcp/projects/:projectId/extensions/mcp/:id` | PUT | `project` | `{enabled:boolean}` | `{enabled}` | `400`, `401`, `403` | — | `ExtensionSelectionStore` (`src/extend/selection.ts`) |
| `/api/permissions/pending` | GET | `permission:approval` (`src/transport/http/routes/permissions.ts`) | — | `PendingPermissionApproval[]` (`src/application/approval-broker.ts:13`) `{id, request, decision, createdAt}` | `401`, `403` | — | `PermissionApprovalBroker` |
| `/api/permissions/pending/:id` | POST | `permission:approval` | `{verdict:"allow"|"deny", duration:"always"|"session"|"once", scopeId?}` | `{ok}` | `400`, `404`, `401`, `403` | — | `PermissionApprovalBroker` |
| ~~`/api/permissions/grants`~~ | GET | — | — | — | — | — | **NOT IMPLEMENTED — meta-task #73** |
| ~~`/api/permissions/grants/:id`~~ | DELETE | — | — | — | — | — | **NOT IMPLEMENTED — meta-task #73** |

**Headers:** `Authorization: Bearer <cred>`, `Idempotency-Key: <StudioUuid>` (for `POST /agents`), `X-Project-Studio-Request-Id: <StudioUuid>` (for `ExecutionContext`), `Content-Type: application/json`, `Location`, `Stream-Next-Offset` (Flue).

**Flue sub-app:** `flue()` at `/` (`src/transport/http/create-app.ts:34`), `src/agents/studio.ts:8` defines `studio` agent with `durability: {maxAttempts:3, timeoutMs:300_000}`.

## 2. Compatibility / Version Rules (008.4)

- **No version header, deliberately.** This section specified
  `X-Project-Studio-API-Version: 1` with a `410 Gone` path for unsupported
  versions. **None of it was ever implemented** — `create-app.ts` and the
  admission middleware contain no version logic — and it is removed rather than
  built (meta-task **#40**). The reason: the Harness and its only client ship
  from this repository, at the same version, in the same binary, over loopback.
  A negotiation between two halves of one artifact negotiates nothing, and a
  rule that passes only its own tests is the kind of ceremony this cycle exists
  to remove. **What brings it back:** a client that ships separately from the
  Harness — a third-party client, a remote Harness, or a client updated
  independently of the binary. The first of those to exist makes this real work.
- **Additive only within major:** New fields are optional, new routes are additive, new enum values are ignored by old clients. Removal or rename is major.
- **Error shape stable:** `{error:string, code:"domain.kind", details?:string}` (`src/contracts/errors.ts:96`, `src/observability/error-reporter.ts`). `code` is `domain.kind` (`admission.unauthenticated`, `extend.internal`, `credentials.invalid`, etc.), not HTTP status. New `code` values are additive.
- **Idempotency contract stable:** `Idempotency-Key` is `StudioUuid` (`src/identity/uuid.ts:11`), `1-200` printable ASCII, `project-studio:<key>` as Flue `submissionId` (`node_modules/.pnpm_patches/.../internal.mjs:1704`). Same key + same payload → same `submissionId`/`offset`/`streamUrl` (no duplicate turn). Same key + different payload → `409 conflict` (`conversation-projections-XMug3C6A.mjs:661`). No second journal.
- **Execution identity stable:** `requestId` (`StudioUuid`), `operationId`, `parentOperationId`, `attemptId`, `flue*` links, `traceId`/`spanId` are additive log fields (`src/observability/logger.ts:29`), never breaking.
- **Auth scope stable:** `ALL_ADMISSION_SCOPES` is additive; new scope is `403 scope_required` for old clients, not `401`.

## 3. Stream Contracts

- **Conversations:** `POST /agents/:name/:id` → `202` with `streamUrl`+`offset`+`submissionId`; `GET /agents/:name/:id?live=sse` with `Last-Event-ID: <offset>` resumes without duplicate (Flue `offset` is Durable Streams checkpoint, `tests/integration/harness.test.ts:100` proves no duplicate).
- **Runs:** `POST /workflows/:name` → `202` with `runId`/`streamUrl` (not used in 1.0, kept for Flue parity).

## 4. Verification

- `tests/integration/harness.test.ts:100` — no duplicate on reconnect
- `tests/integration/harness.test.ts:405` — Idempotency-Key replay same `submissionId`, 409 on mismatch
- `tests/unit/execution-context.test.ts:1` — family preserved across child/retry
- `tests/unit/http-admission.test.ts:17` — admission before Flue/MCP/permissions
