# ADR 0027 — A Failed POST Is The Answer, And A Remote Server Has No `stderr`

**Status:** accepted
**Closes:** `L-03`. **Settles the HTTP half of:** `C-16`.
**Builds on:** ADR 0026 (the direct HTTP client) and the channel seam in
`src/extend/mcp/connection.ts`.

## Context

`McpConnection` expects a duplex stream of newline-delimited JSON: send a line,
and one day a line comes back. `StdioChannel` gives it exactly that, because a
child process is exactly that.

Streamable HTTP is not. It is a series of POSTs, each answering with either one
JSON body or an event stream carrying several, and each carrying HTTP's own
vocabulary of failure on top of JSON-RPC's. `HttpChannel` exists to turn the
second shape into the first.

The seam held: nothing above the channel changed, and the handshake completes
over HTTP with no HTTP-shaped special case anywhere in it. Two questions had no
obvious answer, and both are places where the channel does more than move bytes.

## Decision

### 1. A failed exchange is answered on the transport's behalf

When a POST carrying request *N* comes back `502` — or any other non-2xx, or an
answer past the size ceiling — the channel synthesises a JSON-RPC error response
for *N* and hands it up as though the server had sent one.

The alternative was to record the status as a diagnostic and stop. That is
strictly more honest and much worse: **no separate response is ever coming in
this transport**, so the request would wait out the full thirty-second timeout,
and a server answering `502` on every call would present as calls timing out one
by one with the real reason only in a log.

The justification is narrow and worth stating so it is not stretched. In a
request/response transport the HTTP status **is** the answer to what that
request carried. Translating it into the vocabulary of the layer above is this
file's entire job; it is not the channel deciding anything about the protocol.

Two limits keep it that way:

- **The code is `-32000`**, outside the `-32020`..`-32099` band the era probe
  reads. A transport failure can never be mistaken for a server refusing a
  protocol version.
- **A notification gets no answer.** No id, nothing waiting, nothing invented —
  exactly as when it succeeds. The test asserts the *absence*: no message the
  connection could not place.

### 2. A timeout refuses one call; unreachable ends the channel

A slow answer is one call going badly and the server is still there. A server
that cannot be reached at all is the connection being over, and ending it is
what lets the supervisor back off and retry rather than every later call failing
the same way.

### 3. `onStderr` carries the transport's complaints

A remote server has no `stderr`. The method still exists, because the channel
interface has it, and an empty implementation was the obvious reading.

It is the wrong one. `send` cannot throw — it returns before the answer arrives,
which is what a duplex channel does — so with an empty `onStderr` a failed
exchange would leave no trace anywhere. `connection.diagnostics` is where a
failure goes to be quotable by whatever reports it, and a transport complaint is
precisely that.

So the channel reports its own: the status a server answered, an answer past the
ceiling, a body that could not be read. Not a substitute for the server's own
diagnostics, which do not exist here — a use of the same slot for the only
diagnostics this transport has.

### 4. Sessions are read, never configured

`Mcp-Session-Id` is captured from **any** answer that carries one and echoed on
every later request, including the `DELETE` that ends it. A `404` once a session
exists is the specified way a server says the session is gone, and it ends the
connection.

The modern era removed sessions entirely, so for a modern server this stays
unset and nothing is ever sent. That is why it is read from the response rather
than being a field on the server record: a field would have to be set correctly
per era by whoever added the server.

### 5. The `DELETE` on close is not waited for

The session is over on our side either way. A server that ignores the request or
has already gone must not hold us there; the request is a courtesy that lets a
server release what it was holding.

## What this does not change

- **HTTP+SSE is still never implemented** — `C-16`. That is the older
  two-endpoint transport, deprecated in the revision this client adopts.
- **No address handling moved here.** `net/http.ts` judges the destination, pins
  the address, and re-judges redirects. A transport with its own copy would be a
  second place the rebinding rule could be got wrong.
- **The secret is still never stored.** It is read from the credential store by
  the caller, held for as long as the channel lives, and sent as a header —
  the same rule the stdio channel applies to a secret in the child's
  environment.

## Consequences

- `requestDirect` became a wrapper around a new `requestStream`, which returns
  the response with its body unread. An event stream has to be acted on as it
  arrives, and a ceiling applied by the reader would have to buffer the whole
  stream to count it. One judge-and-pin path, two ways to read the result.
- Verified by breaking each rule: the event-stream decoder fails 2 tests, the
  session echo 1, ending on unreachable 1, the synthesised answer 1, the ceiling
  1, and the notification guard 1 — that last one only after an assertion was
  added, because the guard was initially untested and a guard no test can fail
  is a guard nobody will notice breaking.
