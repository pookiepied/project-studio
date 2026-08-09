# Delegation log

One entry per delegated task, written **after** review, never before. This is
the running record of what was sent out, what came back, and what review had to
change.

It exists for one reason: to answer "is this working" with evidence instead of
impression. A method that produces correct code but costs more to review than to
write is a method to stop using, and only a record shows which one this is.

## Standing rules for entries

- An entry is added when the branch is **merged**, not when the report arrives.
- Record what review **changed**, not what it approved. The changes are the
  signal.
- Record any rule the delegate added on its own initiative. That is where the
  last defect came from.
- If a task is rejected and thrown away, it still gets an entry. A discarded
  branch is the most useful data point here.

---

## Ledger

| Task | Branch | Verdict | Review changes | Merged |
|---|---|---|---|---|
| 003.5 part A — destination guard | `task/003-5-destination-guard` | Accepted | 3 | `297bc56` |
| 004.A — NDJSON framing | `task/004-a-ndjson-framing` | Accepted | 2 | `b9fc391` |
| 004.B — JSON-RPC shapes | `task/004-b-jsonrpc` | Accepted | 0 | `12dfbb6` |
| 004.C — request correlation | `task/004-c-correlation` | Accepted | 2 | `375b162` |
| 004.D — retry backoff | `task/004-d-backoff` | Accepted | 0 | `3e73b43` |
| 004.E — lifecycle machine | `task/004-e-lifecycle` | Accepted | 0 | `d51020c` |
| 004.F — definition hash | `task/004-f-definition-hash` | Accepted | 0 | `363f179` |

Review fixes landed together as `694d1be`. Suite: 717 before, 880 after the six
merged, 882 after review.

---

## 004.A–004.F — the MCP wire layer

**Sent:** six leaf tasks from `tasks/004-delegable-tasks.md`, with
`HOUSE-RULES.md` this time.
**Verdict:** all six accepted. Four needed no change at all.
**Tests:** 717 before, 880 on arrival, 882 after review.

**Process held.** Six branches, each from `main`, none merged by the delegate,
no commit on `main`. Every report named its branch and its breaks. Two of the
reports flagged an added rule under the new "say so" requirement, which is
exactly what that rule was added for after 003.5.

**What review changed, and it was one theme in two files.**

**Errors with no domain.** `pending.ts` created an `Error` and two
`DOMException`s and handed them to callers by rejecting a promise. Our rule —
every failure carries a domain and a kind — was never violated in the way the
architecture test looked for, because the test only inspected `throw`. A
rejection reaches a caller by a different verb and lands in the same place:
counted as `unclassified`, which is meant to measure code that was never
onboarded.

*The test was widened rather than the code merely patched.* It now refuses the
**construction** of `Error`, `TypeError`, `RangeError`, and `DOMException`
anywhere in `src/`, and asserts the exact list of remaining offenders instead of
skipping them — `models/local/cli.ts`, recorded as `E-02`. `DOMException` is in
the list because it is what the platform gives back for an abort, and taking the
platform's default is the most natural way to acquire an error with no domain.

Three new `ExtendFailure` kinds carry the meaning: `timed_out`, `cancelled`,
`disconnected`. The first and third are retryable and the second is not, which
is a judgement that now lives in one place instead of at every call site.

**Silence where a message vanished.** `framing.ts` dropped an oversize line and
returned nothing. Dropping is right; saying nothing is not. A vanished message
is indistinguishable from a server that said nothing, and the caller is left
waiting on a request id that nothing will ever answer. It is reported now, with
`reason: "oversize"` and a truncated preview — carrying the megabyte we refused
to keep would undo the limit.

That is `003.7`'s rule arriving early: **write the error message before the
schema.** A state whose message cannot be written should not exist, and a state
whose message is never *sent* is the same defect one step later.

**One duplication worth naming.** The clear-timer, drop-listener, delete, settle
sequence appeared five times in `pending.ts`. Correct in all five. But each copy
is a chance to forget one of four steps, and a forgotten step is either a timer
firing after the answer arrived or an entry that never leaves the map. One
private method now; deleting its `delete` fails 22 tests.

**What the delegate got right.** Comment quality across all six, including the
constants in `backoff.ts` each carrying why that number. `lifecycle.ts` asserts
its transition table by checking all 42 pairs and refusing the 33 illegal ones,
which is stronger than what the task asked for. `004.E` also found a real design
gap I had left — `failed` alone cannot remember an attempt count across
`failed -> starting`, so `starting` had to carry it too. It said so instead of
quietly diverging.

**Two things I got wrong, not the delegate.**

`git add` on a directory swept a delegate's in-flight file into my commit; caught
by reading `git show --stat`. And `git checkout --` on one file to undo a
deliberate break reverted my uncommitted review fixes with it, because the
committed version was the delegate's. Both are the shared working tree, and both
are now in `tasks/README.md`.

---

## 003.5 part A — the destination guard

**Sent:** `tasks/handoff-003.5.md`, before `HOUSE-RULES.md` existed.
**Verdict:** accepted.
**Tests:** 647 before, 675 on arrival, 677 after review.

**What arrived.** `classifyHostPort`, `destinationResource`, an own-ports
registry, and a port-aware split of the IPv4 and IPv6 checks. `isPrivateHost`
kept its signature. No observable behaviour changed, and the report proved it.

**What review changed.**

1. **`.localhost` was classified as loopback with no test.** A rule the delegate
   added on its own initiative and did not cover. Correct under RFC 6761, and
   silently revertible. This is the defect that produced the standing rule in
   `HOUSE-RULES.md` §8.
2. **An IPv6 resource was unbracketed.** `::1` with port 443 gave `::1:443`,
   which is another valid address. A resource string is compared against a
   stored grant, so two spellings of one destination is a grant matching what it
   never named. Now `[::1]:443`.
3. **The same URL was parsed twice**, leaving an unreachable `catch`.

**What the delegate got right that I did not expect.** Comment style. The
comments say why rather than what, which was the thing I was most prepared to
have to rewrite.

**Verification held up.** I re-ran two of its six claimed breaks and both
failed as reported. It did not invent a verification.

**The structural finding.** The code arrived without its documentation, because
the handoff forbade touching `docs/` on purpose — a delegate does not hold the
reasons an ADR records, and a wrong amendment note is worse than a missing one.
ADR 0022 and `C-17` were both left stale and I wrote them afterwards.

That is a property of the method, not a fault of the delegate, and it is the
line along which this work divides at all: **rule work can go out; the record of
why cannot.**

**Process failure, mine.** Review finished on the delegate's branch and I never
returned to `main`, so three unrelated commits landed there. Nothing was lost
and the branch name lied. Fixed, and written into `tasks/README.md`.
