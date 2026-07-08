# 00 — INTENT (the project constitution & source of truth)

> **READ THIS FIRST, EVERY TIME.** This document governs *how* the STUDIO frontend revamp is carried
> out. It is the single source of truth for the project's philosophy, ground rules, mandatory
> workflow, and completion criteria. If anything elsewhere contradicts this document about *process*,
> this document wins. (For *design* specifics it points you to `01-AUDIT.md`; for the *plan of record*
> it points you to `02-PLAN.md`.)

This project is structured so that **any capable engineer or LLM can join at any point** — a brand-new
conversation, a different AI platform, a different tool (e.g. OpenAI Codex) — read the documents in the
prescribed order, look at the code, and continue correctly **without needing the prior conversation
history**. The documents are the memory. Keep them true.

---

## 1. What this project is

We are refactoring the **STUDIO frontend** (the desktop + web app in `STUDIO/`) into a *premium,
coherent, feature-organized* frontend. This is a **restyle + reorganization, not a feature project**:
we do not add product features, change product behavior, or migrate routing. If we find a bug, we log
it; we do not scope-creep into fixing it.

**Tech reality (verify before relying on it):** React 19 + TypeScript 5.8 + Tailwind 3.4 + Vite 6 +
Tauri 2. **Dual build target** — desktop (`vite.config.ts`) *and* web (`vite.config.web.ts`); both must
always compile. Theme is toggled by an `html.dark` class (pre-hydration script in `index.html` +
`SettingsContext`). Icons are Phosphor (`@phosphor-icons/react`). Animations use framer-motion.

---

## 2. Core philosophy & principles (the "why")

These are settled. Do not re-litigate them mid-implementation. Full detail lives in `01-AUDIT.md`
§11–§12 (design) and `02-PLAN.md` §1–§3 (architecture/strategy). The essentials:

### Design
- **Pure-neutral monochrome. No accent colors — EVER.** No blue/red/green/sage/amber/purple. White +
  light grays (light mode), graphite (dark mode). "Premium" comes from restraint and precise neutral
  steps, not from hue.
- **Primary text is near-black ink** (`#1A1A1A` light / soft-white `#F2F2F2` dark) — **never pure
  `#000`** (calibration decision D-304; pure `#000` reserved only for media/scrims). Ink is for *text +
  structural marks* only, never for surfaces/fills/borders.
- **State lives on separate channels** (the channel-separation rule, `01-AUDIT.md` §11.1): hover =
  quietest fill only; selected/active = stronger fill **+ near-black text + medium weight + optional
  2px marker**; focus = a **premium-grey ring** (`#5A5A5A` light / `#A8A8A8` dark — the secondary-ink
  weight, never pure `#000`, never a fill); hover-on-selected never stacks a third shade.
- **Elevation is asymmetric** (§11.2): light = hairline border + soft shadow; dark = lighter graphite
  fill, minimal shadow.
- **Status without color** (§11.3): success/error/warning via icon + weight + neutral surface;
  destructive = filled graphite/near-black + icon, **not red**.
- **Everything comes from tokens & scales.** No raw `gray-*`/`dark:*` for surfaces/borders/text; no
  arbitrary `text-[Npx]`/`rounded-[..]`/`z-[..]`. Primitives are the only sanctioned way to build a
  button, input, modal, card, popover.

### Architecture
- **Feature-based organization is the target** (`02-PLAN.md` §2). Everything for a feature lives
  together under `features/<x>/`. Decided, not optional.
- **Routing stays the current `switch`/`useState`.** No router migration; only delete vestigial
  artifacts (`ProtectedRoute`, dead `/oauth/callback`) in Phase 6.
- **Path alias `@/*`** is used for all new/edited imports.
- **Touch-once, feature-by-feature** (§3): when we open a feature we move *and* restyle it in the same
  pass. New files are born in their final location. Never create-then-move.
- **Both build targets must stay green** every phase. **No scope creep** into product features/behavior.

---

## 3. The document set (what to read, what each is for)

All revamp docs live in **`STUDIO/frontend-revamp/`**. They are internal working docs (they preserve
project context; they are not open-source-style docs).

| # | Document | Purpose | You READ it… | You UPDATE it… |
|---|---|---|---|---|
| **00** | **`00-INTENT.md`** (this file) | Constitution: philosophy, ground rules, mandatory workflow, verification process, completion criteria, onboarding. The process source of truth. | **First, every session.** | When the *process/rules* change (rare, deliberate). |
| **01** | `01-AUDIT.md` | The audit (evidence library) + the **finalized design philosophy & semantic token system** (§11–§12). Answers "what's wrong and why" + "what the design *is*." | Before any implementation, to ground design/decisions. | When you discover a new codebase deficiency, or refine the design system. |
| **02** | `02-PLAN.md` | The **execution plan + live progress tracker**: phases, tasks (ID/priority/risk/files/Done-when/status), dependencies, verification gates, dashboard. The plan of record. | Before a phase (read that phase) + to know status. | **After every completed task** (tick box, update §9 dashboard) and at phase boundaries. |
| **03** | `03-DECISIONS-AND-CAVEATS.md` | Implementation-level reasoning not obvious from code: decisions, exceptions, assumptions, deliberate "left untouched", deferrals, cross-phase dependencies, known out-of-scope bugs. | When implementing (for prior context) and when you hit a non-obvious choice. | **Whenever something noteworthy happens** during implementation/verification. |
| **04** | `04-PHASE-SUMMARIES.md` | One concise overview **per completed phase**: what changed, decisions, trade-offs, clarifications, **and the verification results**. | When onboarding or building on a prior phase. | **After every completed phase** (and only once that phase's verification has passed). |
| — | `README.md` | Thin index/landing that points here. | If lost. | When the doc set changes. |

**Precedence when docs disagree:** process → `00-INTENT.md`; the plan/sequence/Done-when →
`02-PLAN.md`; design specifics/tokens → `01-AUDIT.md` §11–§12 (but `02-PLAN.md` bakes in the final
decisions, so where the audit predates a decision, the PLAN wins).

---

## 4. The mandatory per-phase workflow

Follow these steps **in order**, for **every** phase. Do not skip steps; do not start the next phase
until the current one is *complete* by the definition in §6.

1. **Read `00-INTENT.md`** (this file) — internalize the philosophy and rules.
2. **Read `01-AUDIT.md`** — previous findings, the design system, constraints.
3. **Read the target phase** in `02-PLAN.md` — its tasks, Done-when criteria, dependencies, risks.
4. **Read the supporting docs from prior phases** — `03-DECISIONS-AND-CAVEATS.md` (all of it) and the
   relevant `04-PHASE-SUMMARIES.md` entries. *This prevents re-introducing a library/pattern/decision
   a previous phase already established.* (Cheap to read; high value.)
5. **Examine the actual codebase** — the files the phase will touch and how they're used (grep usages
   before you change/rename/delete anything). Ground yourself in reality, not memory.
6. **Implement the phase** — follow every documented rule, the design system, and the touch-once
   strategy. Update `02-PLAN.md` checkboxes + dashboard **as each task finishes**, and log non-obvious
   reasoning to `03` *as it happens* (don't batch from memory).
7. **Perform the MANDATORY verification pass** (§5) — a dedicated step, *separate from implementation*,
   cross-checking the work against the **actual codebase**, not just the docs.
8. **Fix every issue found** in verification immediately, then re-verify, before proceeding.
9. **Update all documentation**: `02-PLAN.md` (status/dashboard), `03` (decisions/caveats/lessons),
   `04` (the phase summary **including the verification results**), and `01-AUDIT.md` if a finding or
   the design was refined. Record: what was implemented · decisions made · new architectural
   considerations · any new rules/lessons · the verification outcome.
10. **Mark the phase complete** — only after **both** implementation **and** verification have passed
    and the docs reflect reality (§6).

---

## 5. The mandatory verification pass (permanent rule)

> **After completing every phase, perform a dedicated verification pass before moving on. This is a
> mandatory checkpoint, separate from the implementation.** Its purpose is to cross-check the completed
> work against the **actual codebase — not just the documentation** — and to confirm everything was
> implemented correctly. If it passes, mark the phase complete and continue. If it finds issues, fix
> them immediately, then re-verify, before the next phase begins.

**What to look for** (adapt per phase): bugs · architectural inconsistencies · incorrect assumptions ·
missing integrations · overlooked edge cases · anything that could cause problems later.

**Standing checks (always):**
- **Typecheck + both builds green:** run from `STUDIO/` → `npm run build` (desktop: `tsc && vite build`)
  **and** `npm run web:build` (web). A change that passes only one is not done.
- **Run against the code, not the prose:** grep/inspect the real files. Confirm what the docs claim was
  done actually exists and is wired in.
- **Visual / runtime check in light *and* dark:** preview the touched surface; if surfaces are gated
  (e.g. behind auth) and not reachable, verify the substance directly (e.g. read computed CSS-var /
  utility values at runtime) and say so.
- **No regressions:** the app behaves exactly as before (this is a restyle/reorg).

**Phase-shape-specific checks (examples — think about what *this* phase could break):**
- *Adding tokens/utilities:* did any new name **collide with or newly-activate** an existing class or
  identifier? (grep the codebase for the new names used as classes.)
- *Deleting code/tokens/keyframes:* are they **truly unreferenced**? (grep the name, including indirect
  references, before deleting.)
- *Moving/centralizing definitions:* is there now **exactly one source of truth**? (grep for stray
  duplicate definitions.)
- *CSS/cascade changes:* check **specificity/precedence** edge cases (does a global rule wrongly
  override component intent, or vice-versa?) and unintended side effects (e.g. a property that affects
  the element rather than the decoration).
- *Primitives/a11y:* keyboard focus visible; icon-only controls have `aria-label`; modals trap focus +
  Esc + restore; reduced-motion honored; the §11.1 state model is visually distinct (hover vs selected
  vs hover-on-selected vs focus).

**Record the result** in the phase's `04-PHASE-SUMMARIES.md` entry (and any bug/decision in `03`). A
phase summary is not written until its verification has passed — so the summary's existence *is* the
attestation that verification ran.

---

## 6. Phase completion criteria (definition of done)

A phase may be marked `☑` **only when all** of the following hold:

1. Every task's **Done-when** (in `02-PLAN.md`) is met.
2. **Typecheck + both production builds are green.**
3. The phase's **§4 verification gates** (in `02-PLAN.md`) pass.
4. The **mandatory verification pass (§5)** has run against the codebase and **all issues found are
   fixed and re-verified**.
5. **No behavior regressions** (restyle/reorg only).
6. **Documentation is updated** to reflect reality: `02-PLAN.md` boxes + dashboard; `03` decisions/
   caveats/lessons; `04` phase summary **with verification results**; `01-AUDIT.md` if refined.

If any one fails, the phase is **not** complete — resolve it first.

---

## 7. Cold-start procedure (joining the project fresh)

You have no prior conversation context. To continue correctly:

1. Read **`00-INTENT.md`** (this file) — rules, philosophy, workflow.
2. Read **`01-AUDIT.md`** — design system + findings.
3. Open **`02-PLAN.md`** → §9 dashboard to see **which phase is next** (first row not `☑`).
4. Read **`03-DECISIONS-AND-CAVEATS.md`** (all) and the **`04-PHASE-SUMMARIES.md`** entries for every
   completed phase — this is the historical context that the code alone won't tell you.
5. Read the **target phase** section in `02-PLAN.md`.
6. **Examine the codebase** for the files that phase touches.
7. Execute the §4 workflow for that phase (implement → verify → fix → document → mark complete).

That is sufficient to proceed confidently regardless of which model/conversation completed earlier
phases. Example: if you find Phase 6 done but you last knew Phase 4, steps 1–4 above re-establish all
the context you need to start Phase 7.

---

## 8. Ground rules — quick reference

**Always**
- Read the docs in §4 order before implementing.
- Use the `@/*` alias and the semantic tokens/primitives.
- Keep both builds green; verify after each task and as a hard gate per phase.
- Run the §5 verification pass and document its result before marking a phase done.
- Update `02`/`03`/`04` as you go — the docs are the project's memory.

**Never**
- Introduce an accent color, raw `gray-*`/`dark:*` surfaces, arbitrary `text-[..]`/`z-[..]`, or a raw
  `<button>`/hand-rolled modal where a primitive exists.
- Add product features, change behavior, or migrate routing (out of scope; log bugs in `03`).
- Delete/rename without grepping usages first.
- Mark a phase complete on the strength of the docs alone — verify against the code.
- Rely on memory for non-obvious decisions — write them down.
