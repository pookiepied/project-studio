# Studio Cloud MCP Library

The Studio Cloud MCP Library stores full definitions for discoverable cloud MCP
server integrations. It is intentionally separate from first-party platform
services such as memory, native tools, retrieval, Gateway, and Data.

No MCP servers are bundled yet. Memory MCP and Native Tools MCP remain platform
services outside this library.

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

This library owns full server definitions, including connection configuration,
tool metadata, and future installation or enablement details.
