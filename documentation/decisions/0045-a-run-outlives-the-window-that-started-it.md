# ADR 0045 — A run outlives the window that started it

**Status:** Accepted · 2026-08-24
**Relates to:**
[ADR 0032](0032-fail-safe-runtime-recovery.md) — states that execution belongs
to Flue, not to a connection. This is the desktop half of it, which had never
been built.
[ADR 0044](0044-the-host-supervises-and-holds-the-credential.md) — the seam
this extends from one request to a stream.

## Context

ADR 0032 decided this in principle:

> The client connection is not the owner of execution. A request may
> disconnect after admission, and a Harness process may disappear while a
> submission is running. Recovery must therefore be defined by durable
> ownership and reconciliation rather than by the lifetime of an HTTP request
> or UI process.

Nothing in the desktop app implements it. `service_fetch` is request and
response; the webview holds no offset; and `shutdown_all` hard-kills the
Harness, so **every ordinary quit takes 0032's unexpected-termination path**.

The temptation at this point is to add a retry, a reconnect, and a
"reconnecting…" spinner — the machinery you build when work is not durable.
Before building any of it we read what Flue already provides.

### What Flue already provides

The agent conversation surface is four routes:

| | |
|---|---|
| `POST /agents/:name/:id` | submit a turn |
| `GET /agents/:name/:id` | read the stream |
| `HEAD /agents/:name/:id` | metadata only — the current offset, no body |
| `POST /agents/:name/:id/abort` | abort |

`GET` is a full Durable Streams reader, not a pipe: a reduced snapshot with no
parameters, `?offset=<x>&live=sse` or `&live=long-poll` to resume, `?tail=`
for the end. Responses carry `Stream-Next-Offset` and `Stream-Up-To-Date`.

Underneath is a SQLite-backed event store whose append is idempotent under a
caller-supplied key (`appendEventOnce`): an exact retry returns the original
offset rather than duplicating the event.

**So the resume offset ADR 0032 promised exists, is durable, and survives a
Harness restart.** What was missing was a client.

## Decision

**A run is addressed, not held. The desktop app re-reads it; it does not keep
it alive.**

### 1. The conversation id is ours, so there is nothing to discover

`:id` is chosen by the caller. The UI already stores conversation ids because
it lists conversations, so after any interruption — a reload, a Harness crash,
a second window — reattaching is:

```
GET /agents/:name/:id?offset=<last seen>&live=sse
```

**There is no "what is in flight?" question, and therefore no endpoint for it
and no local run bookkeeping.** This was the part of the design we expected to
be hard. It is absent instead, and that is worth stating plainly so nobody
adds it back.

### 2. Streaming crosses the seam as a channel, carrying an offset

`service_stream(service, path, init, offset)` mirrors `service_fetch` from ADR
0044 — Rust resolves the address, attaches the credential, and the webview
names neither. Events arrive over a Tauri `Channel<T>`; the current offset
comes back with them, because a stream whose consumer cannot say where it
stopped cannot resume.

SSE rather than long-poll. Token streaming is the visible product and a
round-trip per batch would show. `live=long-poll` remains the fallback if
channel lifetime across restarts proves worse than the latency — same server,
same offsets, one flag.

### 3. Quit drains; it does not kill

Stop admitting, wait for a turn boundary with a short bound, then terminate.
The bound matters more than its exact value: a drain that waits forever is a
window that will not close.

Durable append means a hard kill loses only the in-flight model call, never the
record. So this is about not leaving a partial turn for the next launch to
reconcile — not about data loss.

### 4. A crash restarts once, visibly

Reattach is a `GET` with an offset, so restarting is now safe in a way it was
not before. Once, with the UI told; the client re-reads from its last offset. A
second failure inside a short window stops and shows the error.

**Restart-on-crash without reattach would have lost work faster**, which is why
this could not be built in either order.

### 5. A dead window cancels nothing

Closing a window, reloading the webview, or crashing the UI does not abort a
run. `POST .../abort` exists and is the only thing that means abort. This is
0032 restated because it is the rule most likely to be broken by someone adding
a convenient cleanup path.

## Consequences

- **`subscribe()` is in-process only** — the store's own contract says
  cross-process delivery is adapter-dependent and outside it. A Harness restart
  therefore drops live subscriptions and the client must re-read by offset.
  That is what the client does anyway, so the limitation costs nothing; it is
  recorded so nobody builds on a subscription surviving a restart.

- **The webview holds one durable thing per conversation: an offset.** Not a
  connection, not a run handle, not a subscription. Everything else is
  re-derivable from the id and that number.

- **`HEAD` makes "is there anything new" nearly free**, which is what lets a
  cold start be a snapshot rather than a replay of every event.

- **Idempotent append changes what a retry means.** A resubmitted turn under
  the same key is the same turn, so submission retries are safe in a way that
  ordinary POST retries are not. Any retry we add must carry the key, or it is
  a duplicate wearing a retry's clothes.

- **Streaming is where the ADR 0044 seam earns itself.** `service_fetch` and
  `service_stream` differ in shape but not in who holds the credential. Had the
  bearer been in the webview, this would be two credential paths instead of
  one.
