# Studio Cloud Agent Library

Stores and resolves complete cloud agent definitions for the shared Agent Runtime.

Current state:

- No real system agents are bundled yet.
- User-created cloud agents are not enabled yet.
- The schema and definition format are prepared for both `system` and future
  `user` ownership.

The Cloud Library Registry stores only agent registration metadata and a
`definitionRef`. This library owns the complete agent definition behind that
reference.

## Agent Definition Format

Use [templates/agent-definition.template.json](templates/agent-definition.template.json)
as the non-active reference structure. It documents the expected fields without
registering a real agent.

Important sections:

- `identity`: name, slug, description
- `owner`: `system` now, `user` later
- `prompt`: system prompt and optional prompt metadata
- `permissions`: allowed, denied, and approval-gated actions
- `access`: allowed MCP servers, skills, native tools, and memory scopes
- `runtime`: Agent Runtime limits and execution policy
- `io`: input/output expectations
- `scheduling`: stored schedule configuration, not the trigger engine
- `metadata`: non-execution metadata

## Boundaries

- The Agent Library does not execute agents.
- The Agent Library does not decide context relevance.
- The Agent Library does not send notifications.
- The Agent Runtime loads definitions from this library and runs the shared loop.
- A future scheduler may read schedule configuration and trigger Agent Runtime.
