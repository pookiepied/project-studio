# Studio Registry Implementation

## Ownership

- Cloud Registry owns user/workspace enablement and public capability metadata.
- Local Registry owns MCP endpoints, commands, process settings, machine state,
  secret references, and discovered local manifests.
- OS keyring owns bearer tokens and API keys.
- Context owns task-scoped tool selection and descriptor construction.
- Execution Runtime owns invocation, idempotency, approvals, parking, and resume.
- The existing MCP hub and desktop MCP manager execute tools. Registry never does.

## Implemented Flow

```text
Desktop SQLite + OS keyring
  -> sanitized revisioned sync
Cloud Registry D1
  <- platform metadata from existing MCP hub
  -> connector/MCP/bundle snapshot
Studio Context
  -> StudioToolDescriptor[]
Execution Runtime
  -> MCP hub for cloud tools
  -> durable external request for local tools
Desktop Tauri MCP manager
  -> authenticated result endpoint
Execution Runtime resumes
```

The synchronized local contract has no fields for endpoints, commands, process
arguments, headers, or raw credentials. Remote MCP servers whose credentials are
kept locally also execute through the desktop relay.

## Included

- D1-backed connector and MCP CRUD
- Platform native MCP and connector refresh through service binding
- Revisioned local registry synchronization
- Local SQLite registration and discovered tool storage
- Keyring-backed remote MCP bearer tokens
- Stdio subprocess and Streamable HTTP discovery
- Built-in Studio Harness and Computer Use bundle metadata
- Context-to-runtime tool descriptors
- MCP hub execution for cloud-native tools and connectors
- Durable local tool request/result protocol

## Deferred

- Skills, per request
- MCP management UI
- Context relevance ranking and token-aware tool pruning
- Automated health polling and reconnect scheduling
- Client-native (non-MCP) tool actions

## Deployment

Replace the placeholder `database_id` in `V2/registry/wrangler.toml`, apply
`V2/registry/schema.sql`, then deploy Registry before Context, Runtime, and API.
