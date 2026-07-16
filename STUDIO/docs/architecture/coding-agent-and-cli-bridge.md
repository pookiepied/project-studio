# Coding Agent and CLI Bridge Boundary

## Current systems

Studio currently has three related execution paths:

- The Coding Agent runtime (`src/runtime/transport/useAgentChat.ts`) owns intelligent task execution, tool calls, progress, and local/cloud transport from the conversation.
- The CLI Bridge (`src/cliBridges`) adapts a command-line coding tool into a Studio conversation engine. It owns process invocation details and streamed CLI protocol output, not product-level task state.
- Direct CLI tabs (`src/features/chat/cliTabs`) provide an advanced PTY surface for users who explicitly want to interact with Claude Code, Codex CLI, or OpenCode.

## Final responsibility boundary

The Coding Agent is the primary user-facing coding workflow. It owns intent, planning, file operations, tool selection, task progress, results, and the choice between local and cloud execution.

The CLI Bridge is local execution infrastructure. It may start and manage a supported command-line process, stream input/output, report lifecycle state, and expose a controlled shell session to the Coding Agent. It must not independently own conversation navigation, task planning, project selection, or a second copy of agent progress state.

Direct CLI tabs remain an advanced local-only escape hatch. They reuse PTY infrastructure but are not presented in cloud conversations and are not treated as resumable Coding Agent tasks.

## State ownership

- Conversation and Coding Agent state: conversation store and runtime transport.
- Project/workspace context: chat project context.
- PTY process state: Tauri PTY commands for the lifetime of the window.
- Direct CLI tab layout: context-scoped `studio.chatTabs.v1:*` records in local storage.
- Direct CLI hover cards: metadata only; terminal output is never copied into preview state.

Persisted CLI descriptors restore labels, working directories, the active tab, and user-defined order. A native process cannot be resumed, so only the selected restored tab starts a replacement process; inactive restored tabs remain lightweight descriptors until selected. Missing directories, missing tools, and malformed records are discarded before rendering.

## Session resource policy

`codingSessionManager` is the shared admission and lifecycle registry for PTY-backed coding surfaces. Studio currently permits six active local sessions and reserves four cloud-session slots. Closing a tab closes its PTY and releases the slot; failed launches also release their slot. Terminal scrollback is bounded to 5,000 lines, inactive views remain mounted but hidden so active work can continue, and inactive restored descriptors are lazy-started rather than launching every saved process after restart.

Each direct CLI tab creates one operating-system process in one PTY plus one xterm renderer and two Tauri event listeners. This path does not itself create a browser/webview, websocket, file watcher, or language server; the launched CLI may create its own child resources outside Studio's direct control. Portable PTY suspension is not implemented because pausing an interactive process tree is not reliable across supported operating systems. Studio reports inactive sessions as idle, caps admission, and requires explicit tab closure for termination rather than risking silent task loss.

## Environment visibility

- Local: environment selector, project launcher, local coding-tool launcher, and workspace toggle are visible.
- Local without a project: the project launcher remains visible but disabled with `Select a project first`; local coding tools can still launch against a chosen folder or the default location.
- Cloud: project launching and local CLI controls are hidden. They may return only when a compatible remote execution backend exposes those capabilities.
- Workspace toggle: always visible and kept at the outermost right edge.

## Migration rule

New intelligent coding behavior belongs in the Coding Agent. New process, PTY, and shell lifecycle behavior belongs in the CLI Bridge/runtime layer. UI code may request capabilities from those layers but must not duplicate execution logic.
