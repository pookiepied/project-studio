# ADR 0022 — A Network Effect Is A Destination, And What Comes Back Is Untrusted

**Status:** accepted
**Closes:** `C-10`.
**Builds on:** ADR 0015 (approval scope), ADR 0019 (running a chosen program), ADR 0020 (the effect table).
**Delivers:** `fetch` and `web_search`, and the rule every future networked tool follows.
**Amended by:** ADR 0025 (provenance is now `author`), by `C-17` — for a
loopback destination the resource is host *and* port — and by ADR 0026, which
says who is treated as having chosen a redirect and requires the resolved
address to be pinned.

The mechanism for that shipped in Phase 11. `destinationResource` in
`src/net/destination.ts` returns `host` for a public destination and
`host:port` for a loopback one, and `classifyHostPort` names *why* a
destination is refused — `public`, `loopback`, `private`, `metadata`,
`own-port` — rather than answering yes or no.

**`C-17` is now answered, and what `fetch` can reach did not change.** The guard
follows who wrote the address. A model that produced a URL inside a turn gets
what this ADR always gave it, with one relaxation: **loopback is allowed and
goes through the normal approval ladder**, with host *and* port as the resource.
A person who typed an address into a settings form may also reach their own
private network, because that is a decision they made rather than one a page
persuaded them into.

**`fetch` itself is unchanged.** It refuses every non-public address still — not
by this policy, but because it reads a page through a service that is not on this
machine and cannot serve one. That is a limit of one transport, written as its
own check so it is never mistaken for a judgement about the address.

**Two classes are refused whoever asked.** `own-port` is a port this process
listens on: reaching our own control plane is escalation, not fetching, and a
person typing it has misunderstood rather than decided. `metadata` is a cloud
instance's credential service, split out of `private` at the moment `private`
became reachable for somebody — no decision a user can make turns that endpoint
into a legitimate destination.

## Context

`network` was the one effect in `contracts/effects.ts` no tool had ever
declared. `fetch` has been blocked on it since Phase 10 opened, under a phrase
that was never written out: *"SSRF is not containment."*

The obvious move was to reuse ADR 0019's line — provenance decides, native runs
by consent, connected servers are refused. It is symmetrical, and it is wrong,
because the two effects fail in different places.

`execute` risks **the machine**. The user chose the program, containment is the
missing thing, and consent is a coherent answer to that.

`network` risks **the context window**. A fetch pulls text we did not write into
a prompt that drives tool calls. The hazard is what the response *says*, not
what the request reached. A user approving `fetch https://docs.example.com` is
not approving the instructions printed on that page, and no permission dialog
can make them.

Blocking loopback, link-local, and private ranges is still worth doing. It stops
the agent reaching our own internals, which is a real class of accident. It is
not containment, and it does nothing about the bytes that come back.

## Decision

Two rules, addressing two different problems. Neither substitutes for the other.

### 1. The resource is the destination host

A network capability is admitted natively, exactly like `git` and `shell`, and
its **resource is the host** — `fetch:docs.example.com`. The approval ladder and
the grant store then work with no new machinery, because they already decide on
a resource string:

```
git:push          the subcommand
shell:node        the program
fetch:example.com the host
```

Consequences that fall out for free, rather than being designed:

- "Always allow this site" is a grant like any other, scoped to a project by
  ADR 0021.
- No wildcard host is ever offered, for the reason ADR 0015 offers no `git:*`.
- The host is derived by our code from the parsed URL, never taken from a
  model-supplied field. A destination the model can spell is a destination the
  model can widen.
- Requests to loopback, link-local (`169.254.0.0/16`, which includes the cloud
  metadata endpoint), and private ranges are refused before the permission
  question is asked. They are not offered and cannot be granted.
- The refusal happens **again after DNS resolution and on every redirect**. A
  public name that resolves to `127.0.0.1`, or a 302 pointing there, is the
  ordinary shape of this attack, and a check performed only on the typed URL
  misses both.

### 2. Everything that comes back is untrusted content

A network result is marked as untrusted where it enters, and that mark carries
three rules:

1. It is never the source of a path, a command, an argument, or a URL for a
   following call.
2. It can never widen a scope, approve anything, or satisfy a permission.
3. It is labelled in the transcript as retrieved content, so the model is told
   what it is reading rather than left to infer it.

**Rule, not machinery, in this ADR.** Enforcing 1 automatically means tainting
strings through the whole tool path, and that is a large build whose value we
cannot yet measure. What ships now is the boundary and the label. If a real case
appears where the model acts on fetched instructions, the machinery is the
answer, and this ADR is where it will be recorded.

## What this refuses

**`allowNetwork` as the permission mechanism.** The flag exists and stays,
exactly as `allowExec` does: it is an operator's off switch, answering "may this
agent reach the network at all". It is not an answer to "may it reach *this
host*", and it says nothing whatever about the response. Treating one boolean as
the permission model is the mistake this ADR is written to prevent — the flag is
the outer gate, the destination is the decision, and rule 2 is the part neither
of them covers.

**A blocklist of bad sites.** It cannot be kept current and it makes the absence
of a block read as an endorsement.

**Silent network access at any mode.** Full Auto resolves a *default* ask, never
a policy one, and `network` is a policy ask — the same invariant ADR 0018 set
for a connected server running code.

## Effect table

`network` keeps `isolation: in-process` and gains no undo point: a request is
not a local change and there is nothing to restore. It is **not** allowed while
a folder is untrusted, and it is **not** silent at any mode.

## Consequences

- `fetch` and `web_search` both declare `network` and nothing else. Neither
  writes, so neither takes a snapshot.
- Every future networked tool — MCP over HTTP in Phase 11, connectors later —
  inherits the destination rule without a second decision.
- One open cost: a page fetched through a reader service has its destination
  read by that service. That is ADR 0023's problem, not this one, and it is
  argued there.
