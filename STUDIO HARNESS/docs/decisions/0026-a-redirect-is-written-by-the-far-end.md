# ADR 0026 — A Redirect Is Written By The Far End

**Status:** accepted
**Amends:** ADR 0022 — "a network effect is a destination". This decision says
which destinations a *client* may follow to, and who is treated as having
chosen them.
**Depends on:** `C-17`, which made the destination guard follow the URL's author.

## Context

`C-17` settled that a destination is judged against **who wrote the address**. A
person typing a host into a settings form may reach their own network; a model
producing one inside a turn may not. That answered the question for an address
that arrives from one of our own surfaces.

Building the direct HTTP client (`src/net/http.ts`, loose end `L-02`) raised a
third author the policy had never been asked about: **the server on the other
end.** A `Location` header is an address, it arrives inside a request the user
started, and if it is followed it becomes a real connection.

Until now the question could be avoided. `retrieval/http.ts` reads pages through
a service, sets `redirect: "manual"`, and refuses any redirect outright, because
its endpoints are fixed and a redirect from one is a misconfiguration. A client
that reaches a host the *user* chose cannot do that — redirects to a canonical
host and to a trailing slash are ordinary there.

## Decision

### 1. A redirect is judged as though a model chose it

Whatever the caller's `author` was, every hop after the first is judged with
`author: "model"` — the stricter side of the `C-17` table.

The user chose the first address. They did not choose the second one, and the
party that did is the party we have the least reason to believe. A user-authored
request to a public host that answers `302 → http://10.0.0.5/` is refused, and
that is correct: the person asked to reach the public host.

The cost is real and accepted. A user-authored request to a private host that
redirects *within* that private network is refused too, even though the person
would have been allowed to type the second address themselves. That case is rare
— it is not how an MCP endpoint behaves — and the alternative is a rule where
one allowed address launders authority onto every address it can name.

### 2. Credentials do not cross an origin

`authorization`, `cookie`, and `proxy-authorization` are dropped when a redirect
changes host. Other headers are the caller's intent and survive.

Following a redirect with the credentials meant for the first host hands them to
the second, and the second was chosen by the first. Every HTTP client that has
leaked an API key has leaked it this way.

### 3. The address is pinned, and every address is judged

The name is resolved once, **every** address the resolver returned is judged,
and the socket is opened to the address that was judged — not to the name.

Two halves, and both are needed:

- Judging a name and then letting the connection resolve it again is DNS
  rebinding written as a race. The check and the socket ask the same question
  twice and may get two different answers.
- Judging only the address that will be used lets a name that answers with one
  public and one refused address through by chance of ordering.

The name is not discarded. It travels as the `Host` header, and as the TLS
`servername` so the certificate is still verified against what the caller asked
for.

### 4. `judgeHostPort` is the one copy of the policy

The policy previously lived inside `judgeDestination`, which takes a URL. An
address has no URL around it, so the client needed the same rule applied to a
host and a port. Split out rather than restated: a name that passes and an
address that is never judged is exactly the hole this ADR exists to close, and
two copies of a rule is how one of them stops being maintained.

### 5. Destination and connection failures report as `network`

A new error domain. `DestinationError` reported as `retrieval` when page reading
was its only caller, and that stopped being true the moment MCP over HTTP and
connectors needed the same judgement. "That address is refused" and "Tavily says
your plan is used up" are different situations with different answers.

## What this does not change

- **`fetch` is still public-only.** Not by this policy — because it reads
  through a service that is not on this machine. That check keeps its own
  comment saying it is a limit of one transport, so it is never mistaken for a
  judgement about the address.
- **Allowed is still not approved.** Nothing here grants anything. Every
  destination still goes through the kernel with the resource `C-17` returns.
- **`metadata` and `own-port` are still refused whoever asked.** A redirect
  cannot reach them and neither can a person.

## Consequences

- `src/net/http.ts` is the only place the harness opens an outbound connection
  itself, which is what makes these rules enforceable in one file rather than
  restated per caller.
- Streamable HTTP for MCP (`L-03`) is unblocked and inherits all of it.
- Verified by breaking each rule in turn: removing the per-address judging fails
  3 tests, removing the redirect author change fails 1, removing the credential
  strip fails 1, removing the size ceiling fails 1.
