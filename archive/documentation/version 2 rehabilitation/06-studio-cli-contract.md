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

## How The CLI Expects To Be Driven

This section answers the question of whether Desktop should keep a PTY-style CLI
bridge. The answer is no, and the evidence is in the CLI itself.

**There is a headless server command.** `packages/studio/src/cli/cmd/serve.ts`
is described as "starts a headless studio server" and prints
`studio server listening on http://{hostname}:{port}`. This is the intended
integration point for any non-terminal client.

**The CLI's own frontend is an HTTP client, not a stdio consumer.** The TUI in
`packages/studio/src/cli/cmd/tui.ts` does not parse terminal output. It obtains
a `fetch` implementation and an `EventSource` and subscribes to
`global.event`. The terminal UI is a client of the same API Desktop would use.

**A generated, typed SDK already exists.** `packages/sdk/js` exports
`createStudioClient` over the same protocol groups, including a v2 client. There
is no need to hand-write a transport.

**There is no desktop shell upstream.** No Tauri or Electron configuration
exists anywhere in the tree; `packages/ui` is SolidJS consumed by the TUI. Studio
Desktop would be the first GUI client, so there is no precedent that argues for
a PTY bridge, and none that supplies reusable React components.

The conclusion: a PTY bridge would mean parsing human-readable output from a
program that already offers a typed API over HTTP with a structured event
stream. Desktop should launch `serve`, hold the process, and speak the protocol.

### Empirically Verified 2026-07-19

The CLI was started and probed live, so the claims below are observed rather
than inferred. It runs today with no preparation: `bun run --conditions=browser
./src/index.ts serve --port <port>` from `temp/opencode/packages/studio`.

- `GET /api/health` returns `{"healthy":true}`.
- `GET /api/event` returns `Content-Type: text/event-stream` and immediately
  delivers `data: {"id":"evt_...","type":"server.connected","data":{}}`,
  followed by periodic `: heartbeat` comments.
- `GET /api/session?directory=<path>` returns an empty list on a fresh install.

Two corrections and one warning came out of this:

1. **Events do carry an id, but only inside the JSON payload.** The SSE frame has
   no protocol-level `id:` line, so `Last-Event-ID` still cannot work. The
   payload id could support a client-side cursor, but `GET /api/event` accepts
   no parameters at all, so there is no server-side resume to ask for. The
   reconciliation requirement stands.
2. **There is a heartbeat**, so a dead connection is detectable without waiting
   for the next real event.
3. **The server is unauthenticated by default.** A request with no credentials
   returned 200. Auth activates only when `OPENCODE_SERVER_PASSWORD` is set;
   `packages/server/src/auth.ts` reads it from the environment and treats an
   absent value as "no auth required". Any process on the machine can therefore
   drive the agent, execute tools, and read the workspace. Desktop must set a
   per-launch password when spawning `serve`, and should bind to loopback only.
   Note the variable is still named `OPENCODE_*`; the rebrand has not reached it.

### Operational Details That Constrain The Client

Three details were read from the source and materially affect implementation:

1. **SSE events carry no id.** In the event handler, `eventData()` constructs
   `Sse.Event` with `id: undefined`. There is therefore no `Last-Event-ID`
   resume. A dropped connection cannot be resumed at the last event; Desktop
   must reconcile by re-reading `GET /api/session/:sessionID/history`.
2. **The subscriber queue drops.** The event bus uses `Queue.dropping` with a
   bounded capacity (the handler sets `subscriberCapacity = 256`) and raises
   `SubscriberOverflowError` past it. A slow consumer silently loses events.
   Desktop must never block the subscription while rendering, and must treat
   overflow as another trigger for history reconciliation.
3. **Requests are workspace-scoped.** The SDK rewrites requests using an
   `x-studio-directory` header, folded into a `directory` query parameter. The
   server is multi-workspace; every call must carry the workspace directory.

Authentication is HTTP basic via `@studio/ServerAuthConfig`. Desktop must
generate a per-launch credential and must not ship a fixed default.

## Gaps

These are the real output of R2. Each blocks a specific later phase.

| # | Gap | Blocks | Notes |
| --- | --- | --- | --- |
| G-1 | **No Git or review API.** There is no `git` protocol group. The CLI offers `session.revert.*`, which is turn-level undo, not branch/status/diff/stage/commit. | R7, and the `ReviewPanel` decision | Desktop's `ReviewPanel` currently calls Tauri git commands directly. Either the CLI grows a git group, or Desktop keeps direct Git ownership for review. This must be decided before R7, and it interacts with the known `git_stash_and_checkout` bug. |
| G-2 | **Migration path exists but format mapping does not.** `studio import <file>` accepts "session data from JSON file or URL", and `studio export [sessionID]` produces that JSON. | R4 | Downgraded from a hard block. The remaining work is converting Desktop's local conversation store and Claude transcripts into the CLI's session JSON shape. Use `studio export` output as the target schema. |
| G-3 | **Launch and port discovery are unspecified.** `GET /api/health` exists, but how Desktop starts the process, learns the port, and supplies credentials is not defined by the CLI. | R3 | Desktop-side concern. Belongs in `studio-cli/client`. |
| G-4 | **Resolved by inspection: there is no SSE resume.** Events are emitted with `id: undefined`, and the subscriber queue is dropping with capacity 256. | R3 | Desktop must reconcile via `GET /api/session/:sessionID/history` after any disconnect or overflow. This is now a design constraint rather than an open question. The `--replay` flag on `run` is terminal transcript redraw, not event replay; do not confuse the two. |
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
