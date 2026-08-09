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
