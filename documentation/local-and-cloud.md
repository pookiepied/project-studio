# STUDIO Away From The Machine

**Status:** a plan with an argued critique. **Not a decision, and not scheduled.**
No ADR follows from this yet and nothing in Phase 11 depends on it.

Raised by the owner on 10 August 2026 and simplified the same day, from "should
the whole system run in the cloud" down to something much more concrete. This
file records the concrete version, what is strong about it, the one part that is
not, and the naming problem.

---

## The plan, as described

A **separate repository**, Cloudflare-based, with its own workers:

- an API worker (`api.example.com`)
- an authentication worker — accounts, sign-in
- a gateway worker
- a primary worker holding a small agent loop
- a database worker, with object storage for files

It holds notes, tasks, conversations, full transcripts, and usage tracking. In
STUDIO's settings there is a remote-server section: connect an account if you
have one, and instructions if you do not.

A **web front end** on top of it, mainly for reading and working with notes,
tasks, and transcripts.

**The relay is the important part.** From the web app you pair with your own
machine — a code on screen, scanned or entered — and from then on the phone or
browser is a *window*. The machine does the work. The desktop stays the place
where the agent actually runs.

**A cloud-only conversation** is also possible when the machine is off: a small
agent loop with web search, image and video generation, and coding through a
GitHub Codespace rather than a local sandbox.

**Two traffic paths, tracked separately** — usage from the desktop shows as
STUDIO, usage from the browser shows as STUDIO Web. Connectors are authorised in
each place separately.

**No bring-your-own-key on the web.** It uses the deployment's own provider
keys, because the operator does not want other people's keys in their system.
Access is whitelisted rather than open.

---

## The reframe that resolves "does this even make sense"

The owner's own doubt is the most useful thing in the brief: *"why do you have a
complete product and a separate version only for Cloudflare... it looks really
weird."*

It looks weird when compared to ChatGPT, and the comparison is the problem.
**ChatGPT's product is the cloud.** Desktop, web, and mobile are three windows
onto one service, so a "local version" would be the odd accessory.

This is inverted. **The product is the machine.** The cloud is an accessory. Once
that is said out loud, the design stops being unusual and starts being a
well-worn pattern:

| Product | Local thing | Paid/hosted accessory | Nobody calls it half-built |
|---|---|---|---|
| Home Assistant | runs in your house | Nabu Casa: remote access, a public endpoint | correct |
| Obsidian | local files | Sync, and Publish | correct |
| Plex | your server, your disks | account, relay, discovery | correct |
| Tailscale | your devices | coordination, not traffic | correct |

**Home Assistant plus Nabu Casa is the closest match**, and it is the one to
copy the *framing* from: the software is free and local, and the hosted part
exists for the two or three things that genuinely need a public address —
remote access, and a place to reach when the house is unreachable.

So the answer to "does this make sense" is yes, on one condition: the cloud must
be describable in a sentence that begins *"so that you can…"* and does not
contain the word "also".

Good: *"so that you can reach your own machine from a phone, and read your notes
when it is off."*

Bad: *"it also has an agent loop."*

---

## What is strong

**The relay.** It is the best idea in the brief and it is the one that needs no
compromises. The machine holds the keys, the grants, the shadow repository, the
sandbox, the MCP servers, and the undo history. Nothing moves. The phone gets a
window. Every hard question in the earlier draft of this document — where do
credentials live, who owns a connector, what is the source of truth — simply does
not arise, because nothing was duplicated.

**A separate repository.** Correct, for reasons beyond taste. It is a different
runtime (Workers, not Node), a different threat model, a different release
cadence, and a different licence conversation. It also means **a forker can
ignore it entirely**, which matters for an open-source project whose users
mostly will.

**Separate traffic and separate connector authorisation.** This matches the
position already argued and kept below: if the cloud ever acts, it acts as its
own installation with its own consent and its own audit trail. Borrowing the
desktop's Gmail token would move ownership silently. Authorising twice is the
honest cost of two places, and the owner arrived at it independently.

**Notes, tasks, and transcripts in the cloud.** These are portable by nature.
They are re-creatable, they hold no execution state, and they are exactly what a
person wants on a phone.

---

## What is weak, and it is one thing

**The cloud-only agent loop.**

Everything awkward about the plan comes from this single feature, and removing it
does not weaken anything else.

- **It creates a second product.** A weaker agent, with different tools, different
  limits, and different failure modes, that users will compare to the real one
  and find worse. Every support question becomes "which one were you using".
- **It creates a second implementation of rules that already exist here.** The
  permission kernel, the effect table, the destination guard, the untrusted-content
  handling. Two implementations of a security rule is the shape of `S-03` and
  `S-04`, both of which were cases where *one* implementation was quietly wrong.
- **It is what forces managed API keys**, which is the largest commitment in the
  whole brief and is a business decision wearing technical clothes. Running other
  people's inference on the operator's keys means paying for abuse, rate-limiting
  strangers, and answering for what the model produced. A whitelist reduces the
  volume; it does not change the category.
- **It is what makes the thing look half-built**, because a small agent that can
  do a few things is exactly the "extra weird version" the owner is reacting to.
  The relay, on its own, is not weird at all.

**The recommendation:** ship the relay and the store. Leave the cloud loop out of
version one entirely. If the demand is real, it arrives as a request for "let me
start something while my laptop is shut", and at that point the honest answer may
well be a **hosted installation** — the actual harness, running for one user, in
one container — rather than a second smaller agent. That is a different and much
better shaped product, and it reuses everything instead of duplicating it.

Codespaces for coding is a good instinct and belongs to that later conversation,
not this one: it is the same idea — *rent a real machine* — applied to one tool.

---

## What holds regardless, from the earlier analysis

These were argued before the plan was simplified and are unaffected by it.

**Split on durability, not on capability.** The cloud holds what is portable and
re-creatable. It does not hold what runs.

**Credentials do not sync, and that is a feature.** A provider key lives in the
OS credential store, never in a database column, and a migration guard enforces
it. Syncing that column is the same rule broken in a new place. Re-entering a key
on a second device is the correct amount of friction for a thing that spends
money, and it means a compromised cloud account is not a compromised set of keys.

**Grants do not sync either.** A grant records a decision a person made about one
machine. Copying it moves the decision somewhere the person was not.

**One meaning, one place.** If the same fact is authoritative in two places, they
will differ — not might, will — and configuration that spawns processes and holds
secrets has no good merge rule.

### Ownership, by kind

| Thing | Owner | In the cloud? |
|---|---|---|
| Conversations, transcripts, notes, tasks | portable | yes |
| Memory and its vectors | portable, and re-derivable | yes |
| Which providers are configured | portable | the *list*, never the secret |
| Provider API keys | the machine that uses them | no |
| Permission grants | the machine that granted them | no |
| Connectors and their tokens | the installation that authorised them | only its own |
| Local MCP servers | the device | configuration may sync; the process cannot |
| Remote MCP servers | portable configuration | the URL, not the secret |
| Skills | files, portable | yes |
| Shadow repository, undo history, sandbox | the device | no |

The line is not "sensitive versus not". It is **can this be meaningfully
re-created somewhere else.** A conversation can. A running process cannot.

---

## The relay needs saying properly, because it is the whole thing

Sketched, not designed. Written down so the security shape is not invented under
deadline.

- **Pairing is a consent event**, like installing an MCP server. A code shown on
  the machine and entered elsewhere, short-lived, one use, and revocable from the
  machine.
- **The cloud must not be able to act on its own.** It carries requests to a
  machine that decides. If the coordination service is compromised, it should be
  able to deliver nothing the machine would not have accepted from its own user.
- **Approvals happen where the machine is, or not at all.** A permission dialog
  answered from a phone is answerable by whoever has the phone. That is a real
  decision and it should be made deliberately.
- **End-to-end, so the relay carries what it cannot read**, if this is to be
  hosted by the operator for other people. Otherwise every conversation passes
  through a server in readable form and the local-first claim is only true of
  storage.
- **The machine is not always on.** The window must show what is available and say
  plainly what is not, rather than hanging. That is the same rule as `003.7`:
  honest silence is not silence.

---

## Naming

The owner is right that this is unresolved and that it matters. The name is doing
product work: it is what makes the accessory read as an accessory.

**"STUDIO Cloud" is the weakest option**, and it is the one that creates the exact
impression the owner disliked. "Cloud" implies the product runs there, which sets
up the ChatGPT comparison and invites "so which one is the real one".

| Name | What it promises | Verdict |
|---|---|---|
| STUDIO Cloud | the product, in the cloud | overclaims; causes the confusion |
| STUDIO Link | connects you to your machine | says what it does |
| STUDIO Relay | carries messages | accurate, slightly technical |
| STUDIO Sync | copies your data | undersells the relay |
| STUDIO Remote | control from elsewhere | clear, slightly cold |

**Recommendation: STUDIO Link**, with the web application as **STUDIO Web**.

- It describes the accessory honestly — it links a phone to a machine and keeps a
  copy of what you read.
- It cannot be mistaken for "the hosted version of the product".
- It survives the later decision: if a hosted installation ever ships, that one
  can be **STUDIO Hosted** or **STUDIO Server**, and the three names stay
  distinct instead of fighting over the word "cloud".

The repository can be `studio-link`. The domain does not need to say "cloud" at
all.

---

## What would change this position

- **A hosted installation being wanted.** Not a smaller agent — the real harness,
  for one user, in one container. That is a better answer to "my laptop is off"
  than a second loop, and it changes the plan from accessory to product line.
- **Team or multi-user use.** Nothing above was reasoned about with two people
  sharing a conversation, and that changes ownership completely.
- **Remote MCP becoming the common case.** The device-bound argument weakens a
  great deal if most servers are hosted.

---

## Where this sits

**After Phase 11, and after Phase 13.** The relay needs the capability seam that
subagents need anyway, and building it earlier means designing that seam twice.

One habit worth keeping in the meantime, at no cost: **do not add a column, a
store, or an identifier that assumes one machine.** Anything that becomes
portable later needs an identity that was not derived from a filesystem path or a
process id. Cheap habit, expensive migration.
