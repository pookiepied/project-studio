# MCP Public Access — Feature Sprint Plan

> Status: PLANNED — do not start until chat refactor (P2/P6/P7/P8) is complete
> Goal: Let STUDIO users connect their tools and memory to any MCP-compatible AI client

---

## What This Unlocks

A STUDIO user opens Claude Desktop, Cursor, or any MCP-compatible client and adds one config entry:

```json
{
  "url": "https://mcp.pookiepied.dev/mcp",
  "headers": { "Authorization": "Bearer <their-studio-api-token>" }
}
```

From that point they get — inside Claude Desktop, not just STUDIO:
- **Their Composio apps**: Gmail, Notion, GitHub, Slack, Discord — the ones they connected in STUDIO, scoped only to them
- **Their Studio memory**: Claude can read their memory context AND write new memories back
- **Cloud MCP servers they've added**: e.g. YouTube transcript, any future cloud MCP
- All of it **user-scoped** — User A never sees User B's tools or memories

---

## Architecture

```
Claude Desktop / Cursor / any MCP client
        │
        │  POST /mcp   Bearer <api-token>
        ▼
  mcp.pookiepied.dev   (workers/mcp → main mcp worker, renamed from mcp/hub/)
        │
        ├── verifyToken(jwt, JWT_SECRET) → extracts userId
        ├── check REVOKED_KV → reject if revoked
        │
        ├── tools/list  → load user's Composio connections → dynamic per-user schema
        │
        ├── tools/call: composio_*    → Composio API (user-scoped via userId)
        ├── tools/call: studio_memory_*  → workers/mcp/memory/ (service binding)
        ├── tools/call: studio_youtube_* → workers/mcp/youtube-transcript/ (service binding)
        └── (future) tools/call: studio_agents_* → agents/ (service binding)
```

**Key principle**: The JWT carries the `userId`. Every tool call downstream is scoped to that userId. No tool can cross user boundaries.

---

## What Needs to Be Built

### M1 — packages/jwt: Add 30-day API Token Type

The only way a user can authenticate Claude Desktop is with a long-lived token.
Google OAuth doesn't work for headless clients. We need a stable token users can copy-paste.

**File:** `packages/jwt/src/index.ts`

Add to `TOKEN_EXPIRY`:
```typescript
API_TOKEN: 30 * 24 * 3600,  // 30 days — manual revocation, no refresh
```

Add payload type:
```typescript
export interface ApiTokenPayload {
  sub:    string;   // userId
  email:  string;
  role:   string;
  type:   'api';
  scope?: string;   // future: 'read' | 'write' | 'full' — omit for full access
  jti:    string;   // unique token ID — needed for revocation lookup
  iat:    number;
  exp:    number;
}

// Update union:
export type TokenPayload = AccessTokenPayload | RefreshTokenPayload | ApiTokenPayload;
```

Add generator:
```typescript
export async function generateApiToken(
  userId: string, email: string, role: string, secret: string, scope?: string
): Promise<{ token: string; jti: string; expiresAt: number }>
```

`jti` is a random UUID stored in KV for revocation. The function returns both the signed JWT and the `jti` so the caller can store it.

`verifyToken` already handles it generically — no changes needed there.

---

### M2 — auth/: API Key Generation Routes

Users generate and manage their API tokens from within STUDIO (must be logged in via Google OAuth).

**New file:** `auth/src/routes/apiKeys.ts`

#### POST /api-keys
- Requires: valid Bearer access token (active STUDIO session)
- Optional body: `{ scope?: string, label?: string }`
- Generates a 30-day API token via `generateApiToken()`
- Stores record in `AUTH_KV`: `apikey:<jti>` → `{ userId, email, label, scope, createdAt, exp }`
- Returns: `{ token, jti, expires_at, label, scope }`
- Limit: max 10 active API keys per user (enforce on creation)

#### GET /api-keys
- Requires: valid Bearer access token
- Returns list of active API key records for the user (from AUTH_KV scan by userId prefix)
- Does NOT return the token value — only metadata (jti, label, scope, createdAt, exp)

#### DELETE /api-keys/:jti
- Requires: valid Bearer access token
- Validates the jti belongs to the requesting user
- Writes to REVOKED_KV: `revoked:<token>` → `"1"` with TTL = remaining token lifetime
  - Problem: we don't have the token itself, only the jti. Two options:
    - Store the full token in AUTH_KV on creation (not ideal — tokens in KV)
    - Store `revoked-jti:<jti>` → `"1"` and check by jti instead of token
  - **Decision: check by jti** — update `userAuth` in api/ and the mcp/ JWT check to also check `revoked-jti:<jti>` when the payload contains a `jti` field

**Register in auth/src/index.ts:**
```typescript
import apiKeys from './routes/apiKeys';
app.route('/', apiKeys);
```

**Note:** `AUTH_KV` binding must exist in auth/wrangler.toml (verify it's there).

---

### M3 — api/: Wire REVOKED_KV + jti revocation

Even without the MCP sprint, this is needed. Logged-out users should not have working tokens.

**File:** `api/wrangler.toml` — add REVOKED_KV binding:
```toml
[[kv_namespaces]]
binding = "REVOKED_KV"
id = "720a294c0a5844248a4ee8ac6a91fa8f"   # same namespace as auth/ and mcp/hub/
```

**File:** `api/src/types.ts` — add to Env:
```typescript
REVOKED_KV?: KVNamespace;
```

**File:** `api/src/middleware/auth.ts` — after `verifyToken`:
```typescript
if (c.env.REVOKED_KV && payload) {
  // Check by token (for access tokens without jti)
  const byToken = await c.env.REVOKED_KV.get(`revoked:${token}`);
  if (byToken !== null) return c.json({ error: 'Token has been revoked' }, 401);

  // Check by jti (for API tokens with jti field)
  const jti = (payload as any).jti;
  if (jti) {
    const byJti = await c.env.REVOKED_KV.get(`revoked-jti:${jti}`);
    if (byJti !== null) return c.json({ error: 'Token has been revoked' }, 401);
  }
}
```

---

### M4 — mcp/: Rename hub → mcp root + Public URL

**This is the folder refactor** the user wants. The main MCP worker should live at `mcp/` root (with `src/`, `wrangler.toml` directly inside), not inside `mcp/hub/`.

#### M4.1 — Move mcp/hub/ contents up to mcp/
```
Before:  mcp/hub/src/index.ts
         mcp/hub/wrangler.toml
         mcp/hub/package.json

After:   mcp/src/index.ts
         mcp/wrangler.toml
         mcp/package.json
```
Delete the now-empty `mcp/hub/` folder.
Update any workspace references in root `package.json`.

#### M4.2 — Update wrangler.toml
```toml
name = "studio-mcp"        # unchanged
workers_dev = true          # was false — now public
# remove: preview_urls = false

# Add custom domain in CF dashboard: mcp.pookiepied.dev
```

#### M4.3 — Replace validateAuth with JWT verification
**File:** `mcp/src/index.ts`

Replace the `validateAuth(request, env)` function (which checks MEMORY_AUTH_SECRET) with:
```typescript
import { verifyToken } from '@studio/jwt';

async function getAuthenticatedUserId(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !env.JWT_SECRET) return null;

  const token = auth.slice(7);
  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload || payload.type === 'refresh') return null;

  if (env.REVOKED_KV) {
    const byToken = await env.REVOKED_KV.get(`revoked:${token}`);
    if (byToken !== null) return null;
    const jti = (payload as any).jti;
    if (jti) {
      const byJti = await env.REVOKED_KV.get(`revoked-jti:${jti}`);
      if (byJti !== null) return null;
    }
  }

  return payload.sub;
}
```

Update `handleMCP` signature:
```typescript
async function handleMCP(request, env, ctx): Promise<Response> {
  const userId = await getAuthenticatedUserId(request, env);
  if (!userId) return json({ error: 'Unauthorized' }, 401);
  // ... pass userId into tool calls below
}
```

`MEMORY_AUTH_SECRET` stays in env — still used for sub-worker calls (forwarding to memory + youtube workers). Don't remove it.

---

### M5 — mcp/: Per-user Dynamic tools/list

**This is the most important change for the feature to be useful.**

Currently `tools/list` returns a static `TOOL_LIST` array. For public MCP, each user should see their own Composio tools.

**File:** `mcp/src/index.ts` in the `tools/list` handler:

```typescript
if (method === 'tools/list') {
  // Static native tools (memory, youtube, etc.) — always present
  const nativeTools = TOOL_LIST;

  // Dynamic Composio tools — scoped to this user
  let composioTools: any[] = [];
  if (userId && env.COMPOSIO_API_KEY && env.MCP_KV && env.AI_DB) {
    try {
      const result = await loadComposioToolSchemas(env.COMPOSIO_API_KEY, userId, env.MCP_KV, env.AI_DB);
      composioTools = result.tools ?? [];
    } catch {
      // non-fatal — user may have no Composio connections
    }
  }

  return rpc(id, { tools: [...nativeTools, ...composioTools] });
}
```

**Pass userId into tool calls:**
In the `tools/call` handler, pass `userId` to `callTool` so tools can scope their operations:
```typescript
const result = await callTool(name, args, env, ctx, request, userId);
```
Update `callTool` signature in `tools/index.ts` to accept and thread `userId`.

**Memory tools**: The memory sub-worker already uses `userId` from the request body. Update `forwardToMemory` to inject it:
```typescript
body: JSON.stringify({
  jsonrpc: '2.0', id: rpcId, method: 'tools/call',
  params: { name: toolName, arguments: { ...args, userId } },  // inject userId
})
```

---

### M6 — CORS for MCP Clients

MCP clients connect from native apps, not browsers. The current `Access-Control-Allow-Origin: *` is acceptable for the MCP endpoint. Keep it.

Add `Mcp-Session-Id` to the allowed headers (already present — verify it stays).

---

## What is NOT in this sprint

- **Studio Agents via MCP**: Exposing sub-agents, blackboards, agent-to-agent via MCP requires significant design work. Defer to a future sprint.
- **Local MCP passthrough**: Local MCP servers (running on user's Tauri machine) are spawned by the desktop app, not by the workers. The MCP worker is for cloud tools only.
- **Self-hosted/cloud MCP passthrough**: User-configured external MCP URLs — the desktop app connects to those directly, not through this worker.
- **Native tools (web search, image gen, etc.)**: These stay in `chat/`. They are NOT exposed via the MCP worker. By design.

---

## Execution Order

```
M1  packages/jwt — add ApiTokenPayload + generateApiToken()
     ↓
M2  auth/ — POST/GET/DELETE /api-keys routes
M3  api/ — REVOKED_KV binding + revocation check   ← these two can run in parallel
     ↓
M4  mcp/ — rename hub → root, workers_dev=true, JWT auth
     ↓
M5  mcp/ — per-user dynamic tools/list + userId threading
     ↓
M6  CORS verify
     ↓
Test: configure Claude Desktop → mcp.pookiepied.dev → verify Composio + memory tools appear
```

---

## Pre-conditions (must be done before starting this sprint)

- [ ] `chat/` code quality refactor complete (C1–C4, B2)
- [ ] `agents/` cleanup complete (P7)
- [ ] TypeScript compile clean across all workers (P8)
- [ ] `mcp/hub/` folder structure decided and stable (user moving hub contents to mcp/ root)

---

## Success Criteria

- [ ] User can generate an API token from STUDIO (POST /api-keys in auth/)
- [ ] User can revoke an API token (DELETE /api-keys/:jti)
- [ ] Claude Desktop configured with the token connects to mcp.pookiepied.dev successfully
- [ ] `tools/list` returns the user's actual Composio apps (not a generic list)
- [ ] Memory tools in Claude Desktop read and write to the user's Studio memory
- [ ] User A cannot access User B's tools or memory
- [ ] Revoked tokens are rejected at both api/ and mcp/
