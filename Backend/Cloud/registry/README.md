# Studio Registry

Single source of truth for everything discoverable or usable by Studio's agent
runtimes: connectors, MCP servers, skills, and agents (user-created and
Studio-provided), with permissions, availability, ownership, and execution location.

The registry answers: *What exists? Who owns it? Where does it run? Is it enabled?
What capabilities does it expose? What permissions apply?* (Studio Context answers
what is *relevant* — see ARCHITECTURE.md §20.)

## Rules

- **User-scoped, always.** Every table carries `user_id`; every query filters on it.
  One user's capabilities must never appear in another user's environment.
- **References, not credentials.** Connector/MCP auth state lives in the secure
  auth/connector-management system; the registry stores `config_ref` / `auth_ref` only.
- **Normalized representation.** Native and third-party MCP servers share one shape,
  preserving whether each runs locally or in the cloud.
- Local MCP servers keep a local source of truth on the user's machine; metadata is
  synchronized here (sync model is open decision #8).

## Must NOT

- Execute anything, assemble context, or hold provider/model logic
- Expose credentials to agent runtimes

## Structure

```
src/
  index.ts        Worker entry
  server/         HTTP surface, one route file per capability domain
  domains/        connectors / mcp / skills / agents — types + D1 repositories
  system/         Env bindings
schema.sql        D1 schema
```

The final worker name is open decision #14; "Studio Registry" is provisional.

## Implemented Registry Path

- Platform connector and native MCP metadata refreshes through the existing
  `studio-mcp` service binding.
- The desktop sends revisioned, sanitized local metadata; endpoints, process
  arguments, headers, and credentials are excluded by contract.
- Connector/MCP CRUD and connector/MCP/bundle snapshots are D1-backed and
  ownership-scoped.
- Local SQLite stores private registrations. OS keyring entries hold remote MCP
  bearer tokens; SQLite stores only `studio://secrets/...` references.
- Studio Harness and Computer Use synchronize as built-in local bundles.

Skills remain deferred. Replace the D1 placeholder id and apply `schema.sql`
before deployment.
