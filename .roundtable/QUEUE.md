# Queue

One item = one scoped change = one agent run. Statuses: `todo` · `in-progress` ·
`needs-confirmation` · `blocked` · `done`.

Items are ordered: architectural damage first, cosmetic backlog after. Each item
names its files, its definition of done, and what would make it fail. An item that
cannot state how it fails is not ready to dispatch.

---

## RT-001 — Break the `core/network` → `features` inversion · `todo`

**Why first.** `core/` must never import `features/`. It does, and it accounts for
five of the eleven cycles. This is the layering leaking, and fixing it will tell us
what the real dependency shape is before we touch anything cosmetic.

**Cycles covered (5 of 11):**
```
core/network/fallbackService.ts > features/chat/attachments/attachmentLimits.ts
core/network/fallbackService.ts > features/models/services/modelCapabilityService.ts
features/models/services/modelService.ts > core/network/fallbackService.ts
features/models/services/modelService.ts > core/network/fallbackService.ts > features/chat/attachments/attachmentLimits.ts
features/models/services/modelService.ts > core/network/fallbackService.ts > features/models/services/modelCapabilityService.ts
```

**Done when:** those five cycles are gone from `npm run ratchet:cycles`;
`STUDIO/gate/cycles-baseline.json` is lowered in the same commit; typecheck clean;
no behavior change.

**Fails if:** the cycle is broken by moving `core` code into `features` (wrong
direction), by a type-only import that silences madge without fixing the coupling,
or by anything the diff touches outside these three files plus whatever they must
import from.

**Note for the implementer:** the direction of the fix is not decided. Read the code
first. The likely shapes are dependency inversion (core defines an interface,
features supplies it) or hoisting the shared value into a leaf module neither owns.
Report which you chose and why.

---

## RT-002 — Break `core/storage` → `features/chat` · `todo`

**Cycle (1 of 11):**
```
core/storage/chatHistoryService.ts > features/chat/conversations/claude/claudeConversationAdapter.ts > features/chat/conversations/storage/types.ts
```

Same inversion as RT-001, different pair. Likely resolved by moving the shared
`storage/types.ts` shapes somewhere both can depend on — `src/types/` already exists
for exactly this per decision D-9 in the Local Runtime task doc.

**Done when:** cycle gone, baseline lowered, typecheck clean, no behavior change.

---

## RT-003 — Break the `runtime/execution` self-cycle · `done` (2026-07-10)

**Cycle (1 of 11):**
```
runtime/execution/executeLocalTools.ts > runtime/execution/builtinTools.ts
```

Contained within one directory, so this is the cheapest of the cycle items and a
good calibration run for the loop. Both files are in scope.

**Done when:** cycle gone, baseline lowered, typecheck clean, no behavior change.

---

## RT-004 — Break the `features/chat/context` ↔ `runtime` barrel cycle · `todo`

**Cycle (1 of 11):**
```
features/chat/context/index.ts > features/chat/context/ChatProvider.tsx > features/chat/context/runClaudeTurn.ts > runtime/index.ts > runtime/ui/InlineToolSteps.tsx
```

**Note:** this one runs through `runtime/index.ts`, a public barrel. The cycle may be
an artifact of barrel re-export rather than real coupling — `runClaudeTurn` probably
wants one symbol, not the whole barrel. Verify before restructuring anything; the fix
may be a direct import.

**Done when:** cycle gone, baseline lowered, typecheck clean, no behavior change.
Do not delete or reshape `runtime/index.ts`'s public surface to achieve this.

---

## RT-005 — Break the two intra-feature cycles · `todo`

**Cycles (2 of 11):**
```
features/models/services/modelService.ts > features/models/services/localModelDetection.ts
features/chat/services/daemonService.ts > features/models/services/localUsageService.ts
```

Grouped because both are service-to-service within the feature layer, no layering
violation — just tangles. Dispatch as one item only if RT-001 has landed, since it
touches `modelService.ts`.

**Preconditions:** RT-001 `done`.

---

## RT-006 — Break `BrowserPanel` ↔ `NativeBrowserHost` · `todo`

**Cycle (1 of 11):**
```
features/workspace/browser/BrowserPanel.tsx > features/workspace/browser/NativeBrowserHost.tsx
```

`BrowserPanel.tsx` is also the single worst lint offender (15 raw `<button>`). Do
**not** fix the buttons here — that is RT-007. One item, one concern.

---

## RT-013 — Close the `<motion.button>` guardrail bypass · `blocked` · needs human decision

The rule selector is `JSXOpeningElement[name.name='button']`. A `<motion.button>` is a
JSXMemberExpression, so **it does not match.** 29 of them exist across 13 files, entirely
uncounted. `ui/primitives/Button.tsx` is one, which is why it never appeared in the baseline.

Not cosmetic: until it is closed, an agent working RT-007 can satisfy the gate by rewriting
`<button>` as `<motion.button>`, trading a counted violation for an invisible one.
**Close this before dispatching RT-007.**

Closing it raises the lint baseline by roughly 28. Per the charter a baseline raise is an
escalation to the human, not a silent act. The reason to accept it: the debt already exists
and the number was always wrong. Awaiting decision.

---

## RT-014 — Carve control primitives out of the raw-button rule · `done` (2026-07-10)

Found by the Codex audit, verified here. `IconButton`, `SegmentedControl`, and `Toggle`
tripped the rule they exist to satisfy. Exempted those three plus `Button.tsx` — and only
those. The other primitives (`AskUserQuestionCard`, `HarnessPermissionModal`,
`ConnectionStatusBar`, `ExternalLink`, `VideoPlayer`) are composites whose raw buttons are
real debt; they stay counted. Baseline 232 → 229.

---

## RT-007 — Raw `<button>` burn-down · `todo` · batched

**Preconditions:** RT-013 resolved, or the gate cannot score this item honestly.

229 violations across ~90 files (was 232; three control primitives carved out in RT-014).
Plus ~28 more invisible until RT-013 lands. All the same rule: use `<Button>`/`<IconButton>` from
`@/ui/primitives`. Mechanical, high-volume, low-risk — which makes it the right work
to run *after* the loop has earned trust on the cycle items, not before.

Dispatch one batch per agent run, by directory. Suggested batches, largest first:

| Batch | Path | ~violations |
|---|---|---|
| 007a | `features/workspace/browser/BrowserPanel.tsx` | 15 |
| 007b | `features/workspace/WorkspacePage.tsx` | 12 |
| 007c | `features/chat/components/` | ~41 |
| 007d | `ui/layout/` | ~6 |
| 007e | remainder, by directory | ~158 |

**Done when:** the batch's files are at 0 in `gate/lint-baseline.json`, baseline
lowered, typecheck clean, **and the buttons still work** — this is the item most
likely to silently break behavior (lost `type="button"`, dropped `onClick`, changed
focus or keyboard handling). Human smoke test is mandatory before merge.

**Fails if:** a `<Button>` swap changes default form-submit behavior, drops an aria
attribute, or alters visual weight. Report every prop that did not map cleanly.

---

## RT-008 — Triage unused exports · `needs-confirmation`

`npm run deadcode` reports 336 unused exports and 126 unused types. This is **not** a
delete list. Many are deliberate public barrels (`runtime/index.ts` alone accounts for
a large share) and knip cannot tell a public API from dead weight.

**This item is triage, not deletion.** Produce a categorized list: (a) genuine dead
code with evidence, (b) intentional public surface, (c) unknown. Deletion happens in
follow-up items, per category (a) only, with evidence in the ledger.

---

## RT-009 — Identify the one unused devDependency · `todo` · small

`npm run deadcode` reports exactly one unused devDependency and it has not been
identified. Name it, prove it, then propose removal as a separate item.

---

## RT-011 — `runtime/execution/types.ts` depends on `features/` · `todo`

Surfaced during RT-003 review, not introduced by it — the coupling moved with the type.
`runtime/execution/types.ts:15` imports `ActiveToolCall`, `TaskItem`, `ToolApprovalDecision`
from `@/features/chat/context/types`. `runtime/` should not depend on `features/`; this is
the same inversion as RT-001, now sitting in a file whose name makes it look harmless.

Madge does not flag it because it is not a *cycle*. The gate cannot see layering
violations that don't close a loop — worth remembering before trusting a green gate.

**Preconditions:** RT-001 `done`, so the inversion is fixed once with one pattern.

---

## RT-012 — Stale comment in `builtinTools.ts` · `todo` · trivial

Reported by the RT-003 implementer, correctly left untouched as out of scope. The header
comment (~lines 16-18) still says the type-only import comes from `./executeLocalTools`.
It now comes from `./types`. Fold into any future item that touches this file.

---

## RT-010 — Fix the dangling doc reference in `eslint.config.js` · `todo` · trivial

[eslint.config.js:9](../STUDIO/eslint.config.js:9) justifies the design-system rules by
citing `frontend-revamp/02-PLAN.md` § T6.3 and decision D-604. That file does not exist
anywhere in the repo and predates the 2026-07-10 doc purge. Either point the comment at
a real doc or restate the rationale inline. Do not weaken the rules.
