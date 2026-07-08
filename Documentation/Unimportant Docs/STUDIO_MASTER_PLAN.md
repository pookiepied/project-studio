# Studio Master Refactor & Auth Plan

> Generated: 2026-06-15
> Status: PLANNING — no changes made yet beyond what is noted in "Already Done"

---

## 0. Settled Architecture Decisions

These are final. No further discussion needed.

### JWT Philosophy

| Layer | Who | Why |
|---|---|---|
| Issues tokens | `auth/` | Google OAuth → STUDIO user tokens; API key tokens for third parties |
| Validates tokens | `api/` | THE public gateway — all external traffic enters here |
| Also validates | `mcp/hub/` | Will be a public MCP endpoint; needs its own JWT gate |
| Chain-trusts callers | everyone else | Reached only via service binding; no JWT needed |

**Rule:** `packages/jwt` is imported ONLY by `auth/` (sign), `api/` (verify), and `mcp/hub/` (verify). If you find it imported anywhere else, that's wrong.

### Worker Public/Internal Map (final)

| Worker | Public URL | Auth model |
|---|---|---|
| `auth/` | ✓ `auth.pookiepied.dev` | n/a — it IS the auth service |
| `api/` | ✓ `api.pookiepied.dev` | Bearer JWT via `userAuth` middleware |
| `mcp/hub/` | ✓ `mcp.pookiepied.dev` [to add] | Bearer JWT via packages/jwt (JWT_SECRET) |
| `chat/` | ✗ internal + CF Access | CF Access assertion for STUDIO frontend; service binding from api/ for third parties |
| `gateway/` | ✗ internal | service binding from chat/ only |
| `agents/` | ✗ internal | service binding from chat/ only; NO public URL needed |
| `tracker/` | ✗ internal | tail consumer + service binding from api/ and chat/ |
| `workers/Studio/` | ✗ internal | service binding from api/ |
| `workers/ChatsStorage/` | ✗ internal | service binding from api/ |
| `workers/memory/` | ✗ internal | service binding from mcp/hub/; MEMORY_AUTH_SECRET is fine here |
| `workers/youtube/` | ✗ internal | service binding from mcp/hub/ |

### Token Types (packages/jwt)

| Type | Lifetime | Used for |
|---|---|---|
| `access` (existing) | 1 hour | STUDIO frontend users (Google OAuth flow) |
| `refresh` (existing) | 7 days | STUDIO frontend auto-renew |
| `api` [to add] | 30 days | Third-party custom API access; manual revocation only; no refresh |

### Folder Moves

| From | To | Service name stays/changes |
|---|---|---|
| `mcp/memory/` | `workers/memory/` | stays `studio-mcp-memory` (no service rename yet — matches binding in mcp/hub) |
| `mcp/youtube-transcript/` | `workers/youtube/` | stays `youtube-transcript-mcp` (matches binding in mcp/hub) |

mcp/ will only contain `hub/` after the move. Everything else is an internal sub-worker that doesn't speak MCP protocol natively.

---

## Already Done (do not redo)

- **T14**: `x-internal: 1` header + gated `recordUsage()` in gateway — usage double-counting fixed
- **T15**: `getApiKey` removed from `chat/src/pipeline/parse.ts` for non-local providers
- **T16**: Dead gateway image routes removed from `gateway/src/index.ts`; implementations kept in `gateway/src/routes/images.ts`
- **T17**: Stale path `../../chat/src/gateway/types` fixed in `gateway/src/types.ts`
- **T18**: TypeScript compile errors fixed (ChatAgent.ts path, agents cron cast)
- **A1**: `chat/src/server/pipeline/parse.ts` moved → `chat/src/pipeline/parse.ts`; callers updated
- **A2**: Memories routes extracted to `chat/src/server/routes/memories.ts`; `index.ts` cleaned up

---

## Phase 1 — packages/jwt: Add 30-day API Token

**Goal:** Support third-party "custom API tokens" that last 30 days and require no refresh.

**Why now:** `api/src/middleware/auth.ts` already uses `verifyToken`. Once we add the `api` token type, `api/` can accept both 1-hour STUDIO tokens AND 30-day API tokens with zero routing changes. `auth/` gets a new route that generates them on demand.

### Tasks

#### P1.1 — Add token type and expiry constant
File: `packages/jwt/src/index.ts`
```typescript
// In TOKEN_EXPIRY:
API_TOKEN: 30 * 24 * 3600,  // 30 days — custom API access, manual revocation only
```

#### P1.2 — Add ApiTokenPayload type
File: `packages/jwt/src/index.ts`
```typescript
export interface ApiTokenPayload {
  sub:   string;  // user ID
  email: string;
  role:  string;
  type:  'api';
  scope?: string; // optional: 'read', 'write', or omit for full access
  iat:   number;
  exp:   number;
}

// Update union:
export type TokenPayload = AccessTokenPayload | RefreshTokenPayload | ApiTokenPayload;
```

#### P1.3 — Add generateApiToken function
File: `packages/jwt/src/index.ts`
```typescript
export async function generateApiToken(
  userId: string, email: string, role: string, secret: string, scope?: string
): Promise<string>
```
Same pattern as `generateAccessToken` — HS256 signed, 30-day exp.

#### P1.4 — verifyToken already handles it
`verifyToken` is generic — it reads `payload.type` from the decoded JWT. No change needed.
BUT: `api/src/middleware/auth.ts` currently rejects `type === 'refresh'`. The `if` should now be:
```typescript
// allow 'access' and 'api'; reject 'refresh'
if (payload && payload.type !== 'refresh') { ... }
```
Already correct. No change needed.

---

## Phase 2 — api/: Wire REVOKED_KV

**Goal:** Token revocation (done in auth/) actually blocks access at the gateway.

**Current gap:** `api/wrangler.toml` has no REVOKED_KV binding. `api/src/middleware/auth.ts` calls `verifyToken` but never checks if the token has been revoked. A user whose token was revoked by auth/ can still hit api/ indefinitely until the token expires naturally.

### Tasks

#### P2.1 — Add REVOKED_KV to api/wrangler.toml
```toml
[[kv_namespaces]]
binding = "REVOKED_KV"
id = "720a294c0a5844248a4ee8ac6a91fa8f"   # same namespace as auth/ and mcp/hub/
```

#### P2.2 — Add REVOKED_KV to api/src/types.ts Env
```typescript
REVOKED_KV?: KVNamespace;
```

#### P2.3 — Check revocation in userAuth middleware
File: `api/src/middleware/auth.ts`
After `verifyToken` returns a valid payload, before calling `next()`:
```typescript
if (c.env.REVOKED_KV) {
  const revoked = await c.env.REVOKED_KV.get(`revoked:${token}`);
  if (revoked !== null) return c.json({ error: 'Token has been revoked' }, 401);
}
```

---

## Phase 3 — auth/: API Key Generation Routes

**Goal:** Users can generate 30-day API tokens for use outside STUDIO (scripts, third-party integrations).

**Context:** `auth/` already has Google OAuth, refresh, logout, me, whitelist admin routes.

### Tasks

#### P3.1 — Add POST /api-keys route
File: `auth/src/routes/apiKeys.ts` (new file)
- Requires a valid Bearer access token (STUDIO user must be logged in)
- Calls `generateApiToken(userId, email, role, JWT_SECRET, scope?)`
- Stores a record in AUTH_KV: `apikey:<jti>` → `{ userId, createdAt, scope, exp }` for listing/revocation
- Returns: `{ token: "<jwt>", expires_at: "<iso date>", scope }`

#### P3.2 — Add GET /api-keys route
- Returns list of active API keys for the authenticated user (from AUTH_KV scan)

#### P3.3 — Add DELETE /api-keys/:jti route
- Marks the key as revoked in REVOKED_KV: `revoked:<token-value>` → `"1"`
- Updates AUTH_KV record

#### P3.4 — Register routes in auth/src/index.ts
```typescript
import apiKeys from './routes/apiKeys';
app.route('/', apiKeys);
```

---

## Phase 4 — mcp/hub/: Make Public with JWT Auth

**Goal:** MCP clients (Claude Desktop, Cursor, etc.) can connect directly to `mcp.pookiepied.dev`.

**Current state:**
- `workers_dev = false, preview_urls = false` — not public
- `validateAuth` uses `MEMORY_AUTH_SECRET` (a shared secret) — wrong for a public endpoint
- `JWT_SECRET` is in the secrets list but not used
- `REVOKED_KV` is already bound ✓

### Tasks

#### P4.1 — Make public in wrangler.toml
File: `mcp/hub/wrangler.toml`
```toml
workers_dev = true      # remove the false lines
# preview_urls = false  # remove this line
```
Add custom domain (done in CF dashboard or via wrangler): `mcp.pookiepied.dev`

#### P4.2 — Replace validateAuth with JWT verification
File: `mcp/hub/src/index.ts`
Replace the `validateAuth` function (which checks MEMORY_AUTH_SECRET) with proper JWT verification:
```typescript
import { verifyToken } from '@studio/jwt';

async function validateJwt(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !env.JWT_SECRET) return null;
  const payload = await verifyToken(auth.slice(7), env.JWT_SECRET);
  if (!payload || payload.type === 'refresh') return null;
  // Check revocation
  if (env.REVOKED_KV) {
    const revoked = await env.REVOKED_KV.get(`revoked:${auth.slice(7)}`);
    if (revoked !== null) return null;
  }
  return payload.sub;
}
```
Update `handleMCP` to call `validateJwt` instead of `validateAuth`.
Pass `userId` from payload into tool calls where needed.

#### P4.3 — Restrict CORS (no longer wildcard)
File: `mcp/hub/src/index.ts`
Change `Access-Control-Allow-Origin: *` to only allow configured origins if possible,
or keep `*` since MCP clients may come from any host (MCP protocol allows this).
Keep `*` for now — document the decision.

#### P4.4 — Remove MEMORY_AUTH_SECRET from Env
`mcp/hub/src/env.ts`: `MEMORY_AUTH_SECRET` is still needed for forwarding to sub-workers (memory + youtube).
Keep it — it's used differently (for calling sub-workers, not for gate auth).

---

## Phase 5 — Structural Folder Moves

**Goal:** `mcp/` contains ONLY `hub/`. Memory and YouTube are internal sub-workers, not MCP servers.

### Tasks

#### P5.1 — Move mcp/memory/ → workers/memory/
1. Move folder: `mcp/memory/` → `workers/memory/`
2. Update `workers/memory/wrangler.toml` if the service name changes (keep `studio-mcp-memory` for now to avoid updating all bindings)
3. No binding changes needed in mcp/hub/ or chat/ since the service name is unchanged

#### P5.2 — Move mcp/youtube-transcript/ → workers/youtube/
1. Move folder: `mcp/youtube-transcript/` → `workers/youtube/`
2. Update `workers/youtube/wrangler.toml` service name if desired (keep `youtube-transcript-mcp` for now)
3. No binding changes needed in mcp/hub/

#### P5.3 — Update root package.json workspace references
If the root package.json lists workspace paths, update them:
```json
"workspaces": [
  "mcp/memory",          → "workers/memory",
  "mcp/youtube-transcript" → "workers/youtube",
]
```

---

## Phase 6 — chat/: Code Quality Fixes

**Goal:** Fix known bugs and clean up code duplication. Independent of auth phases.

Source: `CHAT_REFACTOR_V2.md` (tasks C1–C4, B2 from that document).

### C1 — Centralize STUDIO_HARNESS_BLOCKED
Create `chat/src/orchestration/tools/mcp/blocklist.ts`:
```typescript
export const STUDIO_HARNESS_BLOCKED = new Set([
  "mcp_studio_harness__write_file",
  "mcp_studio_harness__edit_file",
  "mcp_studio_harness__bash",
  "mcp_studio_harness__repl",
  "mcp_studio_harness__git_commit",
  "mcp_studio_harness__get_coding_guide",
  "mcp_studio_harness__sleep",
]);
```
Replace inline definitions in 3 files:
- `chat/src/pipeline/preload.ts:148`
- `chat/src/pipeline/stream/index.ts:225`
- `chat/src/orchestration/agent/nodes/llm.ts:99`

### C2 — Type `adapter` in phase1.ts / phase2.ts
Both `pipeline/stream/phase1.ts:32` and `phase2.ts:35` use `adapter: any`.
Replace with `import type { ProviderAdapter } from "../../server/providers/types"`.
Reveals any hidden type mismatches at compile time.

### C3 — Fix getApiKey bug in phase2.ts (specialist resume)
`pipeline/stream/phase2.ts:204`:
```typescript
// BEFORE (bug — leaks chat env API key into specialist payload):
apiKey: getApiKey(ctx.env, payload.provider) ?? "",
apiBaseUrl: PROVIDER_URLS[payload.provider] ?? "",

// AFTER (correct — specialist routes through agents' GATEWAY binding):
apiKey: "",
apiBaseUrl: "",
```
Remove now-unused imports: `getApiKey`, `PROVIDER_URLS` from phase2.ts.

### C4 — Fix handleToolExecute empty registry
`chat/src/server/routes/localInference.ts:81`:
```typescript
// BEFORE (bug — empty registry, user MCP tools never loaded):
const registry = createRequestRegistry([]);

// AFTER:
const userId = (body as any).userId;
const { tools: mcpTools } = userId && env.AI_DB && env.MCP_KV
  ? await loadMcpTools(userId, env.AI_DB, env.MCP_KV, undefined)
  : { tools: [] };
const registry = createRequestRegistry(mcpTools);
```
Add import: `import { loadMcpTools } from "../../orchestration/tools/mcp"`.
Note: local daemon POST body must include `userId`.

### B2 — Auth gap on non-chat routes in chat/
**Context:** Middleware 4 in `chat/src/index.ts` only checks header PRESENCE (CF Access assertion OR Authorization). Routes that bypass `handleChat` (images, pdf, docs, kb, agent-workflows, memories) get no userId extraction or token validation. This is a real gap on the CF Access path.

Create `chat/src/server/middleware/extractUserId.ts`:
```typescript
export async function extractUserId(request: Request, env: Env): Promise<string | null>
```
Implement using the same logic as `extractUserContext` — checks CF Access JWT assertion first, then Bearer token via `verifyBearerToken`. Returns `sub` or null.

Apply in:
- `handlePDFUpload`, `handlePDFDelete` — reject 401 if no userId
- `handleDocsIndex`, `handleDocsDelete` — reject 401 if no userId
- `handleKbList`, `handleKbIndex`, `handleKbDelete` — reject 401 if no userId
- `handleListAgents`, `handleCreateAgent`, etc. — pass userId to agent scoping

Images (serve/delete) are keyed by R2 object ID, not userId — leave as-is.

---

## Phase 7 — agents/: Cleanup

**Goal:** Remove wrong artifacts, document the auth chain, keep it clean as an internal worker.

### Tasks

#### P7.1 — Remove CORS headers
`agents/src/index.ts:44-54` has a CORS OPTIONS handler with `Access-Control-Allow-Origin: *`.
This worker is internal only (`workers_dev = false`). CORS is meaningless on service binding calls.
Remove the OPTIONS handler entirely.

#### P7.2 — Add comment documenting auth model
Before the fetch handler:
```typescript
// Auth: this worker is internal-only (workers_dev = false).
// All requests arrive via service binding from studio-chat, which is fully
// authenticated (CF Access or Bearer JWT). No per-request JWT needed here.
```

#### P7.3 — Remove `any` casts
`agents/src/index.ts:80`, `109` use `const body: any = await request.json()`.
Type these properly as `{ message?: string; from_agent?: string }`.

---

## Phase 8 — TypeScript Clean Compile (All Workers)

Run `npx tsc --noEmit` in each worker directory after phases 1–7:
- `packages/jwt/` (after P1)
- `api/` (after P2)
- `auth/` (after P3)
- `mcp/hub/` (after P4; or `workers/` path after P5)
- `chat/` (after P6)
- `agents/` (after P7)
- `gateway/` (should already be clean from T18)

---

## Execution Order

```
Phase 1  (packages/jwt)         ← prerequisite for Phases 3 and 4
Phase 2  (api/ REVOKED_KV)      ← depends on Phase 1 indirectly; can run in parallel with 3-4
Phase 3  (auth/ API keys)       ← depends on Phase 1
Phase 4  (mcp/hub/ public)      ← depends on Phase 1
Phase 5  (folder moves)         ← independent; can run any time
Phase 6  (chat/ quality)        ← independent; can run any time
Phase 7  (agents/ cleanup)      ← independent; can run any time
Phase 8  (TS compile check)     ← runs LAST after all phases
```

**Parallels:** Phases 2+5+6+7 can all run simultaneously once Phase 1 is done. Phases 3 and 4 also depend on Phase 1 but are independent of each other.

**Minimum viable auth:** Phase 1 → Phase 2 → Phase 3. This gives you 30-day API tokens that actually get revoked at the gateway. Phases 4-7 add polish and correctness but the core auth model works without them.

---

## What This Plan Does NOT Cover

- **OmniAgent / CodingAgent logic bugs** — user mentioned they're "not properly coded yet." A separate audit per agent is needed after this auth + structure work is done.
- **tracker/ audit** — not surveyed; assumed functional but needs review in a dedicated pass.
- **workers/Studio/ and workers/ChatsStorage/ audit** — internal workers, not reviewed. Include in a separate "internal workers" audit phase.
- **api/ route completeness** — all existing routes use `userAuth` correctly. Jobs, tasks, engine, updates, studio, tracker routes not audited in detail — defer.
- **mcp/hub/ tool bugs** — tools (web search, image gen, etc.) not audited. Separate pass after auth is in place.
- **ChatAgent Durable Object refactor** — complex; Phase 2 streaming, specialist resume, agent loops all work but haven't been touched. Separate refactor phase.
- **Database schema / migrations** — not covered here.
