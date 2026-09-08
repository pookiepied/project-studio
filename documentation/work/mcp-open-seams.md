# What is still open in MCP, after the zero-tools fix

Written 2026-09-08, from a read of the code rather than from a test run, so
that two things found during review are not lost between tasks.

## 1. A conversation's own decision cannot start a server

`ExtensionReconciler.reconcile` builds its desired set from
`inventory.active(kind, { projectId })` - a union over open projects, with no
conversation leg. `StudioRuntime.#enabledMcpServers` resolves through the
whole chain: the conversation, then its project, then this harness's project.

So a server switched on for one conversation alone, with the project and the
workspace off, resolves *enabled* for that conversation and is never started.
The route that writes that decision is live:
`PUT /conversations/:conversationId/extensions/mcp/:id`.

Before the settled-ness fix this showed as a frozen `0 tools`. It now shows as
the pending sentence on every turn, forever, because `supervisor.status` never
returns an entry and the settled predicate never says yes. The symptom moved
from a static lie to a promise that is never kept.

Two ways to close it, and they are not equivalent: teach the reconciler about
conversation scopes (correct, and it needs a list of live conversations the
spine does not currently have), or treat an absent supervisor entry as settled
(cheap, and it restores the honest `0 tools` without making the server run).
The first is the real answer.

## 2. One reader still spells a namespace by hand

`McpServerRegistry.serverOf` exists so that no reader undoes `namespaceOf`
with its own slice. `studio-runtime.ts`'s `refreshTools` still does
`namespace.slice("mcp:".length)`. No behaviour depends on it today; the day
the namespace spelling changes, it is the line that will not follow.

## 3. The suite writes into the real home

`tests/integration/mcp-runtime.test.ts` uses a temp directory for the project
but not for the harness home, so a run leaves empty conversation trees under
`~/.studio/data/conversations`. Pre-existing, harmless, and confusing to
anyone reading that directory to see what has actually been run.
