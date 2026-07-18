# R2: The Studio CLI Contract

Evidence pass: 2026-07-19
Status: specification. No code is deleted or migrated by this document.

## What This Document Is

R2 in the final plan asks for a specification of "launch/version/capability
detection, headless sessions, send/cancel, stream events, tool events,
approvals, files, Git/review, terminal behavior, errors, reconnect, and
migration/import APIs."

This is deliberately **not** a greenfield invention. The Studio CLI derives from
the OpenCode clone at `temp/opencode`, and that tree already ships a complete,
typed HTTP API with an SSE event stream. Writing an idealized contract against a
CLI that already has a different real one would produce fiction that fails on
first contact.

So this document is a **mapping and gap analysis**: what Desktop needs, what the
CLI already provides, and precisely where the two do not meet. Every endpoint
below was read from `temp/opencode/packages/protocol/src/groups/`.

Two facts that materially change earlier assumptions:

1. The rebrand is further along than "just started". Internal packages are
   already `@studio-ai/core`, `@studio-ai/protocol`, and `@studio/ServerAuthConfig`.
2. The CLI streams over **Server-Sent Events**, not WebSocket. Desktop's cloud
   chat uses a WebSocket pool (`src/runtime/transport/wsPool.ts`). These are two
   different transports and Desktop will have to speak both. Any plan that
   assumed one shared socket layer is wrong.

## Desktop's Current Dependency Surface

23 files import from `@/runtime`, using 20 distinct symbols. They divide into
four groups, and only two of them are Studio CLI's business:

| Group | Symbols | Target owner |
| --- | --- | --- |
| Run-event display | `InlineToolSteps`, `RuntimeStepCard`, `ToolPermissionCard`, `classifyToolDisplay`, `getToolIcon`, `toolLabel` | `run-events/` — shared by cloud and CLI |
| Cloud transport | `wsPool`, `ChatRequestBody`, `buildChatBody` | `cloud/chat/` — not CLI |
| Local capability/lifecycle | `useRuntimeInit`, `getMcpServers`, `getLocalMcpServer`, `readLocalMcpPermission`, `LocalCapabilityId`, `LocalPermissionGrants` | Studio CLI client, or deleted |
| Local tool execution | `executeLocalTools`, `ToolExecutionCallbacks` | Studio CLI — Desktop stops executing tools |
| Media helpers | `deleteRemoteImages`, `extractGeneratedImageIds` | `cloud/chat/` |

The practical consequence: the largest group is display code that belongs to
neither authority and should move to `run-events/` first. That move is
independent of the CLI and can proceed without it.

## Transport And Session Model

- Base URL: the CLI serves HTTP on a local port. Desktop must launch it, learn
  the port, and hold the process handle.
- Authentication: HTTP basic, `username` plus optional `password`, configured
  via `@studio/ServerAuthConfig` in `packages/server/src/auth.ts`. Desktop must
  generate and hold a per-launch credential; it must not ship a fixed default.
- Streaming: SSE at `GET /api/event` for the global stream, and
  `GET /api/session/:sessionID/event` for a single session.
- Capability detection: `GET /api/health`.

## Endpoint Mapping

### Sessions — fully covered

| Desktop need | CLI endpoint |
| --- | --- |
| List sessions | `GET /api/session` |
| Create session | `POST /api/session` |
| Active session | `GET /api/session/active` |
| Read session | `GET /api/session/:sessionID` |
| Full history | `GET /api/session/:sessionID/history` |
| Single message | `GET /api/session/:sessionID/message/:messageID` |
| Context inspection | `GET /api/session/:sessionID/context` |
| Send a turn | `POST /api/session/:sessionID/prompt` |
| Cancel a turn | `POST /api/session/:sessionID/interrupt` |
| Wait for idle | `POST /api/session/:sessionID/wait` |
| Compact context | `POST /api/session/:sessionID/compact` |
| Switch agent / model | `POST /api/session/:sessionID/agent`, `.../model` |
| Stage / clear / commit a revert | `POST /api/session/:sessionID/revert/stage`, `/clear`, `/commit` |

### Approvals — fully covered

| Desktop need | CLI endpoint |
| --- | --- |
| Pending requests | `GET /api/permission/request` |
| Saved grants | `GET /api/permission/saved` |
| Revoke a grant | `DELETE /api/permission/saved/:id` |
| Per-session requests | `GET /api/session/:sessionID/permission` |
| Read one request | `GET /api/session/:sessionID/permission/:requestID` |
| Answer a request | `POST /api/session/:sessionID/permission/:requestID/reply` |

This maps cleanly onto Desktop's existing `ToolPermissionCard` and
`LocalCapabilitiesModal`. Desktop becomes a renderer and responder for CLI
permission requests instead of owning its own capability-grant store.

### Files and terminal — covered

`GET /api/fs/read/*`, `GET /api/fs/list`, `GET /api/fs/find`, plus a `pty` group
for terminal behavior.

### Other available groups

`agent`, `command`, `credential`, `integration`, `location`, `model`,
`project-copy`, `provider`, `question`, `reference`, `skill`, `health`.

## Event Taxonomy

The CLI emits a granular, already-designed stream. Concrete names read from
`packages/core/src`:

| Concern | Events |
| --- | --- |
| Text | `session.next.text.started`, `.delta`, `.ended` |
| Reasoning | `session.next.reasoning.started`, `.delta`, `.ended` |
| Tools | `session.next.tool.called`, `.input.started`, `.input.delta`, `.input.ended`, `.progress`, `.success`, `.failed` |
| Steps | `session.next.step.started`, `.ended`, `.failed` |
| Shell | `session.next.shell.started`, `.ended` |
| Compaction | `session.next.compaction.started`, `.delta`, `.ended` |
| Session state | `session.next.prompted`, `.prompt.admitted`, `.retried`, `.moved`, `.synthetic`, `.context.updated` |
| Switching | `session.next.agent.switched`, `.model.switched` |
| Revert | `session.next.revert.staged`, `.committed`, `.cleared` |
| Server | `server.connected` |

Desktop must **not** re-derive this taxonomy. `run-events/classify` normalizes
both this stream and the cloud run stream into one display model. The
normalization layer is the contract Desktop owns; the event names above are the
contract the CLI owns.

## Gaps

These are the real output of R2. Each blocks a specific later phase.

| # | Gap | Blocks | Notes |
| --- | --- | --- | --- |
| G-1 | **No Git or review API.** There is no `git` protocol group. The CLI offers `session.revert.*`, which is turn-level undo, not branch/status/diff/stage/commit. | R7, and the `ReviewPanel` decision | Desktop's `ReviewPanel` currently calls Tauri git commands directly. Either the CLI grows a git group, or Desktop keeps direct Git ownership for review. This must be decided before R7, and it interacts with the known `git_stash_and_checkout` bug. |
| G-2 | **No migration or import API.** Nothing accepts Desktop's existing local conversations or Claude transcripts. | R4 | Either the CLI grows an import endpoint, or Desktop converts on read, or old history is declared non-portable. R4 cannot start without this decision. |
| G-3 | **Launch and port discovery are unspecified.** `GET /api/health` exists, but how Desktop starts the process, learns the port, and supplies credentials is not defined by the CLI. | R3 | Desktop-side concern. Belongs in `studio-cli/client`. |
| G-4 | **Reconnect and replay semantics are unverified.** SSE reconnect needs to answer whether events are replayed after a drop or silently lost. | R3 | If there is no replay, Desktop must re-read `session.history` on reconnect to avoid a torn transcript. |
| G-5 | **Two transports, one UI.** Cloud chat is WebSocket; CLI is SSE. | R3 | `run-events` must be transport-agnostic. Do not try to unify the transports; unify only the normalized event model. |
| G-6 | **No local MCP management API surfaced to Desktop.** The CLI has `skill` and `integration` groups, but Desktop's current `useMcpServers` expects start/stop/list of local MCP subprocesses. | R5 | Determines whether Desktop's MCP settings UI is retargeted or deleted. |

## Desktop Client Shape

What R3 should build, and nothing more:

```text
src/studio-cli/
  client/        process launch, port discovery, credential handling, base fetch
  capabilities/  health probe, version and feature detection
  sessions/      list, create, read, history, prompt, interrupt
  events/        SSE subscription, reconnect, normalization into run-events
  approvals/     permission request read and reply
  files/         fs read/list/find adapters
  terminal/      pty adapter, only if a visible terminal survives R7
```

This is a thin typed client over an API that already exists. It is not a
runtime, and it must not grow tool-execution logic. Desktop displays and
approves; the CLI executes.

## Sequencing Consequence

The most useful correction R2 produces: **the `run-events` extraction does not
depend on the CLI at all.** Six of the twenty `@/runtime` symbols are display
code shared by both authorities.

This was verified rather than assumed. The complete import surface of
`src/runtime/ui/` — `InlineToolSteps.tsx`, `RuntimeStepCard.tsx`,
`ToolPermissionCard.tsx`, `classifyToolDisplay.ts`, `toolCardRegistry.tsx`, and
`toolCardUtils.tsx` — is:

```text
./toolCardRegistry      ./toolCardUtils        @/lib/formatters
@/types                 @/types/tools          @/ui/icons
@/ui/primitives/Button  framer-motion          react
```

There is **no import from `runtime/transport`, `runtime/execution`,
`runtime/servers`, or `runtime/protocol`**. The folder is already a
self-contained display layer that only happens to live under `runtime/`.

Moving it to `run-events/` is therefore a pure relocation with caller updates,
verifiable by typecheck and the existing green gate, carrying no protocol risk
and no CLI dependency. It shrinks the `src/runtime` deletion surface before any
protocol work begins.

That makes it the correct first slice of R3, and it can start immediately.

## Exit Criteria For R2

- [x] Endpoint mapping recorded against the real CLI protocol.
- [x] Event taxonomy recorded from the CLI source.
- [x] Desktop dependency surface classified by target owner.
- [x] Gaps enumerated and bound to blocking phases.
- [ ] G-1 Git/review ownership decided (product owner).
- [ ] G-2 migration/import behavior decided (product owner).
- [ ] G-4 reconnect/replay verified against a running CLI.

The first four are complete. The last three are decisions and empirical checks
that require either the product owner or a runnable CLI, and they are recorded
in `05-decision-and-deferral-register.md`.
