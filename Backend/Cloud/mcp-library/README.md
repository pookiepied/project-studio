# Studio Cloud MCP Library

The Studio Cloud MCP Library stores full definitions for discoverable cloud MCP
server integrations. It is intentionally separate from first-party platform
services such as memory, native tools, retrieval, Gateway, and Data.

Two MCP server definitions are currently bundled as system-scoped resources:

- Studio Agent Execution MCP (`execution`): parent-child agent orchestration,
  sub-agent spawning, status checks, awaiting, cancellation, result retrieval,
  and sub-agent `report_back` communication.
- Studio Skill Library MCP (`skills`): skill discovery, metadata inspection,
  SKILL.md reading, supporting resource loading, and task-specific skill
  resolution.

Memory MCP and Native Tools MCP remain platform services outside this library.
The bundled Studio Agent Execution MCP and Studio Skill Library MCP definitions
are active system capabilities. Tool Execution dispatches their
`service-binding://` endpoint refs to the owning internal workers instead of
treating them as remote HTTP MCP servers.

## Categories

MCP server categories are stored in `metadata.category` and mirrored into
`tags` for registry search. Keep categories broad enough for future discovery:

- `knowledge`: documentation, reference material, product knowledge, and
  architecture notes.
- `execution`: runtime-facing orchestration tools such as spawning, awaiting,
  reporting, and cancelling delegated work.
- `skills`: skill discovery and progressive loading for SKILL.md-compatible
  skill bundles.
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

## Compatibility Notes

MCP server definitions should follow MCP conventions:

- Tools are action-oriented operations exposed with JSON Schema input contracts.
- Tools should provide predictable structured output schemas when possible.
- Tool annotations should describe read-only, destructive, idempotent, and
  open-world behavior.
- Servers may later expose MCP resources or prompts when those primitives fit
  better than tools.
- Streamable HTTP is the preferred cloud transport.

Skill-facing MCP servers should preserve SKILL.md bundle compatibility:

- A skill is a directory bundle with a top-level `SKILL.md`.
- `SKILL.md` should contain portable frontmatter such as `name` and
  `description`.
- Supporting files should be loaded progressively only after the skill
  instructions reference them.
- Studio may add registry metadata, permissions, ownership, search indexes, and
  versioning outside the portable skill bundle.
