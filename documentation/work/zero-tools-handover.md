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
