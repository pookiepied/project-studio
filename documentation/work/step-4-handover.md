# Handover — step 4: the other two enablement scopes

Paste the fenced block below as the task. The prose here is for you, not the
agent.

**One decision is left open on purpose** and the brief says so: what should
happen when someone switches an extension on in the middle of a conversation.
The inventory is frozen for that conversation's life, so the model will not
learn about it until a new conversation starts. The agent is asked to
recommend rather than choose, because the answer is a product decision and the
cheapest wrong answer here re-bills every conversation the user has open.

**Read this before dropping it:** the last handover cost us hours because the
agent ran `vitest` directly against a stale `dist/`. The block below says to
build first, in the one place it matters.

---

```
You are implementing step 4 of a documented plan in the Project Studio repo at
`C:\pookiepied\Dev Workspace\Project Studio`. Work in `STUDIO/` and
`STUDIO HARNESS/`.

Steps 1-3 landed. The mechanism works: extensions are announced in the system
block, their schemas are withheld until `native/discover` loads them, and a
loaded tool is callable from the model's next step. What is missing is that a
person can only configure any of it globally.

READ FIRST, and treat as binding:
1. `documentation/work/capability-discovery-plan.md` — section 1 (the state
   table), step 4, and section 3 ("What this must not break"). Steps 5-6 are
   OUT OF SCOPE.
2. `documentation/decisions/0048-a-capability-is-announced-before-it-is-loaded.md`
   §1 and §4 — why the inventory is frozen per conversation, and why
   enablement bounds discovery rather than the other way round.
3. `documentation/architecture/mental-model.md` §3.3 — the cache arithmetic.
   You need this to reason about the open question below, not to write code.
4. `C:\Users\pooki\.claude\CLAUDE.md` — the user's communication rules.

Then read what exists: `src/extend/selection.ts` (the three-scope spine),
`src/transport/http/routes/mcp.ts` (the project-scope route, which already
works and which nothing calls), and `STUDIO/src/features/settings/mcp/`
(the global screen, which is your model for the new one).

WHAT TO BUILD — three pieces.

PIECE ONE — the project-scope settings screen.

The route and the client method both exist. What is missing is a screen. List
the installed MCP servers in project settings, each one `on` / `off` /
`inherit`.

`inherit` is a real third value and the most likely thing to get wrong. The
route models it as `null`; the spine resolves narrowest-first and treats
absence as "no decision here", which is NOT the same as "off". A tri-state
control that collapses to a checkbox would silently turn "the global setting
decides" into "off for this project", which is a change to what the model can
reach that nobody asked for. Show what `inherit` currently resolves to, so the
row is honest about the effect rather than only the setting.

PIECE TWO — conversation scope, end to end.

The store supports it; there is no route and no client method. Add
`PUT /api/mcp/conversations/:id/extensions/mcp/:serverId`, following the
project route's shape exactly — same body, same validation, same errors. Add
the client method beside `conversationContext`. Then a place to put it: the
narrowest scope belongs where the conversation lives, not in global settings.
Keep this surface small; it is deliberately the last scope built because it
has the least evidence of being wanted.

PIECE THREE — answer the mid-conversation question, in writing, before you
build any UI for it.

The inventory is settled once per conversation and never moves, because moving
it re-bills the whole conversation behind it. So a person who switches an
extension on while a conversation is open has changed what the tools array can
grow to, but NOT what the system block says — the model will not know the
extension exists until a new conversation starts.

Three answers were sketched and none chosen:
  (a) Say it on the row: "takes effect in new conversations."
  (b) Apply it to conversations that have not started yet, silently.
  (c) Offer an explicit "apply here", accepting the one-time re-billing cost
      for that conversation.

Write your recommendation into `documentation/work/capability-discovery-plan.md`
under step 4, with the reasoning and what each option costs. Recommend; do not
decide. If (c) is recommended, say what it costs on a long conversation in
concrete terms, because that is the number the decision turns on. Do not build
(c) in this task.

MUST NOT BREAK — each has an ADR or a test behind it:
- Precedence is settled and is not reopened: conversation, then project, then
  global, then off. Narrowest first; absence is not a decision.
- ADR 0048 §1. The inventory does not move mid-conversation. Nothing in this
  task may rebuild it, and there is a test asserting the system block is
  byte-identical across a turn — if you find yourself editing that test, stop.
- ADR 0029. Nothing removes a tool from a live session. Switching an extension
  off stops new registrations; it does not unregister, and the existing tool
  fails at dispatch with the unavailable result.
- ADR 0024. Everything in the tools array is callable.
- Enablement subtracts, never adds. Discovery reaches only what selection
  already resolved to enabled.

VERIFICATION — not optional:
- `pnpm typecheck && pnpm lint` in both projects.
- `pnpm test` in `STUDIO HARNESS/` — baseline 1804 passed, 25 skipped, 0
  failed. `pnpm test` in `STUDIO/` — baseline 847.
- IMPORTANT: `pnpm test` runs `pnpm build` first, and the MCP integration
  tests boot `dist/server.mjs` as a real subprocess. If you run `vitest`
  directly after changing harness source, you are testing a stale bundle.
  Run `pnpm build` yourself before any direct vitest run. A previous agent
  lost hours to this exact trap.
- Never run two suites at once. They both rewrite `dist/` and compete for
  sandbox workspaces, and the results of both become worthless.
- NEGATIVE CONTROL every load-bearing claim: break it, confirm the test fails
  for the stated reason, restore. At minimum: (a) collapse `inherit` to `off`
  and confirm a test catches it; (b) make the conversation route ignore its
  scope and confirm precedence tests fail.
- Do not leave a negative control in place while a suite runs.

DO NOT COMMIT. Leave the changes in the working tree.

HOUSE STYLE: comments say WHY a decision was made and what the alternative
cost, in full sentences. Read `src/tools/discover/discover.ts` and
`src/context/capability-inventory.ts` before writing. Tests carry the same kind
of doc comment, naming the invariant they pin.

Use `python` not `python3`. Prefer the Edit tool over shell scripting for
anything containing escape sequences.

REPORT: file by file what changed; exact test counts before and after for both
projects; which negative controls you ran and what each proved; your
recommendation on the mid-conversation question; and anything in the plan or
the ADRs you found wrong, ambiguous, or impossible as written.
```
