# Architecture — Studio Web MCP

```
MCP Client (Studio harness / Claude / Cursor)
  │  POST /mcp  (Mcp-Method, Mcp-Name, Origin)
  ▼
┌─────────────────────────────────────────┐
│  Studio Web MCP — Cloudflare Worker  │  ← this repo
│                                         │
│  Handler (src/server/handler.ts)        │  Origin check, requestId, logger
│        │                                │
│  MCP Protocol Layer (server/)           │  2026-07-28, stateless, no session
│        │                                │
│  Tool Layer (tools/search, tools/fetch) │  validation (valibot)
│        │                                │
│  Runtime Layer (runtime/search|fetch)   │  primary → classify → fallback → normalize
│        │                                │
│  Provider Layer (providers/*)           │  Tavily, Jina, Brave adapters
│        │                                │
│  Error Layer (errors/)                  │  StudioError → report → MCP payload + logs
│  Config Layer (config/env.ts)          │  registry is code, selection is env
└─────────┬───────────┬───────────────────┘
          │           │
       Tavily       Jina Reader
          │           │
       Brave      Tavily Extract (fallback)
```

## Invariants

- MCP knows capabilities, not providers (`search` vs `tavily_search`)
- One primary + one fallback (no waterfall) — `codes.ts` decides eligibility
- Every upstream `fetch()` has AbortController timeout → `provider.timeout`
- Content is bounded (`max_chars` + `offset` pagination owned by this server,
  context budgeting owned by harness)
- No DB, no auth in v1 (but admin surface documented in `admin.md`)
