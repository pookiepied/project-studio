# Agent Prompts

Seven slices, sliced by **folder for coverage**, not by theme. Thematic synthesis (the
error system, the design system, the layering) happens afterward, by the technical lead
reading all seven. Do not ask one agent to "audit the error system" — it would read the
whole tree shallowly and find the obvious third of it.

Run them independently. They may run in parallel. No agent needs another's output.

Every prompt below assumes the agent has read `00-BRIEF.md` and `02-REPORT-TEMPLATE.md`.
Say so explicitly in the session; do not assume it inferred them.

| Slice | Scope | ~Files |
|---|---|---|
| A | `src/app/` + `src/main.tsx` | 37 |
| B | `src/core/` + `src/lib/` + `src/types/` | 88 |
| C | `src/runtime/` + `src/cliBridges/` | 31 |
| D | `src/ui/` + `src/design/` + `src/index.css` | 45 |
| E | `src/features/chat/` | 90 |
| F | `src/features/{models,workspace,extensions,settings}/` | 77 |
| G | `src/features/{transcription,markdown,voice,manage,artifacts,activity,permissions,memories,auth,computerUse}/` | 79 |

---

## Shared preamble — prepend to every prompt

> You are auditing one slice of the frontend of Project Studio, a Tauri + React 19 +
> TypeScript + Tailwind desktop app. The repository root is `C:\pookiepied\Project Studio`.
>
> Read `Documentation/Tasks/Frontend Audit/00-BRIEF.md` and
> `Documentation/Tasks/Frontend Audit/02-REPORT-TEMPLATE.md` first, in full. They define
> the rules and the required output shape. Follow them literally.
>
> **You are read-only.** Do not edit, create, rename, delete, format, or commit anything,
> with the single exception of writing your own report file. Do not run `npm install`,
> `npm run build`, or any command that mutates the tree. Reading, grepping, and
> `git log` / `git blame` are fine and encouraged.
>
> **Cite `file:line` for every claim.** Uncited claims are discarded.
>
> **Do not propose fixes.** Describe what exists and what is wrong. The architecture
> decision is made by humans downstream, and a solution proposed now will bias it.
>
> Known already, do not re-report: 232 raw `<button>` lint errors, 10 circular imports,
> 0 unused files, 0 unused dependencies, 336 unused exports (mostly barrel re-exports).
> Anything a linter can find is already found. Report what it cannot.
>
> Write your report to `Documentation/Tasks/Frontend Audit/reports/<slice>.md`.

---

## Slice A — App shell

Scope: `STUDIO/src/app/` (36 files) and `STUDIO/src/main.tsx`.

This is where startup, routing, providers, layout, and boot sequencing should live. The
master prompt asks whether the app has a coherent, ordered boot sequence with a single
owner file, or whether startup work is scattered across providers and effects.

Answer specifically:

- What actually runs, in what order, from `main.tsx` to first paint? Trace it.
- Is there a boot sequence with an owner, or is startup an emergent property of `useEffect`
  ordering? Cite the effects.
- Where do version checks, update checks, environment checks, and settings loading happen?
- How many React context providers wrap the tree, what does each own, and do any of them
  own things unrelated to their name?
- Is routing centralized? Are there orphaned routes, or routes defined in more than one place?
- Does `app/` contain code that is really a feature, or really runtime/native logic?

---

## Slice B — Core, lib, types

Scope: `STUDIO/src/core/` (61), `STUDIO/src/lib/` (22), `STUDIO/src/types/` (5).

`core/` is the layer everything depends on, so a defect here is load-bearing. It is
already known that `core/network/fallbackService.ts` and `core/storage/chatHistoryService.ts`
import from `features/` — an inversion. Find the rest.

Answer specifically:

- **Every** import from `core/` or `lib/` into `features/`, `ui/`, or `runtime/`. Exhaustive,
  with file:line. This is the single most important output of this slice.
- What distinguishes `core/` from `lib/`? Is the distinction real, stated anywhere, and
  observed in practice? If `lib/` is a junk drawer, say so and prove it.
- What lives in `types/` versus types defined next to their owner? Is there a rule? Is it followed?
- Does `core/` contain business logic that belongs to a feature?
- `core/permissions` and `core/mcpRegistry` — are these genuinely cross-cutting, or a
  feature that got promoted?
- Duplicated utilities: same function, two homes. Cite both.

---

## Slice C — Runtime and CLI bridges

Scope: `STUDIO/src/runtime/` (26), `STUDIO/src/cliBridges/` (5).

`runtime/` is the desktop-backend layer: the Tauri bridge, filesystem, shell, process
execution, software detection, updates, local tool execution. The rule is that UI calls
typed services and native details never leak upward.

`cliBridges/` is a **live, load-bearing subsystem** — Claude CLI integration, with Codex /
OpenCode / KiloCode planned. It has previously been misfiled as dead code. It is not.
Audit it fully. Recommend nothing about removing it.

Answer specifically:

- Does anything outside `runtime/` invoke Tauri, the filesystem, or a shell directly,
  bypassing the runtime layer? (You may grep the whole `src/` tree for this one question.)
  Cite every instance.
- Does `runtime/` import from `features/`? A known instance is
  `runtime/execution/types.ts:15` → `@/features/chat/context/types`. Find all others.
  Madge cannot see these unless they form a cycle.
- Is `runtime/`'s public surface (`runtime/index.ts`) a deliberate API, or a barrel that
  re-exports everything it can reach? Does anything import runtime internals directly,
  bypassing it?
- What does `cliBridges/` actually do, what depends on it, and where does it sit in the
  layering? Is it a feature, a runtime concern, or a third thing?
- How does the local-tool execution path handle failure, permission denial, and timeout?

---

## Slice D — UI and design system

Scope: `STUDIO/src/ui/` (43), `STUDIO/src/design/` (1), `STUDIO/src/index.css`.

The design system is partly enforced already: eslint errors on raw hex, arbitrary
`text-[…]`, `rounded-[…]`, `duration-[…]`, and raw `<button>`. Four of those five are at
zero violations. So the *tokens* are largely adopted. The question is whether the system
underneath them is coherent.

Answer specifically:

- Where do tokens actually live — `design/`, `index.css`, `tailwind.config`, or all three?
  Is any value defined twice, in two places, with two values?
- Is `ui/` genuinely free of business logic? Cite every component that fetches, persists,
  branches on domain state, or calls a service.
- What primitives exist, and what is the actual coverage? `<Button>` exists; 232 raw
  `<button>` elements remain. Are there other primitives that exist but are unused, or
  patterns duplicated across features because a primitive is missing?
- Is there an error-display component, an error boundary, an empty state, a loading state?
  One each, or several competing?
- `ui/layout/` — is it layout, or is it a second junk drawer?
- Typography, spacing, z-index: is there a scale, and is it obeyed? Cite z-index values found.

---

## Slice E — Chat feature

Scope: `STUDIO/src/features/chat/` (90 files — the largest single subsystem).

Chat is the product. It has been refactored repeatedly (see `git log --oneline -- STUDIO/src/features/chat`);
expect archaeological layers. Its context directory is known to be tangled with `runtime/`.

Answer specifically:

- Map the state. What lives in `chat/context/`, what lives in components, what is derived,
  what is duplicated. How many distinct stores/contexts/refs hold conversation state?
- `ChatProvider.tsx` — how large, and how many unrelated responsibilities?
- Trace one message end-to-end: user types → request → stream → tool call → render.
  Name every file it passes through. Where does that path do something surprising?
- Where does chat reach into `runtime/`, and where does `runtime/` reach back? Cite both directions.
- Conversation persistence: how many storage paths exist, and do they agree?
- The known refactor debris: files or exports left behind by an incomplete migration.
  Cite them, with the commit that orphaned them if `git log` makes it cheap to find.
- How does chat handle a failed request, a refused tool, a dropped stream? Cite each path.

---

## Slice F — Models, workspace, extensions, settings

Scope: `STUDIO/src/features/models/` (24), `workspace/` (21), `extensions/` (17),
`settings/` (15).

These four are grouped because they are the feature folders most likely to contain
runtime/native logic and cross-feature coupling. `models/services/` is known to import
`core/network/fallbackService`, which imports back.

Answer specifically:

- For each of the four: does it have a coherent public surface (`index.ts`), or do other
  features import its internals directly? Cite the deep imports.
- `models/` — how many services, and do their responsibilities overlap?
  (`modelService`, `modelCapabilityService`, `localModelDetection`, `localUsageService`
  all exist. Are those four things, or one thing wearing four hats?)
- `workspace/browser/` — `BrowserPanel.tsx` and `NativeBrowserHost.tsx` form a cycle and
  `BrowserPanel` is the single worst lint offender (15 raw buttons). What is actually
  going on in there? Is native browser logic sitting inside a component?
- `settings/` — where is settings state persisted, who reads it, and does anything read
  it before it has loaded?
- `extensions/` — what is an extension here, and how does it relate to `skills/` and
  MCP at the repo root? Describe the boundary; do not read the backend.

---

## Slice G — Remaining features

Scope: `STUDIO/src/features/` — `transcription/` (13), `markdown/` (12), `voice/` (11),
`manage/` (9), `artifacts/` (9), `activity/` (9), `permissions/` (5), `memories/` (5),
`auth/` (5), `computerUse/` (2).

Ten small features. The question is less about each one's internals and more about
**consistency across them** — ten folders built at ten different times, by an LLM, will
have drifted.

Answer specifically:

- Compare their shapes. Which have `index.ts`, `components/`, `hooks/`, `services/`,
  `types.ts`? Produce a table. Where is the convention, and how many folders honor it?
- Which of these are real features, and which are utilities that got a folder?
  (`markdown/` — is that a feature or a UI concern? `manage/` — manage *what*?)
- `computerUse/` is 2 files. Is it a stub, a shim, or dead? Prove which. Do **not** assume
  dead: this repo has previously misfiled live subsystems as dead code.
- `permissions/` here versus `core/permissions/` — two homes for one concept?
- `auth/` here versus `auth/` at the repo root — describe the boundary and where it crosses.
- Error handling and design-token usage across all ten: is it consistent? Cite the outliers
  in both directions — the worst and the best.
