# Studio Cloud Library Registry

Minimal Cloudflare Worker for registering, organizing, searching, and retrieving
cloud library resources.

The registry supports:

- Skills
- Cloud MCP servers
- Agent registrations

It does not own connector state, local runtime sync, files, artifacts, execution
state, model provider data, credentials, or broader Studio backend behavior.

## Boundaries

- Reads are authenticated with `x-user-id`.
- Registry writes are internal-only and require the registry writer token in production.
- Records may be system-owned or user-owned. User-owned registration is available
  only to internal registry writers, not directly to end users.
- Skill records are registration metadata only; complete skill definitions live
  in the Cloud Skill Library.
- MCP server records are registration metadata only; complete server definitions
  live in the Cloud MCP Library.
- Agent records are registration metadata only; complete definitions live in the
  Cloud Agent Library.
- Secrets are stored elsewhere; this worker stores references such as
  `configRef`, `authRef`, `endpointRef`, and `instructionsRef`.
- Context selection and runtime execution happen in their own workers.

## Routes

- `GET /health`
- `GET /health/ready`
- `GET /skills`
- `POST /skills/register-system`
- `GET /skills/system-definitions`
- `POST /skills`
- `GET /skills/:id`
- `PATCH /skills/:id`
- `DELETE /skills/:id`
- `GET /mcp` and `GET /mcp-servers`
- `POST /mcp/register-system` and `POST /mcp-servers/register-system`
- `GET /mcp/system-definitions` and `GET /mcp-servers/system-definitions`
- `POST /mcp` and `POST /mcp-servers`
- `GET /mcp/:id` and `GET /mcp-servers/:id`
- `PATCH /mcp/:id` and `PATCH /mcp-servers/:id`
- `DELETE /mcp/:id` and `DELETE /mcp-servers/:id`
- `GET /agents`
- `POST /agents/register-system`
- `GET /agents/system-definitions`
- `GET /agents/:id`
- `POST /agents`
- `PATCH /agents/:id`
- `DELETE /agents/:id`

## Structure

```text
src/
  database/       D1 persistence helpers shared by registry domains
  domains/
    agents/       Agent registration metadata
      library/    Bundled system-agent definitions and registration mapping
    mcpServers/   Cloud MCP server routes, validation, repository, types
      library/    Bundled system MCP registration mapping
    skills/       Skill routes, validation, repository, types
      library/    Bundled system skill registration mapping
  errors/         Central AppError model and Hono error handler
  health/         Worker and subsystem health checks
  system/         Env, app binding, identity, ownership, JSON, validation, logging
```

## Database

`schema.sql` defines:

- `skills`
- `skill_versions`
- `mcp_servers`
- `mcp_server_versions`
- `agents`

Apply the schema to the configured D1 database before running this worker against
fresh state.
