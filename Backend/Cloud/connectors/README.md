# Studio Connectors Worker

`connectors` owns Studio's first-party app integrations. The first provider is
Composio, which gives Studio managed OAuth and tool execution for apps such as
Gmail, GitHub, Slack, Microsoft Teams, Figma, and Google Drive.

This worker is separate from the MCP worker. MCP should stay focused on generic
MCP server registration and discovery; connectors should stay focused on app
accounts, permissions, OAuth state, and provider execution.

## Responsibilities

- Return Studio's curated connector app catalog.
- Start Composio managed OAuth with Connect Links.
- Store user/app connection state in D1.
- Keep connected accounts isolated by Studio user.
- Store app-level enable/disable permissions.
- Cache Composio tool schemas for connected apps.
- Revoke Composio connections on disconnect.
- Expose internal routes that the future AI worker can use to discover and
  execute connector tools.

## Naming

- Folder: `workers/connectors`
- Cloudflare Worker name: `connectors`
- Package name: `studio-connectors`
- D1 database: `studio-connectors`
- API service binding: `CONNECTORS`

## Source Layout

- `src/index.ts`: Hono app entrypoint.
- `src/routes`: public user routes and internal AI routes.
- `src/database`: row serializers and audit-event writes.
- `src/errors`: shared error types and JSON error responses.
- `src/http`: request parsing and user-auth helpers.
- `src/providers/composio`: Composio API client and curated app catalog.
- `src/security`: encryption helpers for stored credential payloads.
- `src/services`: reusable connector business logic used by routes.
- `schema.sql`: D1 schema.
- `wrangler.toml`: Cloudflare Worker config.

## Required Setup

Create the D1 database:

```powershell
wrangler d1 create studio-connectors
```

Paste the returned `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "CONNECTORS_DB"
database_name = "studio-connectors"
database_id = "..."
```

Apply the schema:

```powershell
wrangler d1 execute studio-connectors --remote --file=./schema.sql
```

Set required Worker secrets:

```powershell
wrangler secret put COMPOSIO_API_KEY
wrangler secret put CONNECTORS_ENCRYPTION_KEY
```

`COMPOSIO_API_KEY` comes from the Composio project. `CONNECTORS_ENCRYPTION_KEY`
should be a high-entropy secret used to derive the AES-GCM key for encrypted
credential payloads.

## Environment Variables

Configured in `wrangler.toml`:

```toml
[vars]
ENVIRONMENT = "production"
COMPOSIO_AUTH_CONFIGS_JSON = "{}"
CONNECTORS_TOOL_CACHE_TTL_SECONDS = "21600"
```

Optional:

```toml
COMPOSIO_API_BASE = "https://backend.composio.dev/api"
```

Secrets, not plain vars:

- `COMPOSIO_API_KEY`
- `CONNECTORS_ENCRYPTION_KEY`

`COMPOSIO_AUTH_CONFIGS_JSON` maps Studio app keys to Composio auth config ids.
Example:

```toml
COMPOSIO_AUTH_CONFIGS_JSON = "{\"gmail\":{\"authConfigId\":\"ac_xxx\"},\"github\":{\"authConfigId\":\"ac_yyy\"}}"
```

The catalog can also be overridden by toolkit slug:

```toml
COMPOSIO_AUTH_CONFIGS_JSON = "{\"googlecalendar\":{\"authConfigId\":\"ac_calendar\"}}"
```

## Security Model

Every connection is scoped by:

```text
user_id + provider_key + app_key
```

That means one user's Gmail connection cannot appear for another user.

For Composio-managed OAuth, Composio stores and refreshes the actual provider
tokens. Studio stores the Composio connected account id, status metadata, and
cached tool schemas. The connected account id is still treated as sensitive
operational metadata: it stays server-side and is not returned to the frontend
or prompt-visible LLM state.

If a future connector stores raw API keys or OAuth refresh tokens directly,
pass them through the `credentials` body field. The worker encrypts that payload
before storing it in D1.

## Curated Apps

The built-in Composio catalog is maintained in:

```text
src/providers/composio/catalog.ts
```

Current curated apps:

- Gmail
- Google Calendar
- Google Drive
- Google Docs
- Google Sheets
- Google Maps
- GitHub
- Slack
- Microsoft Teams
- Outlook
- OneDrive
- Zoom
- Figma
- Canva
- Supabase
- Linear
- Jira
- Asana
- Trello
- Firecrawl
- HubSpot
- Dropbox

Other experimental apps may exist in the catalog while Studio evaluates them.
Production availability depends on adding the matching Composio auth config id
in `COMPOSIO_AUTH_CONFIGS_JSON`.

## User Routes

The API gateway injects `x-user-id` before proxying to this worker.

- `GET /apps`
- `GET /connections`
- `POST /composio/connect`
- `POST /connections/:id/sync`
- `POST /connections/:id/refresh`
- `POST /connections/:id/sync-tools`
- `DELETE /connections/:id`
- `GET /permissions`
- `PUT /permissions/:providerKey/:appKey`

Generic connection routes also exist for future non-Composio providers:

- `POST /connections`
- `PATCH /connections/:id`

## Composio Flow

1. Frontend calls `POST /composio/connect` with an app key.
2. Connectors creates a Composio Connect Link.
3. Frontend opens the returned `redirectUrl`.
4. User grants permission in Composio's hosted OAuth flow.
5. Frontend calls `POST /connections/:id/sync`.
6. Connectors verifies the connected account belongs to the same Studio user.
7. Connectors stores status metadata and caches tool schemas from Composio.

Disconnect calls Composio revoke first, then deletes the local connection row.

## Internal AI Routes

These are for the future local/cloud AI worker, not direct frontend use:

- `GET /internal/catalog?userId=...`
- `GET /internal/tools/composio?userId=...`
- `POST /internal/composio/execute`

The intended AI flow is:

1. AI loads `/internal/catalog` for a small prompt-facing connector summary.
2. AI expands connector tools only when needed.
3. AI loads `/internal/tools/composio` for active, enabled connections.
4. AI executes through `/internal/composio/execute`.
5. Connectors checks user ownership, app permission, and cached tool membership
   before proxying execution to Composio.

## Development

Install dependencies:

```powershell
npm install
```

Type-check:

```powershell
npm run build
```

Run locally:

```powershell
npm run dev
```

Deploy:

```powershell
npm run deploy
```
