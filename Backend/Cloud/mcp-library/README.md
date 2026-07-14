# Studio Cloud MCP Library

The Studio Cloud MCP Library stores full definitions for discoverable cloud MCP
server integrations. It is intentionally separate from first-party platform
services such as memory, native tools, retrieval, Gateway, and Data.

Two MCP server definitions are currently bundled as system-scoped resources:

- Studio Docs MCP (`knowledge`): read-only curated Studio product and
  architecture documentation retrieval.
- Studio Workflow MCP (`workflow`): read-only Studio runbooks, checklists, and
  task templates.

Memory MCP and Native Tools MCP remain platform services outside this library.
These definitions are kept in `draft` status until their backing Worker
implementations are added, so the Context Worker will not expose non-runnable
tools as active capabilities.

## Categories

MCP server categories are stored in `metadata.category` and mirrored into
`tags` for registry search. Keep categories broad enough for future discovery:

- `knowledge`: documentation, reference material, product knowledge, and
  architecture notes.
- `workflow`: runbooks, checklists, task templates, and operational guidance.
- `integration`: external service integrations that are safe to expose as
  normal MCP servers.
- `data`: structured read/write access to user or workspace data through a
  clearly scoped MCP server.
- `automation`: event or action oriented servers that execute bounded workflows.

## Ownership

- System MCP servers are maintained by Studio and use `ownerType: "system"`.
- User-scoped MCP servers are not user-facing yet, but the schema supports
  `ownerType: "user"` and `ownerUserId` for future isolated user libraries.

## Registry Boundary

The registry should store MCP registration metadata:

- `id`
- `name`
- `slug`
- `description`
- `ownerType`
- `ownerUserId`
- `status`
- `currentVersion`
- `transport`
- `endpointRef`
- `authRef`
- `configRef`
- `tools`
- `permissions`
- `tags`
- `metadata.category`

This library owns full server definitions, including connection configuration,
tool metadata, and future installation or enablement details.
