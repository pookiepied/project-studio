# Handover — step 3: `native/discover` and withhold-by-default

Paste the block below as the task. It is written to stand alone: it names what
to read, what to build, what not to touch, and how to prove it.

**Ready to hand over as-is.** The two decisions it depends on are answered
inside it: the heading gets reworded to "available on request" (true once this
step lands, and the one-off system-block cost is cheapest now), and the
project-scope settings screen stays out of scope for step 4 to design
separately.

---

```
You are implementing step 3 of a documented plan in the Project Studio repo at
`C:\pookiepied\Dev Workspace\Project Studio`. Work in `STUDIO HARNESS/`.

This step is the reason the previous two existed. It is also the step where a
mistake costs real money on every turn of every conversation, so read the
reasoning before writing anything.

READ FIRST, in this order, and treat as binding:
1. `documentation/decisions/0048-a-capability-is-announced-before-it-is-loaded.md`
   — the decision. Read the amendment notes at the top and the corrections
   inside §1 and §5; they were written after an implementation contradicted the
   original text.
2. `documentation/decisions/0049-the-browser-is-ours-the-engine-is-the-machine-s.md`
   §5 — it narrows 0048's eager rule. Eagerness follows size and generality, not
   ownership.
3. `documentation/decisions/0029-mcp-session-tool-membership.md` — membership is
   append-only, and why.
4. `documentation/architecture/mental-model.md` §3.1–3.4 — the cache arithmetic
   that makes all of this necessary. §3.3 is the one to understand: adding to the
   tools array is free, removing from it re-bills the entire conversation.
5. `documentation/work/capability-discovery-plan.md` — sections 1, 2, step 3, and
   section 3 ("What this must not break"). Steps 4-6 are OUT OF SCOPE.
6. `C:\Users\pooki\.claude\CLAUDE.md` — the user's communication rules.

Then read what step 2 already built, because you are extending it, not replacing
it: `src/context/capability-inventory.ts`, and in
`src/application/studio-runtime.ts` the methods `#enabledMcpServers`,
`#capabilityEntries`, `conversationCapabilityInventory`, and `refreshTools`.

WHAT TO BUILD — two halves, landed together, because either alone is a broken
state. Withholding without discovery removes capabilities from users who have
them today. Discovery without withholding adds a tool nobody needs.

HALF ONE — the tool. One capability, `native/discover`, taking an optional
string `scope`:

  absent              → the enabled servers, their sentences, their tool names.
                        Same content as the inventory, for a model whose
                        inventory has scrolled out of a long conversation.
                        No side effect.
  `mcp:blender`       → that server's tools, with their descriptions.
                        No side effect.
  `mcp:blender/add_camera`
                      → the full schema, AND registers that one tool into the
                        gate so the next turn's array contains it.

Declare `effects: ["read"]`, matching what `plan`, `ask` and `jobs` already do —
read `src/tools/shell/jobs.ts` for the precedent and the reasoning in its
comment. Reading a catalog reaches nothing, and registering a schema is not an
effect on the user's machine. What the discovered tool may then DO is the
kernel's question, per call, unchanged.

Refusals must name a remedy. An unknown server id says which servers this
conversation actually has. A server that resolves to disabled says so and says
where it is enabled — never "no such server", because a model told that about a
server the user can see in their settings will conclude Studio is broken.

THE TRAP, and it is the most important sentence in this brief: `gate.list()` is
read inside the `tools:` callback at the START of an operation. A tool registered
DURING an operation appears in the NEXT one, not the current one. That is correct
and must not be "fixed". It must be stated in the discovery tool's own answer, or
a model will discover `add_camera`, call it in the same turn, and be told there is
no such tool by the system that just handed it the schema. Verify by test that
the tool lands where you say it lands.

HALF TWO — the withhold. In `refreshTools()`, register eagerly only servers whose
provenance is `system`. Everything else waits for discovery. Discovery registers
into the same gate under the same key, so a tool loaded twice is the existing
no-op.

Note that `provenance` currently has exactly one value in practice — nothing
writes `system` yet and the client deliberately cannot — so after this change a
plain user server contributes zero schemas until discovered. That is the intended
end state. Make sure the tests cover a `system` server too, by writing the row
directly, so the eager path is not dead code.

MUST NOT BREAK — each of these has an ADR or a test behind it:
- ADR 0024. Everything in the tools array is callable. The inventory is not in
  the array and must never be described as tools.
- ADR 0029. Nothing removes a tool from a live session. Withholding applies at
  registration, never by unregistering.
- The inventory stays settled per conversation. Discovery must NOT change the
  system block. There is a test asserting the block is byte-identical across a
  turn that discovers a tool — if you find yourself editing that test, stop and
  reconsider.
- The kernel is the only door. A discovered tool is approved per call, and its
  grant still dies on a definition-hash change.
- Discovery reaches only what selection already resolved to enabled. It is not a
  way to reach a server the project did not enable.

TWO DECISIONS, ALREADY ANSWERED — do not ask about these, just do them:

1. REWORD THE HEADING. Change `# Capabilities` to
   `# Capabilities available on request`, and adjust the intro paragraph in
   `capabilityInventoryBlock` so it says the tool names below can be requested
   in full through the discovery tool, naming that tool. Until now the tools
   were loaded eagerly and "on request" would have been false; once this step
   lands it is true, and the more useful wording. This is a one-off system-block
   change for conversations that already exist, and it is being taken
   deliberately while few of them do. Update the example block in ADR 0048 §1 to
   match, and delete the paragraph there explaining why the heading was
   temporarily the shorter form — it stops being true with this change.

2. THE PROJECT-SCOPE SETTINGS SCREEN IS OUT OF SCOPE. That is step 4 and it is
   being designed separately. Do not add UI. Global-scope enablement already
   works, which is enough to exercise everything here by hand.

VERIFICATION — not optional:
- `pnpm typecheck && pnpm lint` in `STUDIO HARNESS/`, and in `STUDIO/` if you
  touch it.
- `pnpm test` in `STUDIO HARNESS/` — about 10 minutes, run it in the background
  and wait. Baseline 1792 passed, 25 skipped, 0 failed. `STUDIO/` baseline 847.
- Work through ADR 0048's "Required proof" list and turn each line into a test.
- NEGATIVE CONTROL every load-bearing claim: break it, confirm the test fails for
  the stated reason, restore. At minimum: (a) make `refreshTools` register a
  non-system server eagerly and confirm the withhold test fails; (b) make
  discovery skip registration and confirm the next-turn test fails; (c) let
  discovery reach a disabled server and confirm the enablement test fails.
- IMPORTANT: do not leave a negative control in place while a full suite runs —
  a previous agent did, and the failures were read as real. Restore, then run.

DO NOT COMMIT. Leave the changes in the working tree.

HOUSE STYLE: this codebase has a strict and unusual comment culture. Comments say
WHY a decision was made and what the alternative cost, in full sentences. Read
`src/process/background.ts` and `src/context/capability-inventory.ts` before
writing. Tests carry the same kind of doc comment, naming the invariant they pin.

Use `python` not `python3` on this machine. Prefer the Edit tool over shell
scripting for anything containing escape sequences — writing `\n` through a
heredoc into a TypeScript string literal has corrupted files here before.

REPORT: file by file what changed; exact test counts before and after for both
projects; which negative controls you ran and what each proved; and — this
matters more than a clean report — anything in the ADR or plan you found wrong,
ambiguous, or impossible as written. The last agent found two real defects in the
ADR that way, and both were fixed because it said so.
```
