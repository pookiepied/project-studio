# Studio Web MCP — Complete

Cloudflare Worker — remote MCP server for Project Studio web capabilities.

- **Protocol:** MCP 2026-07-28, Streamable HTTP, **stateless** (`sessionIdGenerator: undefined`)
- **Endpoint:** `POST /mcp` (single)
- **Tools:** `search`, `fetch` (provider-agnostic — model never sees `tavily_search`)
- **Search:** Tavily primary → Brave fallback (one fallback only)
- **Fetch:** Jina Reader primary → Tavily Extract fallback (one fallback only)
- **Errors:** basic `{ code, message }` — no stack/secrets leaked (raw stays in logs)
- **Deploy:** Cloudflare Workers (no DB, no KV, no auth v1)

## Structure (matches blueprint §4)

```
src/server/{server.ts,handler.ts,metadata.ts}
src/tools/search/{index.ts,schema.ts,handler.ts,types.ts}
src/tools/fetch/{index.ts,schema.ts,handler.ts,types.ts}
src/providers/search/{types.ts,tavily/*,brave/*}
src/providers/fetch/{types.ts,jina/*,tavily/*}
src/runtime/search/{execute.ts,parallel.ts,fallback.ts}
src/runtime/fetch/{execute.ts,parallel.ts,fallback.ts,content.ts}
src/errors/{error.ts,codes.ts,normalize.ts,response.ts} # basic code+message
src/config/{env.ts,providers.ts,defaults.ts}
src/validation/{url.ts,input.ts,security.ts}
src/shared/{types.ts,constants.ts,utils.ts}
```

## Quick start (local with env vars)

```bash
pnpm install
cp .dev.vars.example .dev.vars
# edit .dev.vars:
# TAVILY_API_KEY=tvly-...
# JINA_API_KEY=jina_...
# BRAVE_API_KEY=BSA...
# SEARCH_PRIMARY=tavily
# SEARCH_FALLBACK=brave
# FETCH_PRIMARY=jina
# FETCH_FALLBACK=tavily

pnpm dev          # http://localhost:8787
# health
curl http://localhost:8787/health
# MCP Inspector / any MCP client -> http://localhost:8787/mcp
pnpm typecheck
pnpm test
```

No admin, no numeric codes — errors are just `code` + simple `message` per your request.
Provider keys stay server-side (`wrangler secret` in prod, `.dev.vars` locally).

## MCP tools

### search

```json
{
  "query": "MCP 2026 specification",
  "max_results": 5,
  "topic": "general",
  "search_depth": "basic"
}
```

Response: `{ query, provider, results: [{title,url,content,score}], requestId }`

### fetch

```json
{
  "url": "https://example.com",
  "max_chars": 20000,
  "offset": 0
}
```

Response: `NormalizedFetchResponse` with `content` bounded, `has_more`, `next_offset`, `metadata`.

## Deployment

```bash
pnpm deploy # wrangler deploy
# set secrets:
wrangler secret put TAVILY_API_KEY
wrangler secret put JINA_API_KEY
wrangler secret put BRAVE_API_KEY
```

See `BLUEPRINT.MD` for full mental model.
