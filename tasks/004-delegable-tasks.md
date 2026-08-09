# Task 004 — work that can be done alongside the main line

> **All six are done, reviewed, and merged.** See `tasks/DELEGATION-LOG.md` for
> what review changed. This file stays as the record of what was asked for, in
> the same way an ADR stays after the decision is made.


Six independent pieces. Each one is a **leaf**: it has no callers yet, it
imports almost nothing, and I will wire it in when I reach it. That is what
makes them safe to run while the spine, the grant lifecycle, and the MCP
transport are being built here.

**Give out one at a time.** Each has a branch of its own, created from `main` by
the delegate, and merged by the reviewer — `tasks/README.md` has the rule. They
do not depend on each other and can land in any order.

**Every finished task gets an entry in `tasks/DELEGATION-LOG.md`**, written
after review. That log, not this file, is the record of what actually happened.

**Every one of them starts the same way:**

> Read `tasks/HOUSE-RULES.md` in full, then read the section of
> `tasks/004-delegable-tasks.md` named below, and do exactly that section.
> Nothing else.

---

## Where these files go

All six land under `STUDIO HARNESS/src/extend/mcp/wire/`, with tests in
`STUDIO HARNESS/tests/unit/`.

`wire/` is the layer that knows the *shape* of the protocol and nothing about
policy. Nothing in it may import from `src/permissions/`, `src/tools/`,
`src/sandbox/`, or `src/storage/`. If a task seems to need one of those, it has
been misjudged — say so rather than importing it.

**Do not create or edit any file directly at `src/extend/*.ts`.** That is the
spine, it is being written on the main line, and it is the one place a collision
would actually hurt.

---

## 004.A — Newline-delimited JSON framing

**Branch:** `task/004-a-ndjson-framing`
**File:** `src/extend/mcp/wire/framing.ts`

An MCP server on stdio sends JSON messages separated by newlines, over a stream
that arrives in arbitrary chunks. A message can be split across three chunks, or
three messages can arrive in one chunk, and a newline inside a JSON string is
not a separator.

Build a decoder that takes chunks and yields complete messages.

Requirements:

- Feed it a `string` or `Buffer` chunk; it returns the messages completed by
  that chunk, and keeps the remainder.
- A message split across any number of chunks is reassembled.
- Several messages in one chunk all come out, in order.
- Multi-byte UTF-8 split across a chunk boundary must not be corrupted. Decode
  bytes with a streaming decoder, not `chunk.toString()` per chunk.
- Empty lines are skipped, not treated as messages.
- Both `\n` and `\r\n` terminate a line.
- A line that is not valid JSON does **not** throw and does not kill the stream.
  It is reported as a malformed message, and decoding continues — a server
  writing one bad line must not take the connection down.
- **A maximum message size.** Pick a sane default, make it an option, and when a
  single line exceeds it the buffer is dropped rather than grown forever. A
  server that never sends a newline must not exhaust our memory.
- An encoder for the other direction: one message to one line.

The decoder is a class or a closure holding the remainder. It does no I/O — it
is fed chunks and returns values, which is what makes it testable without a
process.

Tests must cover every bullet above, including the multi-byte split and the
oversize drop.

---

## 004.B — JSON-RPC 2.0 message shapes

**Branch:** `task/004-b-jsonrpc`
**File:** `src/extend/mcp/wire/jsonrpc.ts`

Types and guards for JSON-RPC 2.0, which is what MCP speaks. No transport, no
correlation, no state — that is 004.C.

- Types for a request, a notification, a success response, and an error
  response. A notification is a request with no `id`, and the type system should
  make that distinction rather than a comment.
- An `id` may be a string or a number, and `null` is not a valid request id.
- Guards that narrow an `unknown` parsed value into one of those four, with no
  casts.
- The reserved error codes as named constants: `-32700` parse error, `-32600`
  invalid request, `-32601` method not found, `-32602` invalid params, `-32603`
  internal error.
- MCP reserves `-32020` to `-32099` for itself. Add a predicate that says
  whether a code is in that range, and one named constant, `-32022`
  `UnsupportedProtocolVersion`.
- A helper that builds an error response from an error code and message.

`valibot` is already a dependency and is used elsewhere for validation. Use it
if it fits; do not add anything else.

Tests: each guard accepts what it should and rejects what it should, including
the awkward ones — `id: null`, a response with both `result` and `error`, a
response with neither, a missing `jsonrpc` field, `jsonrpc: "1.0"`.

---

## 004.C — Request correlation

**Branch:** `task/004-c-correlation`
**File:** `src/extend/mcp/wire/pending.ts`

Sending a request means waiting for a response with a matching id, and every
failure mode here is a leak.

Build a registry that:

- Issues the next id. Ids are unique for the life of the connection.
- Registers a pending request and returns a promise.
- Settles it when a response arrives, resolving on `result` and rejecting on
  `error`.
- **A response for an unknown id is ignored, not thrown.** A late response to
  something already timed out is normal, not exceptional.
- Times each request out on its own deadline, rejects, and **removes the
  entry** — a timed-out request that stays in the map is a leak, which is the
  defect this module exists to prevent.
- Supports an `AbortSignal` per request, with the same removal.
- Has a `rejectAll(reason)` for when the connection dies, which settles
  everything outstanding and empties the map.
- Reports how many are outstanding.

After every terminal path — resolve, reject, timeout, abort, rejectAll — the map
must be empty. Assert that directly in the tests; do not infer it.

No MCP types. This is about ids and promises.

---

## 004.D — Retry backoff

**Branch:** `task/004-d-backoff`
**File:** `src/extend/mcp/wire/backoff.ts`

A server that fails to start is retried, and a server that fails forever must
stop being retried.

A pure function from attempt number to a delay, plus a give-up rule.

- Exponential, with a base delay, a multiplier, and a **maximum delay** so it
  cannot grow without bound.
- **Full jitter**: the delay is a random value between zero and the computed
  ceiling. Without jitter, everything that failed together retries together.
- The random source is injectable, so tests are deterministic. Default to
  `Math.random`.
- A maximum attempt count, after which the answer is "give up" rather than a
  number. Return a discriminated union, not `-1` or `null`.
- Every option has a sensible default and the defaults are named constants with
  a comment saying why that number.

Tests: bounds hold for attempts 0 through 20, the ceiling is respected, an
injected random of 0 and of 1 give the two extremes, give-up happens at exactly
the right attempt, and the delay is never negative or `NaN`.

---

## 004.E — The connection lifecycle state machine

**Branch:** `task/004-e-lifecycle`
**File:** `src/extend/mcp/wire/lifecycle.ts`

The design is already decided and is in `tasks/003-phase-11-work-plan.md`
section 003.3a. Implement exactly that. Do not redesign it.

```
idle -> starting -> ready -> stopping -> idle
          |           |
          v           v
        failed <------+     (with backoff, and a give-up state)
```

- A union type for the state, not an enum and not a string.
- One transition function: state plus event gives the next state.
- **An illegal transition is refused, not ignored.** `ready` cannot follow
  `stopping`. `starting` cannot be entered twice. Those are the bugs that leave
  two processes running for one server.
- Refusal is a returned result, not a thrown error — the caller decides whether
  an illegal transition is a crash or a logged mistake.
- The `failed` state carries the attempt count, so 004.D can be asked what to do
  next. It does **not** import 004.D; it holds a number.
- A `given-up` state that nothing leaves except an explicit restart.

No timers, no processes, no I/O. This is a function and a type.

Tests: every legal transition, and every illegal one refused. Write the legal
set as a table and assert every pair not in it is refused, so a new state cannot
be added without deciding its transitions.

---

## 004.F — A stable hash of a tool definition

**Branch:** `task/004-f-definition-hash`
**File:** `src/extend/mcp/wire/definition-hash.ts`

An approval is given after a person reads a tool's name, description, and input
schema. If any of those change, the approval was for something else. Item 003.4
stores this hash on the grant; this task is only the hash.

- Input is name, description, and an input schema object.
- Output is a hex string from `node:crypto`, SHA-256.
- **The same definition must hash the same however the JSON keys are ordered.**
  Serialize with keys sorted recursively, through arrays and nested objects.
  Array *order* is meaningful and must be preserved; object key order is not.
- `undefined` and a missing key hash the same. `null` is a value and does not.
- Changing name, description, or any part of the schema changes the hash.
- Whitespace inside a description is significant. Do not normalize it — a
  description is what a person read.

Tests: key reordering at three nesting levels gives one hash; array reordering
gives a different one; each of the three inputs changing gives a different one;
and the hash is stable across runs, asserted against a literal you commit.

---

## What is deliberately not here

**Anything touching `src/permissions/`, the grant store, or `CallGate`.** Those
decide what runs. They stay on the main line.

**The local HTTP client.** It looks like a leaf and is not: it is where the
loopback policy in `C-17` gets decided, and a policy decided by its first
implementer is a policy nobody agreed to.

**Anything under `src/extend/*.ts`.** That is the spine.
