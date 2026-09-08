# The capabilities note says "0 tools" for a server that is running

**Found by hand, 2026-09-08.** A person installed their first MCP server
(Firecrawl, HTTP transport, bearer auth), switched it on, and sent "hello".
The system block said `mcp:firecrawl - search and read of the internet` and
`0 tools`. A conversation started a few minutes later said 25 tools. Nothing
was retried, nothing was fixed in between.

The mechanism was never broken: asked to search the web, the model called
`discover`, found the tools, and made a real call that worked. Only the note
was wrong. That is the bug - the note is what the model reads before it knows
to ask.

## The cause, which is ordering and not timing

Three facts compose into it.

1. `McpManagementService.setEnabled` calls `extensions.changed()` and nothing
   else. That marks the desired set dirty; it does not run a pass. **So
   switching a server on starts no process.**
2. The harness's measured ordering (Phase 0, stated at the top of
   `src/agents/studio.ts`) is render first, sandbox factory later. The system
   prompt - and with it `conversationCapabilityInventory` - is assembled during
   render. `createSandbox` is what awaits `start()` and `reconcile()`, which is
   what launches servers and fills the catalog. The note is therefore built
   against a catalog that is still empty on the first submission after a
   server is switched on.
3. `CapabilityInventory.blockFor` memoizes per conversation, and that is
   deliberate: ADR 0048 section 1 requires the block to be still for the
   conversation's life, because a system block that changes re-bills the whole
   prefix. So the wrong answer is kept for good.

`StudioRuntime.start()` is memoized with `#started ??=`, and `app.ts` calls it
once at boot. A server installed after boot is therefore not covered by it.

## What to change

**Both halves. Either alone leaves a hole.**

### One - a decision that changes the desired set runs a pass

`setEnabled`, and the install and remove paths beside it, should trigger a
reconcile rather than only marking the generation dirty. It must not block the
HTTP response: a server that takes ten seconds to hand shake must not make the
settings screen wait ten seconds. Fire it and let it fail into the supervisor,
which already holds failures, reasons and retries.

Do not remove the `changed()` call. The reconciler's whole argument is that a
missed notification costs a stale cycle rather than a permanent lie; this adds
a fast path and must not replace the slow correct one.

### Two - do not freeze a note that had nothing to say yet

Even with the pass above, someone who sends fast enough still renders before
the handshake completes. So `CapabilityInventory` should settle its block only
when the answer is one worth keeping, and rebuild until then.

The condition needs care. "Zero tools" is a legitimate settled answer in at
least two cases that must keep working: a conversation with no servers switched
on at all (the block is empty, byte-identical to before the section existed -
there is a test pinning this and it must not change), and a server that is
genuinely connected but exposes nothing. What is not settled is an enabled
server whose supervisor has not yet reached a connected state. Read that from
the supervisor's status rather than inferring it from an empty tool list.

The cost when it does rebuild is one re-billed system block on that
conversation's second turn. That is the right trade against a note that is
wrong for the conversation's whole life, but write the reasoning down where
ADR 0048 section 1's stability rule is stated, because this is a deliberate
narrow exception to it and the next reader will otherwise think it is a
violation.

## What must not break

- The byte-identical empty-block test. A conversation with nothing switched on
  must produce exactly what it produces today.
- ADR 0048 section 1 in the ordinary case: once a note is settled it does not
  move for that conversation.
- ADR 0029: nothing unregisters a live tool.
- The supervisor's retry timing. Asking again for a server that is mid-backoff
  resets a delay that exists on purpose - `mcp/reconcile.ts` says so explicitly.

## Testing

The suites are slow and the trap is real: `pnpm test` runs `pnpm build` first,
and the MCP integration tests boot `dist/server.mjs` as a real subprocess.
Running `vitest` directly after changing harness source tests a stale bundle.
Rebuild first, always. Never run two suites at once - both rewrite `dist/`.

Baselines at `7d7a116`: harness 1818 passed / 25 skipped, client 892 passed.

Prove each fix with a negative control: break it, confirm the test fails for
the stated reason, restore it. A test that passes against the old behaviour
proves nothing about the new one.

The end-to-end shape worth an integration test: switch a server on, and assert
that a conversation's first note names its tools - which fails today.

## Done, 2026-09-08

Both halves, as specified, with one finding the handover's condition missed:

**Fix one** - `McpManagementService` gained an optional `reconcile` callback,
fired beside - never instead of - `extensions.changed()` from every mutating
path (save, remove, setEnabled, both credential paths). The runtime supplies
it: a background `extensions.reconcile(#reconcileProjects())`, caught on both
the promise and the synchronous side, logging through the runtime's own
logger. The callback cannot block or fail a settings response. The management
service additionally catches a throwing callback at its own boundary, so the
contract holds no matter who supplies the callback.

**Fix two** - `CapabilityInventory.blockFor` settles only when the build is
"one worth keeping", decided by a new `settled` predicate supplied by the
runtime: every enabled server has either completed a catalog read or failed
terminally. An unsettled build renders a pending sentence. **The re-ask
happens only between submissions**, at the turn-settings middleware - after
the submission's settings are settled, before Flue composes the run's
instruction document - and only for a *pending* note: a settled note is
refused for the conversation's life. The condition is read from the
supervisor's status and the catalog's completed reads - never from the
emptiness of a tool list.

**The second finding: the block may never move within a run.** Flue
re-renders the agent function for every model step and digests the composed
instruction document; a run whose system prompt changed between two steps is
narrated an instructions signal ("System instructions updated.") as a user
message and re-runs the model. Two placements of the re-ask were measured and
rejected before the right one was found: per render (the agent function
body), and inside the sandbox factory's `createSandbox` (once per submission,
but AFTER the first render has already composed the run's instructions - so
the memo deleted there was rebuilt by the second step's render, the digest
moved mid-run, and the MCP integration suite failed with the run settling as
text instead of calling the tool). The pre-run middleware is the only seam
strictly between submissions, and it is the harness's own code.

**The finding: `ready` alone is not "connected".** The supervisor applies
`ready` at the handshake, *before* its `onReady` (the catalog's `tools/list`)
runs - `supervisor.ts` does this deliberately so a death in that window is a
running server's death. Settling on `ready` alone would therefore freeze
`0 tools` one handshake later, in the window the fix was written to close.
The settled condition is `ready` **and** `catalog.hasRefreshed(id)` (a new
read: presence of a completed read, never the emptiness of the list, so a
genuinely empty server settles on its true `0 tools`). `failed` is also not
settled - a server mid-backoff may recover, and a note that settled on its
worst moment would describe a recovering server as an empty one. `given-up`
settles; the backoff has decided.

ADR 0048 §1 carries the exception's reasoning beside the stability rule, and
two new required-proof lines. The byte-identical empty-block test is untouched
and passing; the three original `blockFor` memoization tests now pass a
settle-true predicate explicitly, pinning that the ordinary stillness rule is
undisturbed.

**Negative controls, each run and reverted (the final design, after the
middleware seam):**
- `#applyNow`'s fire disabled: the three management tests fail with
  `reconciles` never advancing; all pre-existing management tests stay green.
- The settled condition disabled (`settled = true`): the four pending-then-
  settle tests fail - the unit suite's pending/stillness/boundary cases and
  the end-to-end integration case - while every byte-identical and stillness
  test stays green.
- `reopen`'s pending-only guard removed: the boundary test fails with the
  settled note rebuilding to different bytes at a boundary - the ADR 0048 §1
  violation the guard exists to prevent, in the assertion's own words.
- Both fixes stashed (old src, new tests, run before the seam redesign): the
  end-to-end integration test failed with the received note literally
  containing `mcp:echo-server - Echoes text back, for testing. - 0 tools` -
  the bug reproduced in its own words - and the pre-existing integration
  cases stayed green, isolating the fix.

## Verified, 2026-09-08

Both suites, run serially against a fresh build:

- Harness: 1835 passed / 25 skipped - the 1818 baseline plus the 17 new
  tests, nothing broken. The previously-failing mcp-flue case passes with
  the middleware seam, and the new end-to-end case passes with it.
- Client: 892 passed, the baseline exactly.

Lint and typecheck clean; all temporary instrumentation removed (verified
by grep - nothing in src or tests references the diagnostic markers, and the
three files that carried them show no diff at all).
