# Check Later

Things deliberately deferred, with enough context to act on without the
conversation that produced them. Not a bug list — `STUDIO HARNESS/docs/KNOWN-ISSUES.md`
is for what is currently untrue about the system. This is for what we chose not
to resolve yet.

Each entry says what to check, what a pass looks like, and what it gates. When
an entry is settled, record the answer in the relevant ADR and cut this entry
down to a pointer — keep the pointer rather than deleting outright, so a
question that was asked and answered does not get asked again from scratch.
`C-07` is the model.

Numbered in the order they were raised, which is not the order they are listed
in. Do not renumber; the ids are referenced from `KNOWN-ISSUES.md` and the ADRs.

---

## C-01 — Measure Pi's cache-breakpoint placement

**Status:** open. **Gates:** how much we trust Flue/Pi vs. needing an escape hatch.

Pi's published design places breakpoints after the system prompt, the tool
definitions, and the latest cacheable conversation content. That matches what we
would have specified. Stated intent is not measured behaviour, and Pi does not
expose breakpoint placement to us — so this is settled with a number, not an
argument.

**The fixture:** a ~20-turn session with several tool calls, one `tool_discover`
expansion, and one compaction.

**Pass:** ≥90% cache hit rate on every turn after the first, and a re-billed
token spike *only* at the compaction boundary.

**If it fails,** escalate in cost order:
1. check whether Pi exposes cache tuning
2. `pnpm patch`
3. upstream PR (Apache-2.0, and Earendil demonstrably cares about this problem)
4. bypass Flue for the request path and drive Pi directly

Do this when the harness can run a real multi-turn session with tools — roughly
after Phase 11 (MCP), since discovery is half of what is being measured.

---

## C-02 — Verify `expandedTools` survives across `prompt()` calls

**Status:** open. **Gates:** correctness of progressive disclosure.

`OperationOptions.tools` is documented as scoped to a single `session.prompt()`
call. Our design (mental-model §3.4) requires the harness to re-pass every
previously discovered tool on every subsequent call, in stable sorted order.

**Check:** capture two consecutive requests after a discovery and diff the
serialized tool arrays. The second must be a superset of the first with
identical ordering for the shared prefix.

**Failure mode if wrong:** silent full cache invalidation on every turn after
the first discovery. Expensive and invisible without measurement — which is why
C-01 and C-02 should be done together.

---

## C-03 — What Flue injects as "discovered workspace context"

**Status:** open. **Gates:** control over our cached prefix.

`AgentRuntimeConfig.instructions` is documented as *"instructions prepended to
discovered workspace context"* — so Flue performs its own workspace discovery
and puts the result in the region we are trying to keep stable and minimal.

**Check:** what it discovers, how large it is, and whether any of it changes
between turns. Anything volatile in there defeats the whole layout.

---

## C-04 — Re-audit vendored binary flags on upgrade

**Status:** standing. **Gates:** nothing; it is a recurring obligation.

ADR 0013 blocks ripgrep's `--pre` and `--hostname-bin` and several git options
because they re-enter an interpreter. Those lists are per program and per
version. A new flag in an upgraded binary that runs a preprocessor is a hole.

**Trigger:** any bump to a binary in `vendor/`.

**The same obligation covers the provider count.** Three documents state "36
built-in providers, 1,072 models" and nothing in our code asserts it, so a bump
to `@earendil-works/pi-ai` changes the true number silently. Task 001 item 19
was two rounds of arguing about 35 versus 36 without anyone running the code.
One line settles it:

```
createModelsCollection({ customProviders: [], credentials }).getProviders().length
```

**Trigger:** any bump to `@earendil-works/pi-ai`.

---

## C-05 — Hash verification before on-demand git install

**Status:** open (tracked as `V-01`). **Gates:** shipping the download path.

Vendoring ripgrep and downloading git on demand is the right split — ripgrep is
small and universally needed, git is large and usually present. But fetching an
executable and running it unverified is the one thing that must not ship.

**Decision already made:** ship ripgrep, download git, verify by hash first.

---

## C-06 — Multimodal is unwired

**Status:** open. **Gates:** image/video/speech capabilities.

The local catalog reports image, video, speech, and transcription as
`unsupported`. Per `STATUS.md` this is not a config gap — Pi's image collection
is not wired up. This is wiring work, not architecture, but it is real work and
it is on the critical path for "general-purpose, not a coding agent."

---

## C-07 — Snapshot scope: ignored files the agent creates

**Settled and shipped.** Everything decided here is implemented in
`STUDIO HARNESS/src/snapshots/` and written up in ADR 0016, which is now the
authoritative account. The rule survived contact unchanged: *the shadow repo
contains the project minus ignored files, plus everything the agent touched.*

One thing the implementation added that the decision had not anticipated: the
touched-path set does not need persisting. Once a path is committed, git updates
it on every `add --all` regardless of ignore rules, so the set only bridges the
window between creation and the next snapshot.

---

## C-09 — Which compaction shape does Flue actually use

**Status:** open. **Gates:** the real cost of every compaction. **Measure with C-01.**

There are two ways to summarise a conversation, and they differ by roughly 10×
in token cost:

- **Cache-safe fork.** Keep `tools`, `system`, and the full transcript
  byte-identical and append one instruction — *"summarise this conversation."*
  The prefix matches, so the whole history is billed at 10% and the only new
  tokens are the instruction and the summary.
- **Separate loop.** A fresh request with its own small system prompt and the
  transcript pasted in as content. No prefix match, so the entire conversation
  is re-read at full price. This is what OpenCode does, and it is what a
  different summariser model *forces* — a different model has a different cache
  entirely.

`CompactionConfig` lets us override the summariser model *"for cost optimization
(cheap summariser on an expensive session model)"*, which implies Flue supports
the second shape. It does not tell us what it does when the model is **not**
overridden.

**Check:** during the C-01 fixture, capture the compaction request and compare
its serialised prefix against the preceding turn's. Identical prefix means fork;
a fresh short system prompt means separate loop.

**Why it matters, with numbers.** At a 150k-token conversation on a
Sonnet-class model:

| Shape | Billed |
|---|---|
| Fork, same model | ~15k effective |
| Separate loop, same model | 150k at full price |
| Separate loop, cheap model | ~150k at roughly a tenth the rate |

Fork and cheap-separate-loop land in the same place. Separate loop on the
*session* model is the one to avoid, and it is the default we would get by
accident.

**Note either way:** the compaction call is a one-off. The larger unavoidable
cost is that rewritten history invalidates the prefix for the turn *after*
compaction. That is the real price, and it is why a breakpoint goes immediately
after the boundary.

---

## C-10 — What a network effect means at `in-process` isolation

**Status:** closed by ADR 0022. **Answer:** candidates 2 and 3 together — the
resource is the destination host, and everything that comes back is untrusted
content. Rule 3 ships as a rule and a label, not as taint machinery; the ADR
says what would make us build the machinery.

The rest of this entry is kept as the argument the ADR was made from.

This is named as the blocker for `fetch` in `ROADMAP.md`, `STATUS.md`, and
`architecture.md`, but the question itself was never written down anywhere — it
existed as the phrase *"SSRF is not containment"* and nothing else. Written out
here so the ADR can be argued rather than reconstructed.

**The question.** ADR 0019 drew the line for `execute` at *provenance*: native
and opted-in runs uncontained by consent, anything a user connected is refused
outright. The obvious move is to reuse that line for `network`. The reason to
doubt it is that the two effects fail differently.

`execute` risks *the machine*. Containment is the missing thing, the user
chose the program, and consent is a coherent answer.

`network` risks *the context window*. A fetch pulls text we did not write into a
prompt that drives tool calls, so the hazard is what the response says, not what
the request reached. Consent does not address that at all — a user approving
`fetch https://docs.example.com` is not approving the instructions on that page.
`allowNetwork` would be `allowExec`'s shape applied to a problem of a different
kind.

**What SSRF is and is not.** Refusing loopback, link-local (`169.254.0.0/16`,
including the cloud metadata endpoint), and private ranges is worth doing and is
not containment — it stops the agent reaching *our own* internals, which is a
real class of accident. It does nothing about the returned bytes.

**The three candidates:**

1. **Provenance, as ADR 0019.** Symmetrical, and probably wrong for the reason
   above.
2. **Provenance plus destination.** A network capability is admitted natively,
   but the *resource* is the host — `fetch:docs.example.com` — so the approval
   ladder and grants work exactly as they do for `shell:node` and `git:push`.
   This is the symmetrical answer that is also correct, and it is the current
   favourite.
3. **Treat fetched content as untrusted input rather than as a permission
   problem.** Orthogonal to 1 and 2 and probably needed regardless: mark it in
   the transcript, never let it widen a scope, never let it be the source of a
   path or a command.

**Decide before writing code**, per the plan of record. 2 and 3 together are
most likely right, and the thing to argue is whether 3 needs machinery or only a
rule.

---

## C-11 — Large tool output is truncated, not offloaded

**Status:** open. **Gates:** cache behaviour once sessions get long.

`mental-model.md` §3.5 is explicit: decide at execution time, and anything over
~8 KB is written to `~/.studio/` with a summary, a head/tail preview, and a
handle placed in the transcript *from the start*. "Then there is no rewrite and
therefore no invalidation, ever."

**Every shipped tool does the other thing.** `git` and `shell` clip at 400
lines, `grep` and `read` page, and none of them writes a result anywhere. The
rule is stated as settled architecture and is implemented nowhere.

Recorded because it is the largest gap between `mental-model.md` and `src/`, and
because it will not announce itself — a truncated result is a worse answer, not
an error, and the cache cost it was meant to avoid only shows up in a bill.

**Check:** whether any shipped tool actually produces results large enough to
matter, before building the offload path. If they never exceed 8 KB in practice,
§3.5 is a rule for MCP results rather than for native tools, and it should say
so.

---

## C-12 — What redaction is, and what it is not

**Status:** the catalog is built. The warning at the end stays open.

**What redaction is today, so nobody has to re-derive it.** Every caller of
`redactSensitiveString` and `redactGenAiContent` is inside
`src/observability/`. There are three: log messages (`logger.ts`), error
messages and fields (`errors.ts`), and content copied into an OpenTelemetry span
(`flue.ts`).

**It never touches what the model sees.** Nothing in the model request path and
nothing in the tool path calls it. If a user pastes an API key and asks the
agent to use it, the model receives the real key and a tool receives the real
key. Only the log copy shows `[REDACTED]`. This is the intended behaviour: the
agent keeps its full ability, and the copy that could leave the machine is the
one that is cleaned.

It is also inert by default. `flue.ts` only redacts when `captureContent` is
true, and the default is false, so prompt content is not captured at all.
Redaction is the second line of defence for when someone turns capture on to
debug something.

**Redaction itself is always on and has no off switch.** `logger.ts` and
`errors.ts` redact unconditionally. A log line that left the machine cannot be
recalled, so there is nothing to gain from a setting that removes the net.

**`captureContent` stays off by default, and that is not the same question.**
Turning it on copies prompts and replies into telemetry and then cleans them.
Not copying them is stronger than copying and cleaning. Redaction is the safety
net for a developer who turns capture on to debug something — not a reason to
turn it on.

**Built:** `src/observability/redaction-rules.ts` is the catalog. Every rule is
one entry with an `id`, a one-line `summary`, an `enabledByDefault` flag, a
pattern, and a replacement. Adding a secret shape means adding an entry.
Turning one off means naming its id, in code or in
`PROJECT_STUDIO_REDACTION_RULES="email:on,jwt:off"`.

Eleven rules ship. Ten are on: private key blocks, bearer tokens, URL
credentials, `sk-` keys, GitHub tokens, Google API keys, Slack tokens, AWS
access key ids, JWTs, and the key/value catch-all. One ships off — `email`,
because the signed-in user's address is how a support log is tied to a user, and
removing it takes away most of what the log is for.

**Not a TOML or YAML file, on purpose.** That needs a parser dependency, a
file-location decision, and handling for a malformed file, to configure
something with no UI. The typed catalog gives the same single place to look. If
users ever edit it, the shape is already right and only the loader changes.

**The warning that matters more than the feature.** There is a third job that
must never be folded into this one:

> stopping the *model* from seeing a secret.

That is not redaction. It is context policy — deciding what goes into the
request — and it belongs in `context/`, not `observability/`. Putting both
behind one word called "redaction" would repeat exactly what ADR 0020 fixed:
one word meaning two things in two places, with one of them wrong. If that
feature is ever wanted, it gets its own name and its own ADR.

---

## C-14 — Which providers we actually support

**Status:** open, and shipped with a working answer. **Gates:** nothing.

**Settled, and not up for review:** Tavily for search and Jina Reader for
reading are the product owner's choice. They stay.

**Not settled:** everything else in the two registries. Brave, Exa, and
Firecrawl are there because they are the services people actually use, not
because anyone finished deciding. A round of research is owed before that list
is called final.

**One doubt already raised, and worth keeping.** Firecrawl is a crawler that can
also read one page. The other four each do one job — Tavily searches, Brave
searches, Exa searches, Jina reads — and that is the property the harness is
supposed to have: small pieces that do one thing well. A crawler in the reader
slot may be the wrong shape even though it works, and the better home for it may
be an MCP server, where a user who wants crawling connects it and nobody else
carries it.

Not removed today. It is the only reader that fails *differently* from Jina,
which is the only property that makes a fallback worth having, and removing it
before a replacement is chosen would leave the slot empty.

### The fallback reader question specifically

`fetch` reads through Jina Reader. The fallback slot holds Firecrawl today,
because it is the one candidate that fails *differently* rather than failing the
same way for less money — it renders pages and gets past bot checks that turn
Jina away. A fallback that fails wherever the primary fails is decoration.

**What the search found, for the record.** The reader market splits three ways:

| Kind | Examples | Why it might fill the slot |
|---|---|---|
| Rendering readers | Firecrawl, ScrapeGraphAI | Closest peers to Jina. Different rendering, different bot handling |
| Self-hosted | Crawl4AI | Free, no third party learns the URL. Costs a running service |
| Search providers with an extract endpoint | Tavily Extract, Exa contents | One account instead of two, when search is already connected |

The last row is the interesting one and is not built. If the user has a Tavily
key for search, using its extract endpoint as the reader fallback costs them
nothing extra and no second account. Worth doing once someone is in that state.

**Check:** when a real page defeats both Jina and Firecrawl, or when the
one-account argument gets raised by an actual user.

---

## C-13 — The final shape of a provider failure

**Status:** open. **Gates:** nothing. ADR 0023 ships a provisional shape.

Every provider that costs money fails in the same few ways: the key is wrong,
the plan is used up, the rate limit is hit, the service is down. Model
providers, search providers, reader services, and MCP servers over HTTP will all
need to say those things, and today only `retrieval` has words for them.

**What ships now:** the `retrieval` domain with seven kinds — `unauthorized`,
`rate_limited`, `quota_exhausted`, `unavailable`, `timeout`, `invalid_request`,
`blocked`. Each provider adapter maps its own wire errors onto them, in one
place per provider.

**What is not decided:** whether this becomes one shared vocabulary across every
paid provider, what the UI shows for each kind, whether a `retryAfter` belongs in
the shape, and how a "you have no credit" state reaches the user rather than only
the model.

Deliberately not answered now. There is no consumer yet — no settings screen, no
error surface in the UI — and a shape designed without one is a shape designed
twice. Because the mapping is one file per provider, changing it later is an
edit to `src/retrieval/`, not a sweep.

**Check:** when the settings screen exists, or when the second family of paid
provider needs the same words.

---

## C-15 — Where pluggable subsystems live

**Status:** open. **Gates:** the first commit of Phase 11.

MCP, skills, hooks, and later teams all arrive the same way — declared,
validated, scoped, enabled, reloaded — and all four would otherwise land flat in
`src/` beside `db.ts`. The proposal in `tasks/002-phase-11-mcp.md` §2 is
`src/extend/` with a shared `registry/` inside it, and `agents/` staying out
because a subagent consumes the other three rather than being one of them.

Not `extensions/`: that word now names a specific MCP mechanism in the
2026-07-28 revision, and one word with two meanings inside one subsystem is what
ADR 0020 exists to prevent.

**What makes it worth a folder** is not that the things are similar. It is that
`architecture.test.ts` enforces boundaries by path, so a parent folder makes
"nothing under here reaches the model except through the gate" a rule the suite
can fail on.

**Answered, 9 August 2026.** `src/extend/`. See `tasks/002-phase-11-mcp.md` D-2.
Not `plugins/`, which every comparable tool spends on a *bundle* of skills,
agents, hooks, and servers distributed together — a thing this product will want
and would then have no word for. Not `extensions/`, which the 2026-07-28
revision has taken. The product surface is still called the Extensions page;
the folder and the page do not have to share a word, and here they must not.

The shared part is a **spine, not an engine**: two files at the root of
`src/extend/` holding identity, origin, per-project on/off, and a change signal.
MCP, skills, and hooks depend on it; it knows none of them. That direction is
enforced by one architecture rule — nothing at `src/extend/*.ts` may import from
a subdirectory — so a fourth kind adds a folder and edits nothing. See
`tasks/002-phase-11-mcp.md` §10.

Three runtime kinds only. A connector is a remote MCP server with OAuth and a
good icon, not a fourth subsystem. A plugin is a bundle that installs into the
three and does not exist at runtime.

---

## C-17 — The destination guard follows the URL's author

**Status:** half built. The *mechanism* shipped in Phase 11 item 003.5; the
*policy* is still open. **Refines:** ADR 0022.

**What is built.** `classifyHostPort` names why a destination is refused, and
`destinationResource` gives a loopback destination a `host:port` resource. An
`own-ports` registry marks the ports we listen on, and those are refused
however the policy lands. ADR 0022 carries the amendment note.

**What is not.** Nothing allows loopback yet. All four classes still refuse. The
remaining decision is the one this entry was opened for — whether a
user-supplied MCP URL follows a different guard from a model-supplied `fetch`
URL — and it is answered when the local HTTP client is written, which is where
the second caller finally exists.

`src/net/destination.ts` was built for `fetch` and refuses every private
address. That is right for a URL the *model* chose and wrong for a URL the
*user typed into a settings form*, which is how a local MCP server arrives.

The axis is who wrote the URL, not what the address is. Full table in
`tasks/002-phase-11-mcp.md` §9. In short: an MCP endpoint needs a well-formed
`http`/`https` URL and nothing more; `fetch` keeps a strict guard, but "private"
splits three ways — link-local and cloud metadata are refused and never offered,
LAN ranges are refused by default, and **loopback goes through the normal
approval ladder** so a user can approve their own dev server once.

**The part that changes ADR 0022:** for loopback the permission resource must be
**host and port**. `localhost:3000` is a dev site and `localhost:11434` is Ollama
with no authentication; approving one must not approve the other. Outside
loopback the host remains the resource.

**Check:** when the local HTTP client is written, in Phase 11 item 003.5 part B.
That is the first caller that has a user-supplied URL to judge, and a policy
with one caller is a policy nobody has tested.

---

## C-16 — Which MCP revisions we speak

**Status:** open. **Gates:** nothing yet; narrows Phase 11's first cut.

The 2026-07-28 revision split MCP into two eras. Research and the full
compatibility procedure are in `tasks/002-phase-11-mcp.md` §1.

Settled by that research: modern is the default, HTTP+SSE is not implemented,
and Roots, Sampling, and Logging are not implemented — all three are deprecated
in the revision we are adopting and all three have named migrations.

**Answered, 9 August 2026.** Both eras ship together. See
`tasks/002-phase-11-mcp.md` D-4.

Modern-only was tempting and is wrong. The revision is twelve days old, the
compatibility matrix says a modern client against a legacy server *fails* rather
than degrades, and every server published before 28 July 2026 — including both
installed on this machine — is legacy.

Legacy coverage differs by transport, because the cost does. On stdio, accept
any revision we can complete a handshake with; the handshake barely varies and
breadth is nearly free. On HTTP, require Streamable HTTP (`2025-03-26` or
later) and never implement HTTP+SSE.

**Built, 10 August 2026** — `src/extend/mcp/handshake.ts`. The version lists live
there, one modern and four legacy, and that is the only place either era's
revisions are spelled.

One consequence is worth knowing before somebody meets it. We speak exactly one
modern revision, so a modern server supporting only a *newer* one fails outright
rather than negotiating down — there is nothing to negotiate down to. The failure
names both lists, which is the most useful thing it can do, and the fix is to add
the revision. Not a defect, and it is the reason `MODERN_PROTOCOL_VERSIONS` is
written as a list while it has one entry.

---

## C-18 — One server, two projects, opposite answers

**Status:** open. **Gates:** nothing today; decide before more than one project
is live in one harness process.

Selection is per project — `extension_selection` is keyed `(kind, id, project)`.
The supervisor is not: it holds one process per server id, because one server is
one program and running two of it would be the bug the whole class exists to
prevent.

Those two facts collide the moment a server is switched **on** in project A and
**off** in project B. Reconciling B stops a process A is using; reconciling A
starts one B just stopped. Neither side is wrong on its own.

**Not a live defect.** Reconciling is one pass at a time harness-wide, so the two
cannot run concurrently, and the harness serves one project at a time today. The
result is a server that stops and starts as the project changes — wasteful, not
incorrect.

**The three answers, none of them chosen yet.**

- **Reference count.** A server runs while at least one live project wants it.
  Cheapest, and it means a process outlives the project that started it, which
  needs saying out loud before it is true.
- **One supervisor per project.** Honest isolation, and it doubles the processes
  for a server two projects both use.
- **One project per harness process.** Already effectively true. Making it a rule
  removes the question, and forecloses a window-per-project product later.

**Check when:** the desktop application can have two projects open at once, or
when 003.8 wires selection to a settings screen — whichever comes first. The
reference count is the likely answer, and it should be a decision rather than a
default.

---

## C-08 — Folder names contain spaces

**Status:** open, low priority.

`STUDIO HARNESS/` has a space. pnpm, Vite, and Tauri generally tolerate this on
Windows, but it is a recurring source of quoting bugs in scripts and CI. If
anything breaks in a way that traces back to path quoting, rename to
`STUDIO-HARNESS` rather than debugging the tool.
