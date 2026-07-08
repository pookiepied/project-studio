# Decisions & Caveats

Implementation-level context that is **not** obvious from reading the code: decisions, exceptions,
assumptions, deliberate "left untouched" calls, deferrals, cross-phase dependencies, and known
out-of-scope bugs. This is the catch-all for reasoning — when in doubt, record it here.

This file is **not** for completed-task status (that's `02-PLAN.md`) or for high-level locked
design/architecture decisions (that's `02-PLAN.md` §8). It's for the "why" behind implementation.

**Entry types:** `D` decision · `C` caveat/assumption · `DEF` deferred · `DEP` cross-phase dependency · `BUG` known out-of-scope bug · `OPEN` unresolved question.
Format: `ID — title` · phase · short body (what + why + affected files + follow-up).

---

## Phase 0 — Enablers & scaffolding

- **D-001 — Documentation centralized in `STUDIO/frontend-revamp/`** · P0
  All revamp docs moved here (audit → `01-AUDIT.md`, plan → `02-PLAN.md`, via `git mv` to preserve
  history) and renamed for navigability. Future revamp docs stay here. Reason: docs were scattered
  at `STUDIO/` root and growing. References updated in `eslint.config.js` and `src/features/README.md`.

- **C-001 — No empty folder skeleton; folders created on demand** · P0
  Original plan T0.2 said scaffold ~40 empty dirs with `.gitkeep`. We instead documented the
  feature-based convention in `src/features/README.md` and create each folder when it first receives
  a file (`tokens/` Phase 1, `components/feedback/` Phase 3, each `features/<x>/` in Phase 4). Reason:
  avoid speculative empty-dir churn. New files are still born in their final location.

- **C-002 — `components/overlay` kept singular (not `overlays`)** · P0
  Plan §2 target uses `components/overlays`; the existing dir is `components/overlay`. Not renamed
  yet to avoid churn. Follow-up: reconcile the name during Phase 3 (layout/overlay work).

- **C-003 — 27 pre-existing ESLint errors left as-is** · P0
  The ESLint baseline surfaced 27 errors from standard recommended rules (`no-empty`×10,
  `no-control-regex`×7, `prefer-const`×3, etc.). These are pre-existing code-quality debt, unrelated
  to the design system, and lint is not in the build — so they block nothing. Not fixing now (out of
  scope). May be cleaned up opportunistically when their files are touched.

- **C-004 — DS hex lint rule will flag legitimate hex** · P0
  The warn-only `no-restricted-syntax` hex rule flags ALL `#rrggbb` literals, including legitimate
  ones (brand logos, xterm/mermaid theme objects, gradient shaders). Expected. During migration,
  resolve each either by tokenizing or with a targeted `// eslint-disable-next-line` + a one-line
  reason. Do not broaden the rule to allow hex generally.

- **DEP-001 — Use the `@/` path alias for all new/edited imports** · P0
  Alias `@/* → src/*` is live in `tsconfig.json`, `vite.config.ts`, `vite.config.web.ts`. All new
  code and any touched imports should use it; this is what makes the Phase 4–5 file moves cheap.

- **BUG-001 — `FasterWhisperStatus.tsx:51` calls `useEffect` conditionally** · found P0
  Real `react-hooks/rules-of-hooks` violation (latent React bug), pre-existing. Out of scope for the
  design refactor. **Fix when migrating the transcription feature (Phase 4.8).**

- **BUG-002 — `GlobalShortcutHandler.tsx:155` stale `eslint-disable`** · found P0
  Unused `eslint-disable` directive for `react-hooks/exhaustive-deps` (no longer suppresses
  anything). Trivial. Remove when this file is touched (chat/shortcuts work).

## Phase 1 — Token & global-style foundation

- **D-101 — Muted text refined from §12 working values for AA** · P1
  §12 listed working muted values (light `#767676`, dark `#7A7A7A`) "to be contrast-verified before
  lock." Verified: those clear AA on pure white / pure page only, but **fail ~4:1 on the elevated
  surfaces they're most used on** (`surface-base`/`surface-raised`). Locked instead: **light
  `#6E6E6E`, dark `#8A8A8A`** — ≥4.5:1 on page/base/raised in both modes. Primary (#000 / #F2F2F2)
  is AAA. Affected: `src/tokens/tokens.css`. (Read 01-AUDIT §12 table with this in mind.)

- **D-102 — Reduced motion centralized via `<MotionConfig reducedMotion="user">`** · P1 (T1.5/T1.7)
  The plan said "adopt `useReducedMotion()` in animations.ts consumers." `animations.ts` is a plain
  constants module (no hooks), and per-consumer gating would touch dozens of files — against the
  no-behavior-change / touch-once intent of this phase. Instead wrapped the app root (`src/App.tsx`)
  in framer's `<MotionConfig reducedMotion="user">`, which honours the OS setting for **all** framer
  animations in one place. The global CSS `@media (prefers-reduced-motion: reduce)` block covers CSS
  transitions/keyframes. Net result is the same with one edit instead of many. Per-component
  `useReducedMotion()` only if a specific animation needs finer control later.

- **D-103 — `scale-in` keyframe kept (audit's "4 dead" was 3 dead)** · P2 (T1.7)
  The audit/plan assumed 4 dead Tailwind keyframes with only `shimmer` worth keeping. Grep shows
  **`animate-scale-in` is used in `Select.tsx:49`** (`data-[state=open]:animate-scale-in`), so it is
  NOT dead. Deleted only the genuinely unused `slideUp`/`pulseSmooth`/`listening`; kept `scaleIn` +
  `shimmer`. Affected: `tailwind.config.js`.

- **D-104 — Git-diff syntax highlighting made neutral (no green/red)** · P1 (T1.3)
  hljs `.hljs-addition`/`.hljs-deletion` previously used green/red fills + text. The neutral system
  forbids hue, and §12 mandates a grayscale-only `syntax-*` ramp. Additions now use a faint neutral
  fill (`--syntax-add-bg`); deletions a faint neutral fill **+ strike-through** (`--syntax-del-bg`),
  so the two stay distinguishable without colour. Affected: `src/index.css`, `src/tokens/tokens.css`.

- **C-101 — Typography cleanup done partially (font aliases deferred)** · P3 (T1.6)
  Resolved the real bug (the `.tracking-*-wide` value collision: CSS 0.08/0.06 silently overrode
  config 0.15/0.10 — unified into config at the rendered values). **Left as-is:** the `sans`/
  `display`/`serif` fontFamily aliases (all identical today) and the benign `.font-display`
  utility-vs-CSS-class merge (the CSS class augments with letter-spacing + weight; both coexist
  predictably). Touching the `font-display` shape would ripple through 26+ files — out of scope for a
  token-only phase and risks "no behavior change." Revisit if the families ever diverge.

- **C-102 — `surface-lift` kept as a deprecated alias of `surface-selected`** · P1 (T1.1/T1.2)
  §12 drops `lift`, but `bg-surface-lift` is consumed across the app. Mapped `--surface-lift` to the
  new `surface-selected` value (the "stronger than hover" fill) so existing call-sites stay sensible;
  flagged `@deprecated` in Tailwind config. Removed in Phase 6 once those call-sites migrate.

- **C-103 — Token source lives in `src/tokens/tokens.css`, imported via JS** · P1 (T1.1)
  Plan §2 wanted a `tokens/` home. Created `src/tokens/tokens.css` and imported it in `main.tsx`
  **before** `index.css` (JS import via Vite — CSS `@import` is unreliable in Tauri WebKit, per the
  existing note in `index.css`). The Tailwind "bridge" half necessarily stays in `tailwind.config.js`.
  Pitfall hit & fixed: a CSS comment containing the `*/` glyph sequence (`--text-*/...`) closed the
  comment early and broke the build — avoid `*/` inside CSS comments.

- **C-104 — Legacy palettes deprecated, not deleted (compile-keepers)** · P1 (T1.2)
  `luxury.*`, `dark.*`, `success/error/warning/info`, `shadow-dark-*`, `surface-lift` remain defined
  (now flagged `@deprecated`) so the many un-migrated `dark:bg-dark-*` / `text-error` / `shadow-dark-lg`
  call-sites still compile. Removed in **Phase 6 (T6.1)** after per-feature adoption. Their presence
  is expected and is NOT a sign the neutral system is incomplete.

- **C-105 — Phase 1 visual check done via runtime token eval, not screenshots** · P1 (§4)
  The only un-authenticated surface is the WebGL shader welcome page (continuous animation →
  screenshot capture hangs); the real themed surfaces are behind login, unreachable in preview.
  Verified instead by reading computed CSS-var values + sample Tailwind utilities at runtime in both
  light and dark (all correct), plus both production builds green. Full visual sign-off of themed
  surfaces happens naturally as features are migrated/adopted in Phase 4.

- **D-105 — Removed `border-radius` from the global `:focus-visible` rule (self-found bug)** · P1
  Caught during the post-Phase-1 verification pass: the global `:focus-visible` rule originally set
  `border-radius: 2px`, which changes the *element's own* radius (not the outline's) while focused —
  pills/rounded cards/circular buttons would snap toward square corners on keyboard focus. Removed
  it; modern WebKit/Chromium (Tauri WebView2 + browsers) already make `outline` follow the element's
  intrinsic radius. Rule is now just `outline: 2px solid var(--focus-ring); outline-offset: 2px`.
  Also confirmed during the pass: (a) the new top-level ink/focus/marker Tailwind colours don't
  shadow or newly-activate any existing class (no source uses `text-muted`/`bg-secondary`/etc. as
  classes); (b) deleted keyframes `slideUp`/`pulseSmooth`/`listening` are unreferenced (the many
  `listening` hits are the voice-session state, not `animate-listening`); (c) tokens are defined in
  exactly one place (`tokens.css`); (d) `focus:outline-none` (specificity 0,2,0) correctly overrides
  the global `:focus-visible` (0,1,0), so components that manage their own focus are unaffected and
  the global rule only acts as a baseline for otherwise-unstyled controls.

- **OOS-101 — Voice orb uses hardcoded blue/violet gradients (out of Phase 1 scope)** · noted P1 · **RESOLVED 2026-07-06 (T4.9)**
  `VoicePage.tsx`, `VoiceOrb.tsx`, `ChibiAvatar.tsx` use literal accent-colour gradients
  (`#3b82f6`, `#d9e6fd`, …) that violate the no-accent rule. These are component-internal, not global
  CSS, so they're untouched in Phase 1. Address during **Phase 4.9 (voice)** — and that migration
  needs a design call on whether the orb's "more blue = listening / more violet = speaking" state
  signalling can survive in a strictly neutral system, or must become weight/animation-based.
  **Resolution (T4.9, 2026-07-06):** (a) **The audit's listing of `VoiceOrb.tsx` + `ChibiAvatar.tsx`
  was stale** — grep at the start of T4.9 returned 0 matches for either file. The existing
  `pages/VoicePage.tsx` file header even explicitly states "No orb. No avatar box. The entire page
  breathes…" — the gradient IS the visual (a deliberate redesign that predated the audit's "orb"
  assumption). So the migration scope shrank to just `VoicePage` + its private `liveSessionSounds`
  util (D-419). (b) **The user's design call — recorded at the same time, 2026-07-06 — was
  "Neutralize fully"** (see D-418): the gradient loses ALL hue and shifts entirely onto the
  `var(--surface-*)` token ramp; per-state signalling moves to opacity + drift speed + radial-pulse
  cadence + a single neutral dot/`Warning` glyph. Confirming the user's intent: the orb-state hue
  cannot survive a strictly neutral system — it became opacity+animation+weight-based, exactly the
  second option the original note posed.

---

- **OPEN-001 — Destructive/error functional color** · ongoing
  Current decision is fully neutral (no red): destructive = filled graphite + icon + weight. If a
  single functional signal is ever deemed necessary for safety, it requires human sign-off before
  introduction. Until then, stay neutral. (Also in `02-PLAN.md` §8.)

## Phase 2 — Core UI primitives

- **D-201 — `Button` hover uses color only; press scale retained** · P2 (T2.1)
  Upgraded `src/components/ui/Button.tsx` onto semantic tokens and removed the 1.02 hover scale so
  hover is expressed through the quiet `surface-hover` / emphasis-token channel instead of motion.
  Kept the existing `whileTap: { scale: 0.98 }` press response because it is transient, already part
  of the primitive contract, and does not compete with hover/selected state channels. The Phase 1
  root `<MotionConfig reducedMotion="user">` still handles reduced-motion preferences globally.

- **C-201 — Existing `Button` consumers may still pass legacy accent classes** · P2 (T2.1)
  `Button` itself now has no internal raw gray/dark/red/black classes, but its public API still
  intentionally supports `className` passthrough. Cross-checking current consumers found
  `FasterWhisperStatus.tsx` passing `text-red-*` to one delete button and using green status icons in
  Button-adjacent content. Those are feature-surface styling issues, not primitive implementation
  issues; leave them for the transcription migration (T4.8) unless that component is otherwise
  touched sooner.

- **D-202 — Modal labels are generated via context for `ModalHeader`** · P2 (T2.2)
  `Modal` now creates a stable `useId()` label id and provides it through an internal context so
  `ModalHeader` can attach the matching `id` to its `<h2>`. Consumers can override with
  `ariaLabelledBy` or use `ariaLabel` when they intentionally render a dialog without `ModalHeader`.
  This keeps the common case accessible without requiring every future modal migration to manually
  coordinate ids.

- **D-203 — `IconButton` requires `"aria-label"` by type** · P2 (T2.3)
  Added `src/components/ui/IconButton.tsx` as a typed primitive instead of continuing ad-hoc
  `p-1.5 rounded...` close/action buttons. The prop interface omits the optional native
  `"aria-label"` and reintroduces it as required, so icon-only controls fail typecheck unless they
  provide an accessible name. Variants mirror `Button`'s neutral semantics.

- **C-202 — Modal close icon uses Phosphor directly until Phase 3 icon barrel** · P2 (T2.2)
  T2.2 asked for `IconButton` + icon-barrel `Close`, but the semantic icon barrel is explicitly T3.4
  and does not exist yet. To avoid starting Phase 3 prematurely, `ModalHeader` now uses
  `XIcon as X` directly from `@phosphor-icons/react`; replace that with the barrel's `Close` export
  during T3.4.

- **D-204 — Field primitives own the `size` prop** · P2 (T2.4)
  `Input` and `Textarea` expose `size?: "sm" | "md" | "lg"` for visual scale consistency with the
  rest of `components/ui`. For `Input`, this intentionally omits the native numeric `size` attribute
  from the public type; future consumers that truly need native character-width sizing should use
  CSS width utilities instead so layout stays in the design system.

- **D-205 — `Spinner` uses `motion-safe:animate-spin`** · P2 (T2.5)
  The loading primitive still uses Tailwind's spin keyframe, but only behind the `motion-safe:`
  variant. This preserves the familiar indeterminate loader while making the reduced-motion state
  static under the Phase 1 global reduced-motion policy. `Button` uses `Spinner decorative` so it
  does not add duplicate status announcements beside the button label.

- **D-206 — `Toggle` checked state uses neutral emphasis, not hue** · P2 (T2.6)
  `Toggle` now expresses its persistent on/off state with `bg-primary` for checked and
  `bg-surface-selected` for unchecked, plus the existing switch position. This keeps binary state
  clear without introducing blue/green accent semantics. The primitive also accepts native button
  props, but keeps `role="switch"`, `aria-checked`, and `type="button"` controlled internally so
  callers cannot accidentally weaken the accessibility or form behavior.

- **C-203 — `Select` keeps the Radix trigger-width layout variable** · P2 (T2.6)
  `Select` still uses `w-[var(--radix-select-trigger-width)]` for the popover content width. This is
  a Radix positioning/layout variable, not a color/radius/z-index/design-token escape hatch, and it
  preserves existing trigger/content alignment. The Phase 2 guardrail scan intentionally targets the
  risky arbitrary classes (`text-[...]`, `rounded-[...]`, `z-[...]`) rather than this layout hook.

- **D-207 — `Badge` is neutral by default, including status dots** · P2 (T2.7)
  Added `Badge` as a pill primitive with neutral tones only (`default`, `strong`, `muted`, `outline`)
  and an optional dot that also uses ink tokens rather than status hue. Feature migrations can pair a
  badge with an icon/weight/text label for success/error/warning semantics, but the primitive itself
  does not reintroduce blue/green/red/amber accents.

- **D-208 — `EmptyState` owns the display `title` prop** · P2 (T2.7)
  `EmptyState` accepts a React `title` node for the visible empty-state heading, so its props
  intentionally omit the native `HTMLAttributes<HTMLDivElement>["title"]` string tooltip attribute.
  This mirrors the earlier `Input size` pattern: primitive-owned semantic props take precedence over
  conflicting native names. Use `aria-label`/`aria-labelledby` or wrapper copy for additional
  accessible naming instead of native `title`.

- **C-204 — Phase 2 verified the primitive set, not every historical file under `components/ui`** · P2
  The end-of-phase guardrail scan covered the sanctioned Phase 2 primitives (`Button`, `Modal`,
  `IconButton`, `Input`, `Textarea`, `Spinner`, `Card`, `Select`, `Toggle`, `SettingsRow`, `Badge`,
  `EmptyState`). `components/ui` still contains older non-primitive/feature-adjacent files such as
  `HarnessStepCard.tsx`; those remain for the Phase 4-5 feature/shared-layer migration work. Do not
  interpret Phase 2 completion as "every file currently located in `components/ui` is token-clean."

## Phase 3 — Layout, overlay & icon systems

- **D-301 — `Popover`/`DropdownMenu` use direct Radix dependencies** · P3 (T3.1)
  Added `@radix-ui/react-popover` and `@radix-ui/react-dropdown-menu` as direct dependencies and
  wrapped them in `src/components/ui/Popover.tsx`. The plan assumed Radix was already available, but
  only Select was a direct dependency. Using Radix here gives the required dismissable layer,
  outside-click handling, Esc close, menu roles, roving focus, and arrow-key behavior without
  creating a custom menu engine.

- **C-301 — T3.1 creates the shared mechanism; consumer migration remains T3.3** · P3 (T3.1)
  Existing hand-rolled popovers/menus were intentionally left in place during T3.1. The primitive and
  exports now exist for future adoption; `ContextMenu`, `NavPopup`, `FloatingMenu`, `AppsPopover`,
  and related overlay/layout cleanup are the explicit scope of T3.3/T3.6.

- **C-302 — `npm install` surfaced unrelated dependency-health warnings** · P3 (T3.1/T3.2)
  Installing the Radix wrappers reported 13 audit findings (1 low, 5 moderate, 7 high) and an
  existing peer warning from `@rolldown/plugin-babel` through `agents` expecting Vite 8. These were
  not changed with `npm audit fix` because that would create unrelated dependency churn outside the
  frontend revamp task.

- **D-302 — `Tooltip` uses Radix parts instead of native `title=`** · P3 (T3.2)
  Added `@radix-ui/react-tooltip` and wrapped provider/root/trigger/content/arrow in
  `src/components/ui/Tooltip.tsx`. This gives keyboard and pointer/touch behavior in a composable
  primitive while keeping existing call-sites unchanged for now. Replacing the many native `title=`
  attributes remains adoption work during Phase 3 shared-menu cleanup and Phase 4 feature migration,
  so T3.2 does not churn unrelated feature files.

- **D-303 — T3.3 standardizes the LIVE menus in place; not forced onto Radix** · P3 (T3.3)
  `ContextMenu` and `NavPopup` were tokenized onto the neutral system + given the §11.1 channel
  separation + correct a11y **in place**, rather than rewritten onto the T3.1 Radix primitive:
  • `ContextMenu` is a global *cursor-positioned* right-click menu — Radix's trigger-anchored model
    doesn't fit without wrapping app content in a `ContextMenu.Trigger`. Kept custom; added
    `role="menu"`/`menuitem`, Esc, and arrow-key roving focus (focus first item on open).
  • `NavPopup` is a flyout **panel** containing a search textbox + sectioned nav + footer. A
    `role="menu"` is invalid with a textbox inside, and adopting `PopoverContent` would force
    trigger-ref restructuring in `MainLayout`/`TitleBar` (behavior-sensitive). Kept its existing
    Esc + click-outside + focus-on-open; labelled it `role="dialog"` aria-label="Navigation",
    added `aria-current` to nav rows + `aria-label` to the icon-only clear button.
  Both already live in `components/layout/` (their §2 home) — no moves. Both **dropped the
  frosted-glass look** (`backdrop-blur` + translucent bg + arbitrary shadows) for opaque
  `bg-surface-base` + `border-surface-border` + `shadow-xl`, matching the T3.1/T3.2 primitives
  (confirmed acceptable with the user when starting T3.3). State model: selected =
  `bg-surface-selected` + `text-primary` + medium weight; hover = `bg-surface-hover` only.

- **D-304 — Design direction refined + calibration applied: avoid pure `#000`** · cross-cutting (decided & applied 2026-06-28)
  User reviewed the half-migrated UI and found pure black harsh / "low quality." Confirmed direction:
  premium **neutral** system (not strict B&W) — **near-black ink `#1A1A1A`** (not `#000`), **premium-grey
  focus ring**, near-black **marker**, soft-white `#F2F2F2` in dark. The §12 surface-role ladder is
  unchanged; this is a value tune, not a redirection. **Applied as a single-file `tokens.css`
  calibration pass** (2026-06-28): `--text-primary` `#000`→`#1A1A1A` (light); `--marker`
  `#000`→`#1A1A1A` (light); `--focus-ring` `#000`→`#5A5A5A` (light) / `#FFF`→`#A8A8A8` (dark). The
  change propagates globally + retroactively to every token-consuming surface — no per-component work.
  Both builds verified green. Docs (01-AUDIT §11/§12, 02-PLAN §8) in sync. Process model agreed: don't
  fix the look reactively per-instance (thrash), don't wait for a giant end-of-project redesign —
  capture concerns, keep the structural migration moving, and tune token *values* at a dedicated
  calibration checkpoint (the look is a global dial decoupled from the migration). True philosophy
  violations (accent colour, literal black borders) are still bugs to fix on sight.

- **FOCUS-301 — Why focus showed a solid black border (root cause + fix applied)** · P3 (T1.5 origin) · RESOLVED 2026-06-28
  Source: the Phase 1 global rule `:focus-visible { outline: 2px solid var(--focus-ring) }` with
  `--focus-ring` then **pure `#000`**, plus a few un-migrated components hardcoding
  `focus-visible:ring-black`. **Text fields** showed it on plain click because browsers treat
  text-input focus as always `:focus-visible`; **buttons** (e.g. the model selector) showed it on
  keyboard focus (or via their own hardcoded ring). Working as designed — just too harsh because the
  token was pure black. **Fix (calibration, applied):** `--focus-ring` is now premium-grey `#5A5A5A`
  (light) / `#A8A8A8` (dark) — the secondary-ink weight, ~6.9:1 / ~7:1 contrast (visible + accessible,
  not a black border). **Decision:** focus ring intentionally diverges from the ink family (text/marker
  = near-black `#1A1A1A`); it sits at *secondary*-ink grey because focus is a transient affordance, not
  content, and the user wants the premium-grey accent — not a near-black outline. Also fixed
  `ModelPicker`'s hardcoded `ring-black` → `ring-focus` (the model-selector button the user named).
  Remaining hardcoded `ring-black`/`ring-gray-*` instances are swept during each component's feature
  migration (see Phase 6 leftover sweep).

- **C-303 — `FloatingMenu` and `AppsPopover` are dead code — NOT migrated in T3.3** · P3 (T3.3) → T6.2
  Usage grep at T3.3 start: `AppsPopover` has **no importers at all**; `FloatingMenu` is **only
  re-exported by `components/index.ts`** with no actual consumer. The audit (Appendix B) listed both
  as hand-rolled popovers to standardize, but they render nowhere, so tokenizing/adding a11y to them
  would be wasted, scope-violating work. Left untouched and flagged for **Phase 6 T6.2 dead-code
  removal** (removing `FloatingMenu` must also drop its barrel export). This narrows T3.3's effective
  scope from 4 menus to the 2 live ones (`ContextMenu`, `NavPopup`). Confirm deletion with a human at
  T6.2 per the dead-code policy.

- **C-304 — Icon barrel exists but is not yet adopted; two small deviations** · P2 (T3.4) → Phase 4
  T3.4 *built* the semantic barrel (`components/icons/index.tsx`); it does **not** rewrite the ~107
  files still importing Phosphor glyphs ad-hoc — that adoption is per-feature touch-once work in
  Phase 4 (and the duplicate-glyph retirements F4–F7 happen as each feature is migrated). Deviations
  from the DOC's literal concept list, both intentional: (1) **`ErrorIcon`**, not `Error` — exporting
  `Error` would shadow the JS global in any consumer that imports it; (2) added **`Collapse`**
  (`CaretRight`) alongside `Expand` (`CaretDown`) since the §17 row pairs them. The barrel also exports
  `Icon` (raw-glyph escape hatch), `makeIcon`, `iconSize`, and the `IconSize`/`IconProps` types so
  migrating features can add concepts without importing Phosphor directly. `index.tsx` (not `.ts`)
  because the wrapper/factory render JSX.

---

## Phase 3 continued (T3.5 / T3.6)

- **D-305 — BrandLogo uses a two-layer model: generic primitive + provider-specific router** · P3 (T3.5)
  `BrandLogo` (in `brand/`) is the dumb rendering primitive: accepts `path?: string` (SVG path from
  simple-icons), `monogram: string` (2-3 char fallback), `label: string` (a11y). `ProviderIcon` is the
  routing layer: holds the AI-provider slug→icon+monogram map and the OpenRouter passthrough logic,
  delegates badge rendering to BrandLogo. `ProviderIcon` is now tokenized (badge uses `bg-surface-raised
  border-surface-border text-muted`). Moves to `features/models/` in Phase 4 T4.5; `BrandLogo` stays
  in `brand/`. `ProjectLauncher` (dev-app logos) + MCP/extension logo sets adopt BrandLogo in Phase 4.

- **C-305 — UpdateBanner green status + raw-dark CTA — RESOLVED in pre-Phase-4 review (2026-06-28)** · P3 (T3.6)
  Both gaps were fixed during the pre-Phase-4 cross-reference review:
  (1) The "Update complete" state used `green-*` — a violation of the settled "no accent colors EVER"
  ground rule (00-INTENT §2; colorless status §11.3). **Fixed** → neutral surface (`bg-surface-hover`
  + `border-surface-border`) + filled `CheckCircle` in `text-primary`. (Reversible if a success hue is
  ever explicitly wanted, but that would require relaxing a settled rule.)
  (2) **Correction to the original note:** the claim "the token system has no always-dark surface" was
  **wrong**. The sanctioned inverted-emphasis treatment is `bg-primary text-on-emphasis
  hover:bg-secondary` — exactly what the `Button` primitive's `primary` variant uses
  (`Button.tsx:36`); `--text-primary` used as a *fill* gives near-black in light / soft-white in dark,
  and `--text-on-emphasis` is the paired label colour. **Fixed** the "Install & Restart" CTA to those
  tokens. The same correct pattern was also applied to `PermissionDialog`'s "Allow Access" CTA and
  `ExternalLink`'s "Open" pill (both previously raw `bg-gray-900`). Ideal end-state is still adopting
  `<Button variant="primary">` directly during each component's Phase-4 feature pass, but they are now
  token-correct in the meantime.

- **C-306 — Super-overlay z-indexes sit above the token scale** · P3 (T3.6) → add z tokens in Phase 4 or T6.1
  The z-scale tops out at `z-context: 80` (`tailwind.config.js`), but two full-screen super-overlays
  legitimately need to sit above everything: `CommandPalette` uses `z-[100]`/`z-[101]` (scrim + panel)
  and `OfflineModal` uses `z-[300]` (must cover the command palette too). These arbitrary z-values are
  functionally correct but not tokenized. **Recommended fix:** extend the scale with e.g.
  `z-command: 90` and `z-blocking: 100` (or similar) in `tailwind.config.js`, then swap the arbitrary
  values. Low priority — purely a tokenization tidy, no behavioural impact. (Confirmed during the
  pre-Phase-4 review.) The CommandPalette's lighter scrim (`bg-black/30`, not the full `--scrim` 0.45)
  is intentional — it is a lighter overlay than a blocking modal.

- **C-307 — Pre-move component copies retained by explicit decision (NOT to be deleted)** · P3 (T3.6) → final cleanup pass
  T3.6 *moved* these components to their new homes (`feedback/`, `overlays/`) and repointed every
  import; that left the original-path copies in place. **User decision (2026-06-28): keep all of them
  committed in the repository as active project files — do NOT delete during phase work.** A single
  dedicated cleanup pass at the very end of the project will identify and remove genuinely unused
  files; until then these (and any other not-yet-wired files) are treated as part of the active
  implementation. Pre-move copies still present: `src/components/SplashScreen.tsx`, `OfflineModal.tsx`,
  `UpdateBanner.tsx`, `CommandPalette.tsx`, `PermissionDialog.tsx`, `ui/ErrorDisplay.tsx`, and
  `components/overlay/` (4 files). Note for future engineers: the **live** versions consumed by the app
  are the new-path copies (tokenized); the original-path copies are the older, un-tokenized versions and
  are not imported anywhere — edit the new-path versions. Verified 2026-06-28: no source imports the
  old paths (clean move, no half-wiring).

- **C-308 — OfflineModal eye-dots remain on legacy gray scale** · P3 (T3.6)
  The animated face's eye dots use `bg-gray-400 dark:bg-gray-500` — no semantic surface token maps to
  a decorative mid-gray dot. Left as-is; remove in Phase 6 guardrail sweep (T6.1) or when the
  OfflineModal is redesigned.

- **D-306 — FloatingIsland / overlay quartet moved as-is; frosted glass kept** · P3 (T3.6)
  `FloatingIsland.tsx`, `IslandAtoms.tsx`, `PulseCardView.tsx`, `TranscriptionOverlay.tsx` moved from
  `components/overlay/` → `components/overlays/` (rename; same directory depth, no import changes).
  NOT tokenized on move: the FloatingIsland's frosted-glass visual (`bg-white/[0.92] backdrop-blur-2xl`)
  is an **intentional design exception** — the floating overlay window renders outside the main app
  chrome, so its glass look is a deliberate product decision, not an un-migrated class. Tokenization
  deferred to the Phase 4 voice/overlay feature pass.

---

## Pre-Phase-4 cross-reference review (2026-06-28)

Findings from the comprehensive Phase 1/2/3 doc-vs-codebase verification. Issues marked **FIXED** were
resolved during the review; both builds re-verified green after the fixes.

- **REV-01 — Banned icon weights in primitives + a shared menu — FIXED** · P1/P2/P3
  The §17 rule (resting weight `regular`; `fill` only for active/selected; ban `bold`/`thin`/`duotone`)
  was violated in three already-"complete" files: `EmptyState.tsx` (`duotone`), `Select.tsx` (`bold`
  on the selected-item check), `NavPopup.tsx` (`bold` on the new-chat Plus). All three → `regular`.

- **REV-02 — `00-INTENT.md` §2 still described pure black — FIXED** · doc alignment (critical)
  The constitution's design section still said "primary text is **pure black** `#000`" and
  "selected = … **pure-black text**", contradicting the settled calibration (D-304: near-black
  `#1A1A1A` ink, premium-grey focus `#5A5A5A`/`#A8A8A8`). Rewrote §2 to match. (Note: a few *historical
  done-notes* in `02-PLAN` T1.1 still say "pure-black" as a record of what was authored at the time;
  the live spec is §12 + tokens.css, both correct. Marked with a calibration pointer.)

- **REV-03 — Sanctioned "always-dark" emphasis buttons were raw `bg-gray-900` — FIXED** · P3
  See C-305(2): three CTAs (`UpdateBanner`, `PermissionDialog`, `ExternalLink`) used raw dark grays.
  The correct inverted-emphasis token pattern (`bg-primary text-on-emphasis hover:bg-secondary`,
  = `Button` primitive's `primary` variant) was applied to all three.

- **REV-04 — `ExternalLink` (a sanctioned primitive) was never tokenized — FIXED** · P2 gap
  `ExternalLink` is in the audit §16 sanctioned-primitive list but was **not** scheduled in any Phase 2
  task (T2.1–T2.7), so it kept `gray-*`/`dark:` surfaces, `z-[9999]`, and a raw-dark CTA. Tokenized
  during the review (surface/border/text → tokens, `z-[9999]` → `z-popover`, CTA → emphasis tokens,
  icon weight `bold` → `regular`). Cause: the audit listed it as sanctioned but the plan's P2 task set
  omitted it; flagged so future primitive audits cross-check the §16 list against the task set.

- **REV-05 — `Panel`/`Drawer` primitives listed in audit §16 but never created or scheduled** · P2/P3 gap → Phase 4
  Audit §16 / §13 list `Panel`/`Drawer`✚ as primitives to create, but no Phase 2 or Phase 3 task ever
  scheduled them and they do not exist. **Not a blocker** — no current shared component needs them — but
  Phase 4 features that want a side panel/drawer must either create the primitive first (preferred) or
  the work will hand-roll one (drift risk). Decision: **create `Panel`/`Drawer` on first need in Phase
  4**, in `components/ui/`, following the existing primitive conventions; until then this is a known,
  accepted gap, not a missed implementation.

- **REV-06 — Verified GOOD (no action):** Phase 1 token foundation (`tokens.css` single source; calibrated
  values live: `--text-primary`/`--marker` `#1A1A1A`, `--focus-ring` `#5A5A5A`/`#A8A8A8`); Tailwind
  bridge complete; `main.tsx` imports tokens before `index.css`; global `:focus-visible` + reduced-motion
  present and the D-105 border-radius bug stays fixed. Phase 2 primitive set otherwise clean (no
  `gray-*`/`dark:`/`ring-black`/`#hex`/`transition-smooth`/arbitrary utilities). Phase 3 shared
  components clean of raw black / accent colour (the documented intentional exceptions: FloatingIsland
  frosted glass D-306, OfflineModal decorative eye-dots C-308, CommandPalette lighter scrim C-306). No
  source imports any old pre-move path (C-307). Both builds green.

---

## Phase 4 — Feature-by-feature migration

- **D-401 — Status/health is strict-neutral; no hue, ever (precedent for ALL status surfaces)** · P4 (T4.1) · user-confirmed 2026-06-28
  The Activity dashboard previously used traffic-light colour (emerald/amber/red) for success-rate,
  service health, balance gauges, and error/timeout badges. The user chose **strict neutral** over the
  two alternatives (an error-only restrained signal; a data-viz colour exception). **Rule, applied to
  every Phase-4 status surface:** state reads on the **shade + icon + weight** channels, never hue —
  *healthy/good* = a strong (near-black `bg-primary`) dot; *degraded/soft* = a faint (`bg-muted`) dot;
  *down/error/alert* = a `Warning` glyph (replaces the dot). Counts that signal trouble (e.g. failed
  jobs) use `text-primary` + `font-semibold` for emphasis vs `text-secondary` normal. Progress rings/
  bars use neutral strokes/fills; the *length/offset* carries the magnitude, not colour.
  **Charts (recharts) are the one carve-out:** recharts needs literal colour strings (no CSS classes),
  so bar/axis/grid use neutral, on-ramp grey hex (`#A3A3A3`/`#737373`/`#525252`) + `var(--surface-*)`.
  These carry no semantic hue — they are neutral data-viz geometry, not status colour.

- **D-402 — `ActivityCard*` belongs to chat/tools, NOT the activity feature (plan note corrected)** · P4 (T4.1)
  The §2 structure line "`activity/` … ActivityCard*" was misleading: `components/ui/ActivityCard.tsx`
  and `ActivityCardHeader.tsx` are **tool-call rendering cards** consumed by `ToolCallCard.tsx` — they
  migrate with `chat`/`tools` in **T4.12**, not activity. The real `activity` feature is
  `ActivityPage` + `pages/activity/{components,formatters,types}`. T4.1 migrated only the latter.

- **D-403 — Phase-4 "move" = create-in-final-home + repoint consumers; originals are RETAINED, not deleted** · P4 (process) · user decision 2026-06-28
  The touch-once recipe says "move." Per the standing user decision (C-307: keep everything, defer
  deletion to one final cleanup pass), a Phase-4 migration is executed as: (1) author the file in its
  `features/<x>/` home, refactored; (2) repoint every consumer to the new path; (3) **leave the
  original file in place** (it becomes superseded-but-retained, not imported anywhere). The new-path
  copy is the canonical/live one. A single end-of-project cleanup removes all superseded originals at
  once. **Superseded-but-retained from T4.1:** `pages/ActivityPage.tsx`, `pages/activity/components.tsx`,
  `pages/activity/formatters.ts`, `pages/activity/types.ts`. **Superseded-but-retained from T4.2:**
  `pages/ManagePage.tsx`, `pages/manage/{AiModelsView,WhitelistView,components,helpers,types}.tsx|ts`.
  **Superseded-but-retained from T4.3:** `pages/MemoriesPage.tsx`, `components/MemoriesGraph.tsx`.
  **Superseded-but-retained from T4.4:** `pages/ExtensionsPage.tsx`, `components/extensions/*` (8 files),
  `hooks/useMcpServers.ts`, `hooks/useComposio.ts`.
  **Superseded-but-retained from T4.5:** `pages/ModelsPage.tsx`, `components/ModelLibraryPanel.tsx`.
  **Superseded-but-retained from T4.6:** `pages/SettingsPage.tsx`, `pages/settings/{shared,InterfaceView,ShortcutsView,IntelligenceView,LocalServicesView,AudioView}.tsx`, `components/SettingsDebugPanel.tsx`, `components/ui/ShortcutRecorder.tsx`.
  **Superseded-but-retained from T4.7:** `pages/ComputerUsePage.tsx` (the prototype vision-loop; kept as the foundation to rebuild from when the feature ships — see D-414).
  (If the user later prefers delete-on-move, switch to `git mv`; until then, retain.)

- **D-404 — One-off feature glyphs use the `<Icon icon={…}>` escape hatch; barrel stays for cross-feature concepts** · P4 (T4.1)
  §17 says Phosphor is imported only in the icon barrel. Cross-feature *concepts* (Refresh, Warning,
  Expand, Collapse, …) are barrel exports. Feature-specific decorative glyphs (`ChartLineUp`,
  `TerminalWindow`, `Robot`) are **not** promoted to the shared barrel (that would bloat it with
  one-offs); instead they use the barrel's sanctioned escape hatch — `<Icon icon={Glyph} size=… />` —
  which still enforces the size scale + `regular` weight. Promote a glyph to a named concept only when a
  2nd feature needs it.

- **D-405 — Dense micro-type sizes (`text-[Npx]`) retained pending a typography-scale decision** · P4 (T4.1) → typography pass / T6.4
  The named scale formalised `2xs`(10)/`3xs`(9) in Phase 1 but did not add 8/11/15px. The Activity
  dashboard is a legitimately dense data surface (audit §25.4 "intentional density"). Bulk-rounding its
  `text-[8/11/15px]` to the coarse scale would visibly change density and risk a *visual regression* —
  which this restyle forbids. Decision: **retain the exact px sizes** for now (lint warns, doesn't
  block), and settle a micro-type scale (add `11px`? raise an 11px floor?) in a dedicated typography
  pass or the T6.4 consistency sweep, then convert. Applies to every dense feature in Phase 4.

- **C-401 — `SegmentedControl` primitive candidate (raw `<button>` toggles retained)** · P4 (T4.1) → **RESOLVED at T4.2**
  Activity has three segmented controls (mode tabs, day selector, metric selector) built from raw
  tokenised `<button>`s — no existing primitive fits a segmented toggle (`Button` is for actions). Kept
  as-is (lint warns on raw `<button>`). The pattern recurred in `manage` (Auto router Static/Dynamic
  toggle), so per "create on first need" the shared **`components/ui/SegmentedControl`** was created in
  T4.2 (see D-406) and used there. The clickable `ProviderCard` is a raw `<button>` (a card-as-button);
  that is correct, no primitive. **Open follow-up:** activity's three toggles were **not** retrofitted in
  T4.2 — retrofitting an already-committed feature would break the one-feature-per-task work rule. Adopt
  `SegmentedControl` into `features/activity` in a later consistency sweep (T6.4) or whenever activity is
  next touched. (Activity's day/metric pills are a slightly different "toolbar filter" shape, not a
  segmented track — evaluate at retrofit whether they fit the primitive or stay bespoke.)

- **D-406 — `SegmentedControl` primitive + `Back` icon concept (T4.2 additions to the shared layer)** · P4 (T4.2)
  Two shared-layer additions made while migrating `manage`:
  • **`components/ui/SegmentedControl`** — generic `<T extends string>` segmented picker
    (`options`/`value`/`onChange`, `size` sm|md). A11y: track is `role="radiogroup"`, each segment a
    `role="radio"` with `aria-checked` (requires `aria-label` on the group). Strict-neutral (D-401):
    the active segment uses the sanctioned "selected" treatment `bg-surface-selected` + `text-primary`
    on a `bg-surface-base` track — no hue, no shadow-as-state. This is the canonical token mapping for
    selected-in-a-track and supersedes the per-file `bg-white/dark:bg-surface-border` ad-hoc styles.
  • **`Back` concept** (`ArrowLeft`) added to the icon barrel — genuine cross-feature nav glyph (every
    sub-view "back" affordance), so promoted to a named concept rather than the escape hatch (D-404).

- **D-407 — `services/storage/memorySystem.ts` stays a shared service; only the memories UI moves** · P4 (T4.3)
  The plan's `memories/` grouping note optimistically listed `memorySystem` alongside the page. In
  reality `memorySystem` is consumed by **chat** (`ChatProvider`, `buildSendContext`) and **diagnostics**
  (`comprehensiveDiagnostics`), and **not** by the memories UI (`MemoriesPage` fetches via `apiManager`
  endpoints directly). Moving it into `features/memories/` would invert the dependency (chat → memories
  feature) and entangle T4.3 with T4.12. Decision: cross-cutting services stay under `services/`; a
  feature folder owns only what is feature-private. T4.3 migrated just `MemoriesPage` + `MemoriesGraph`
  + the shared `Memory` type. General rule for the rest of Phase 4: **a service moves into a feature only
  if that feature is its sole consumer.**

- **D-408 — Apps hero/connect-modal gradients + app brand colours are an intentional carve-out** · P4 (T4.4) · user-confirmed 2026-06-29
  Strict-neutral (D-401) bans hue, and the design memory calls accent colour "a bug to fix on sight."
  Two prominent surfaces in `extensions` are explicit, user-confirmed exceptions: the **`HeroBanner`**
  gradient (purple→blue→cyan) + its rotating brand-coloured prompt card, and the **`AppConnectModal`**
  gradient header (sky→blue→indigo). These are deliberate marketing surfaces (asked + confirmed "don't
  change that, that's intentional") — keep them colourful; do NOT neutralise. Separately, **app brand
  logos/colours** (Gmail red, Slack purple, GitHub mark, the `FEATURED_APPS` `iconColor`/`iconBg`, the
  Browser brand blue) are the standing §17 multi-colour brand-logo carve-out and are also kept. Boundary:
  everything that is *functional UI chrome* (status dots, toggles, cards, banners, server marks, the
  connect-modal lower info section) IS neutralised; only the two gradient surfaces + brand identity stay
  coloured. Guardrail scans should expect `dark:`/hue/hex hits **only** in `HeroBanner`, `AppConnectModal`,
  and `ComposioCards` (FEATURED brand) — anywhere else is a regression.

- **D-409 — `features/models` boundary: only UI surfaces move; shared model infra stays shared** · P4 (T4.5) · user deferred to judgment 2026-06-29
  The plan's target tree (02-PLAN line 71) optimistically grouped `ModelPicker`, `ProviderIcon`,
  `TierSelector`, `ModelsContext`, and `useModels` under `models/`. Those are consumed across many
  features (ProviderIcon is already imported by the migrated `activity`; ModelsContext is provided at
  the `App.tsx` root and read by settings/chat/ChatProvider/IntelligenceView; ModelPicker is used by
  `manage`). Moving them would re-touch already-migrated features and create a hub-and-spoke of
  cross-feature imports pointing at `models` — exactly what D-407 guards against. **Decision (applied
  D-407 over the plan tree):** `features/models/` owns only the model *UI surfaces* — `ModelsPage` +
  `ModelLibraryPanel` (the latter consumed by chat via the feature barrel; chat→models is an acceptable
  downward dep). The data/control layer stays in its shared homes. The plan tree note was corrected to
  match. General principle reaffirmed: **feature folders own feature-private UI; cross-cutting
  data/services/controls stay shared** (see [[D-407]]).

- **C-402 — Composite search field (icon + clear) has no primitive; raw `<input>` retained** · P4 (T4.3, recurred T4.4, T4.5) → **RESOLVED at T4.6**
  The `Input` primitive is a bare field; the memories search needs a leading `Search` glyph + a trailing
  clear button. Built as a tokenised raw `<input>` (full focus-ring token treatment) with an overlaid
  `Search` icon and a raw clear `<button>` (1 retained raw button, `aria-label`'d). No primitive fit a
  composite search box, so per "create on first recurrence" the shared **`components/ui/SearchInput`**
  primitive was created in T4.6 (see D-410) and adopted by the settings search. **Retrofits** of the
  already-migrated memories/extensions/models search fields are **deferred to T6.4** (retrofitting a
  committed feature breaks the one-feature-per-task work rule, same precedent as activity's
  `SegmentedControl` retrofit, C-401). Until then those three keep their tokenized raw-`<input>` search
  fields (which work correctly; this is a consistency refinement, not a bug).

- **D-410 — `SearchInput` primitive created (T4.6 addition to the shared layer)** · P4 (T4.6)
  Third shared-layer addition made while migrating `settings` (after T4.2's `SegmentedControl`/`Back`,
  T4.4's `Toggle` adoption). `components/ui/SearchInput.tsx` wraps the `Input` primitive with a leading
  `Search` icon (from the barrel) and an optional trailing clear `IconButton` that appears when there's
  input — the composite search-box shape that recurred across memories/extensions/models/settings
  (C-402). Fully tokenized, a11y-correct (clear button has `aria-label`, field forwards native
  `id`/`aria-*`), exported from `src/components/index.ts` (top-level barrel — there is no
  `components/ui/index.ts`). Adopted by the settings page search; the three earlier feature search
  fields adopt it during T6.4 consistency sweep, not now.

- **D-411 — `ShortcutRecorder` moved into the feature (sole consumer)** · P4 (T4.6)
  `ShortcutRecorder.tsx` previously lived in `components/ui/`, but its only consumer is
  `ShortcutsView` (a settings-panel component). Per the §2 placement rule ("belongs to exactly one
  feature → that `features/<x>/` folder"), it moved into `features/settings/components/` alongside
  `ShortcutsView`. It is NOT a generic UI primitive — it captures keyboard shortcuts for the settings
  config, which is feature-specific behavior. The pre-move copy in `components/ui/` is retained per
  D-403 (superseded-but-not-deleted).

- **D-412 — `SettingsDebugPanel` kept cohesive (6 panels in one file, not split)** · P4 (T4.6)
  The audit-era `components/SettingsDebugPanel.tsx` is a single floating dev-tools widget with ~6
  sub-sections (session/diagnostics/agent/memory/etc. debug readouts). Migrating it as one file into
  `features/settings/components/` rather than splitting into 6 sub-components: it's one cohesive
  diagnostic surface rendered together (one Modal, one scroll container), no sub-section is reused
  elsewhere, and splitting would add 6 files of churn for no reuse/domain-clarity benefit. Same
  "don't split for splitting's sake" reasoning as the activity `ActivityPage` keeping its readouts
  inline. Fully tokenized + strict-neutral (all status dots neutralized) as one unit.

- **D-413 — Feature-private `SettingsRow` retained (distinct from `ui/SettingsRow`)** · P4 (T4.6)
  The settings views use a feature-private `components/SettingsRow.tsx` (split from the old
  `shared.tsx`) rather than the shared `components/ui/SettingsRow.tsx`. The two have **different
  layouts**: the feature-private one is a mobile-stacked label+control with a bottom border (the
  settings list pattern), while `ui/SettingsRow` is the original horizontal label-left/control-right
  settings-row primitive. Collapsing them would change the settings page's responsive behavior — a
  visual regression, which this restyle-only phase forbids (same "retain to avoid visual regression"
  reasoning as D-405's micro-type sizes). Kept feature-private; revisit whether the shared primitive
  can subsume both layouts during the T6.4 consistency sweep.

- **C-403 — Range sliders stay raw (no `Slider` primitive exists)** · P4 (T4.6)
  The `AudioView` volume/input-gain sliders are native `<input type="range">` elements with tokenized
  track/thumb styling. No `Slider` primitive exists in `components/ui/` (the plan never scheduled one),
  and the pattern has only recurred once outside audio (the activity VAD threshold, T4.1). Per
  "create on first recurrence" / D-405 spirit, the raw range inputs are kept tokenized-but-raw rather
  than prematurely promoting a `Slider` primitive. Evaluate during the T6.4 sweep if the pattern merits
  a shared primitive; until then, raw range inputs are an accepted exception (warned by lint, not
  blocking). Same precedent + reasoning as T4.1's activity VAD threshold.

- **D-414 — Computer Use ships as a neutral "Coming Soon" page (user direction); prototype + services retained as foundation, NOT moved** · P4 (T4.7) · user-directed 2026-07-03
  The original `pages/ComputerUsePage.tsx` was a functional vision→action loop prototype — it called Tauri (`mcp_list_running`), drove `useComputerUse()` (screenshot/LLM/action loop), logged steps with thumbnails, and had Start/Stop/model-override controls. The user confirmed the feature is **not the final version** and directed that the page be **redesigned into a proper "Coming Soon" page** matching the design system, with the current placeholder content removed.
  This is a **user-directed product decision** (the user owns scope; §8's "no behavior change" rule binds the revamp work, not the user). Executed as: a new tokenized, strict-neutral hero (`features/computerUse/ComputerUsePage.tsx`) — layered `Monitor`+`CursorClick` hero mark, eyebrow, title, description, and a 3-item "what to expect" preview (`Vision`/`Control`/`Transparent`) that honestly describes the prototype's actual shape so the surface isn't a dead-end. Zero interactive controls (no raw `<button>`/`<input>`) — a true placeholder. Subtle framer-motion staggered entrance (reduced-motion honoured globally by `MotionConfig`). Icons via the `<Icon icon={…}>` escape hatch (D-404) for one-off feature glyphs.
  The dead `pages/ComingSoon.tsx` (graduated blue→purple→pink, `bg-dark-100`, `duotone`) was **not** reused — it violates the no-accent rule and is already slated for T6.2 dead-code removal. The new Coming Soon surface is **feature-specific** (canonical for `computerUse`), not a shared primitive; if a 2nd feature needs a coming-soon surface, promote a shared `components/ui/ComingSoon` then (create-on-first-recurrence, same precedent as `SegmentedControl`/`SearchInput`).
  **`useComputerUse` (`hooks/`) + `computerUseService` (`services/computerUse/`) are retained in their shared homes, NOT moved into the feature folder.** Their sole consumer was the prototype page; the new Coming Soon page imports neither, so moving them would relocate orphaned code without a consumer — pure churn (D-407/D-409 precedent: don't move what has no live consumer in the feature). They are the **foundation to rebuild on when the feature ships.** When that happens, the *prototype* (not the Coming Soon page) is what migrates into `features/computerUse/` and the throwaway Coming Soon page is deleted. Affected: new `features/computerUse/{ComputerUsePage.tsx,index.ts}`; retained `pages/ComputerUsePage.tsx` (superseded). `HomePage` repointed.

---

## Phase 4 — T4.8 (transcription)

- **D-415 — `transcription` boundary: only transcription-private surface moves; audio/recording pieces stay shared (applies D-407 over the plan's optimistic tree)** · P4 (T4.8) · 2026-07-06
  The plan §2 line for `transcription/` optimized named `useAudioRecorder` + `services/fasterWhisper` beside the page. Reality-checking consumers (grep before moving): **`useAudioRecorder` is consumed by `VoiceInput` (voice) + `RecordingContext` (global)**, `AudioWaveform` by `TranscribePage` + `VoiceInput`, `RecordingContext` by `TranscribePage` + `GlobalShortcutHandler` + `HomePage` provider, and `RecordingState` (enum, `types/`) by 8+ files across features/shell/services. All four are **multi-consumer → stay shared** (D-407, the same precedent that kept `memorySystem` shared in T4.3 and the model data/control layer shared in T4.5). The transcription-*private* surface — `TranscribePage` (sole consumer `HomePage`), `FasterWhisperStatus` (sole consumer `settings/LocalServicesView`), `useFasterWhisper` (sole consumer `FasterWhisperStatus`), and `services/fasterWhisper/*` (sole consumers `useFasterWhisper` + `FasterWhisperStatus`, both themselves moving) — DID move into `features/transcription/`. Note `services/fasterWhisper` is the first actual service-folder move of Phase 4 (T4.3 explicitly kept `memorySystem` shared). The plan-tree note for T4.8 is corrected to match. When T4.9 (voice) migrates `VoiceInput`, it will import `useAudioRecorder`/`AudioWaveform` from their shared homes — no cross-feature dependency churn. Affected: new `features/transcription/{TranscribePage,components/FasterWhisperStatus,hooks/useFasterWhisper,services/fasterWhisper/*,index.ts}`; retained `pages/TranscribePage.tsx`, `components/FasterWhisperStatus.tsx`, `hooks/useFasterWhisper.ts`, `services/fasterWhisper/*` (D-403). `HomePage` + `LocalServicesView` repointed; `useFasterWhisper` re-export dropped from `hooks/index.ts` barrel (it now lives in the feature barrel; no consumer imported it via the global barrel).

- **D-416 — `FasterWhisperStatus` status model is strict-neutral (D-401 precedent extended to install/model state)** · P4 (T4.8)
  Three previously-hued signals neutralized, extending D-401 to local-transcription status: (1) the **"Ready" indicator** (`CheckCircle weight="fill" text-green-600`) → a **strong neutral dot** `bg-primary` (the "healthy/good" pattern from T4.1); "Not Installed" stays as an empty ring `border-2 border-muted`; (2) the **selected-model dot** (`bg-green-600`) → `bg-primary`; (3) the **"already installed" check** in the download list (`CheckCircle text-green-600`) → `Success` glyph at `text-primary` (regular — a confirmation, not active/selected). Destructive model delete (`text-red-600`) → `IconButton variant="destructive"` (neutral graphite emphasis). The **Python-required warning banner** (`bg-yellow-50`/`border-yellow-200`/`text-yellow-800` + dark literals) → `bg-surface-raised border-surface-border` + `Warning` glyph (`text-primary`) + `text-secondary` body — colorless status per §11.3 (warning = icon + weight + neutral surface, never hue). No `state-*` color tokens were introduced.

- **D-417 — Service-folder move requires relative→`@/` import conversion; `modelMetadata`/`index` self-contained** · P4 (T4.8)
  `services/fasterWhisper/*` used relative paths to shared infra (`../logging/logger`, `../../types`, `../errors/errorService`). Copied into `features/transcription/services/fasterWhisper/`, those break (resolve to nonexistent `features/transcription/services/logging/logger` etc.), so the 5 service files that reference shared infra were converted to `@/services/logging/logger`, `@/types`, `@/services/errors/errorService`. Internal-relative imports (`./config`, `./modelManager`) kept — they resolve within the moved folder. `modelMetadata.ts` + `index.ts` needed zero edits (former has no external imports; latter is internal-relative only). Lesson for future service-folder moves: grep external relative imports before copying; convert to `@/`.

- **BUG-001 RESOLVED — `FasterWhisperStatus` hooks ordering is correct** · found P0 · resolved T4.8 (2026-07-06)
  Original BUG-001 (Phase 0) flagged `useEffect` called conditionally at the original line 51. In the current/refactored `features/transcription/components/FasterWhisperStatus.tsx`, all hooks (`useFeatures`, `useFasterWhisper`, 7× `useState`, 1× `useEffect`) run **before** the `if (!isEnabled('fasterWhisper')) return null;` early return, so no hook is called conditionally — the rule is satisfied. ESLint `react-hooks` reports **0 violations** on the file. Either BUG-001 described an earlier file shape or was a misreading; regardless, the migrated version is airtight (an explicit code comment notes "placed AFTER all hooks" so future edits don't regress it).

- **C-404 — Dense micro-type retained on `TranscribePage` (D-405 precedent)** · P4 (T4.8) → T6.4
  TranscribePage surface text uses `text-[10/9/12/14/11/13px]` literals (the dense transcribe UI). Per D-405, retained as-is — bulk-rounding to the scale (`text-2xs/3xs/xs/sm/base`) risks a density/visual regression, which this restyle forbids. ESLint warns (9 `text-[..]` warnings, 0 errors) — warns don't block. A dedicated typography pass / T6.4 sweep converts them after the full feature page set is migrated so the density decision is made once for all dense surfaces consistently. Same reasoning as T4.1 activity.

- **C-406 — Mic record button stays a custom `motion.button` (no circular-button primitive)** · P4 (T4.8)
  The 48px circular microphone record button (`motion.button` + framer `whileTap` + conditional content: spinner / live waveform / mic glyph) has no fitting primitive — `Button`/`IconButton` are rectangular. Kept as `motion.button`, tokenized (`bg-surface-base`/`bg-surface-raised`/`border-surface-border`/`text-secondary` + `Spinner` primitive) and **hover made color-only per D-201** (dropped the `whileHover scale 1.05`, kept `whileTap scale 0.95` as the transient press response — D-201's exact ruling on `Button`). `transition-all duration-300` → `transition-colors duration-normal` (the `hover:shadow-md` snaps; acceptable — elevation is not a competing state channel per §11.1). Same "custom hero control, tokenized not primitivized" precedent as activity's chart/voiceOrb carve-outs.

- **C-407 — `transition-all` on SVG progress rings → `transition-[stroke-dashoffset]`** · P4 (T4.8) (self-found at verification)
  The install + download circular-progress rings animate `stroke-dashoffset` (an SVG attribute), not a color. The inherited `transition-all` (audit F11 smell, 50 uses app-wide) was replaced with explicit `transition-[stroke-dashoffset] duration-normal ease-standard` — animates exactly the property that changes, nothing else. Caught during the T4.8 guardrail scan (the scan's `transition-all` flag); fixed before marking the task done.

---

## Phase 4 — T4.9 (voice)

- **D-418 — VoicePage gradient fully neutralized; state signalling shifted to opacity + animation + neutral dot** · P4 (T4.9) · user decision 2026-07-06 (resolves OOS-101)
  The original `VoicePage` was a deliberate single-surface design: "the gradient IS the visual. No orb. No avatar box. The entire page breathes and shifts colour with session state." Its `LIGHT`/`DARK` keyed hue palettes (periwinkle/violet/blue/sky/sky-pink per `SessionState`, including a literal `#ef4444` error red) violated the no-accent rule and were flagged out of scope at Phase 1 (OOS-101). The user's design call (2026-07-06): **Neutralize fully** — the gradient loses ALL hue, but the page-still-breathes-with-state architecture is preserved.
  **Implementation:** (a) The dual `LIGHT`/`DARK` palette collapsed to ONE `GRADIENT: Record<SessionState, string>` map composed entirely of `var(--surface-page/base/deep/raised/hover/selected/active)` references — auto-switches dark via the token (no `isDark` needed for the gradient itself). Per-state variation comes from which stops are picked + drift duration (`DRIFT_DUR` preserved verbatim — idle 14s ⇢ speaking 0.55s carries the activity signal the same way it always did). (b) The `DOT_COLORS` hue map (indigo `#818cf8` / sky `#38bdf8` / blue `#3b82f6` / violet `#8b5cf6` / indigo `#6366f1` / red `#ef4444`) → a single `bg-primary` neutral dot whose **pulse cadence** (`DOT_PULSE_DUR`, derived from the original per-state speed targets — speaking 0.65s, processing 0.45s, listening 1.1s, connecting 3s) carries the activity level. The `error` state replaces the dot with a `Warning` glyph at `text-primary` — colorless status per §11.3 (warning = icon + weight + neutral surface, never hue). (c) The radial presence bloom + dot-grid texture + floor glow + AI-text-mask-gradient keep neutral `rgba(0,0,0,*)` (light) / `rgba(255,255,255,*)` (dark) strings — CSS vars can't reach a composited gradient string with alpha, so they fall under the D-401 carve-out (same as recharts/THREE/mermaid canvases); all hue removed.
  **Net effect:** the page is still alive with state — but the activity channel is now the breath-cadence + the dot's pulse speed, not "more blue = listening / more violet = speaking" hue. The user's posed trade-off in OOS-101 ("can hue-based state survive, or must it become weight/animation-based?") resolved in the latter direction, exactly as a strictly-premium-neutral system requires. No state information was lost — the speaking → processing → listening cadence deltas read as clearly as the original chromatic shifts. Affected: new `features/voice/VoicePage.tsx`; retained `pages/VoicePage.tsx` (D-403).
  Note on dual `PRESENCE_LIGHT`/`PRESENCE_DARK`: kept (vs collapsed into tokens like the gradient) because alpha-on-graphite needs to read as a *glow*, and the same alpha value reads opposite-direction on white vs graphite backgrounds — so the dual light/dark map captures "evocative luminous bloom" without hue. `isDark` is kept ONLY for this presence alpha selection + the dot-grid + floor-glow opacity tweaks (the gradient itself is fully token-driven and dark-auto-switching).

- **D-419 — `voice` boundary: only VoicePage + liveSessionSounds move; LiveSessionContext/useLiveSession/VoiceInput/useVoiceInput/useTTS all stay shared** · P4 (T4.9) · 2026-07-06
  Applies D-407 (and extends the D-415 transcription precedent) over the plan's optimistic §2 tree line ("voice/ — VoicePage, VoiceOrb, AudioWaveform, LiveSessionContext, useLiveSession/useTTS/useVoiceInput"). Reality-checking consumers before moving (grep):
  • **`VoiceOrb`/`ChibiAvatar` don't exist** — OOS-101 listed them, but grep at T4.9 start found zero matches. The existing `VoicePage.tsx` file header explicitly states "No orb. No avatar box." So the migration scope shrank to `VoicePage` itself + its private `liveSessionSounds`.
  • **`LiveSessionContext`** (consumed by `HomePage` provider + `GlobalShortcutHandler` + `VoicePage`) → multi-consumer → **stays shared** in `contexts/`.
  • **`useLiveSession`** (consumed by `LiveSessionContext` + `FloatingIsland` + `overlayService`) → multi-consumer → **stays shared** in `hooks/`.
  • **`VoiceInput`** (sole consumer `ChatComposer` — chat, not yet migrated) → stays shared in `components/` per D-407 (don't move what has no in-feature consumer).
  • **`useVoiceInput`** (sole consumer `ChatProvider` — chat, not yet migrated) → stays shared in `hooks/`.
  • **`useTTS`** (sole consumer `ChatPage` — chat, not yet migrated) → stays shared in `hooks/`.
  • **`liveSessionSounds`** (sole consumer `VoicePage`) → **moves** into `features/voice/utils/liveSessionSounds.ts` (verbatim copy — the file is pure-logic with zero shared imports, so no D-417-style relative→`@/` conversion needed; `utils/` placement obeys §2 rule 3: pure function, no JSX).
  Per D-415 precedent: when T4.12 (chat/tools) migrates `ChatComposer`/`ChatProvider`/`ChatPage`, those features will *then* import `VoiceInput`/`useVoiceInput`/`useTTS` from their feature homes — no cross-feature churn now. Affected: new `features/voice/{VoicePage,utils/liveSessionSounds,index.ts}`; retained `pages/VoicePage.tsx`, `utils/liveSessionSounds.ts` (D-403). `HomePage` repointed.

- **C-408 — Circular hero controls stay `motion.button` (extends C-406 precedent)** · P4 (T4.9)
  VoicePage has 5 `motion.button` instances — 4 circular hero controls (idle "tap to start" hint, Mic toggle 44px, End call 52px, Speaker toggle 44px) + the Retry CTA. None fit `Button`/`IconButton` (both rectangle; no circular primitive). Kept as `motion.button`, fully tokenized + **hover color-only per D-201** (kept `whileTap={{ scale: 0.95 }}` transient press, dropped the spring-based `whileHover`). This is the second instance of the same precedent set by the transcription mic record button in T4.8 (C-406): "custom hero control, tokenized not primitivized." The Retry CTA was *not* migrated to `Button variant="primary"` because (a) its `motion.button` carries enter/exit fade animation inline with the other controls, (b) splitting Enter motion (`motion` wrapper) from press behavior (`Button`) would create a wrapper-inside-wrapper anti-pattern, (c) the existing precedent (extensions `motion.button` submit CTAs) allowed keeping it. Lint doesn't flag `motion.button` (the guardrail targets raw `<button>` only); consistent with how the Button/IconButton primitives internally render `<button>` themselves. Per-channel theming: muted (`isMicMuted`/`isSpeakerMuted`) = `bg-surface-selected border-surface-border text-primary` (stronger "selected-like" carry per §11.1) — flips the convention of "muted = inactive/quiet" because mute here is *the active intent the user has set*, so it gets the stronger channel. Unmuted = ghost (`bg-surface-base text-secondary hover:bg-surface-hover`). End call (destructive, ends the session) = `bg-primary text-on-emphasis hover:bg-secondary` (= `IconButton variant="destructive"` treatment, the sanctioned inverted-emphasis pattern) — never red per D-401.

- **C-409 — Decorative rgba() strings kept in gradient composites (D-401 carve-out extends to gradients)** · P4 (T4.9)
  26 `rgba()` uses remain in `features/voice/VoicePage.tsx` after the neutralization pass — all keyed to pure neutral grayscale (`rgba(0,0,0,X)` light / `rgba(255,255,255,X)` dark), zero hue. These appear in the radial-presence bloom (PRESENCE_LIGHT/DARK maps, 12 entries) + the dot-grid texture (`rgba(0,0,0,0.65)` 1px dot, kept verbatim from the original login-page decorative grid) + the floor-glow (`rgba(255,255,255,0.06)` dark / `rgba(255,255,255,0.50)` light — same as source, decorative) + the AI-text mask-image gradient (CSS `maskImage: linear-gradient(...)`, opaque `black`/`transparent` — semantically "all-or-nothing masking", not color). Same D-401 carve-out rationale as recharts/THREE/mermaid canvases: **CSS variables cannot be substituted into a composited gradient/rgba string** — `linear-gradient(135deg, var(--token) 0%, ...)` works, but `rgba(var(--token-rgb), 0.42)` requires a separate RGB-channels token form that doesn't exist in the §12 system, and `radial-gradient(circle, var(--surface-page) 1px, transparent 1px)` would break the alpha layering. The decorative-only, hue-free nature was confirmed during the verification scan. If a future token-set adds RGB-channel vars (e.g. `--surface-base-rgb: 247,247,247`), these can be retokenized; until then, the literal neutral rgba strings stay and are an accepted exception (warned by lint's hex/rgba rule if it were enforced, currently warn-only per T0.4; Phase 6 will keep them disable-commented). The login/source page (`ShaderWelcomePage.tsx`, not yet migrated) uses the same pattern and inherits the same carve-out when reached.

- **C-410 — Cross-feature voice glyphs (Microphone/SpeakerHigh) NOT promoted to the icon barrel in T4.9; defer to T6.4** · P4 (T4.9)
  D-404 rule: "promote a glyph to a named concept only when a 2nd feature needs it." `Microphone` is consumed across **5 unrelated files** (settings/SettingsPage, settings/ShortcutsView via SpeakerHigh which is consumed in ShortcutsView + MessageActions + FloatingIsland, features/transcription/TranscribePage, components/overlay/IslandAtoms + FloatingIsland, components/VoiceInput, features/settings/components/AudioView; plus VoicePage now) and `SpeakerHigh` in 3+ files (settings, chat/MessageActions, overlays, voice). Per D-404 the bar to promote was already met by T4.8 — but every prior Phase-4 feature used the `<Icon icon={…}>` escape hatch uniformly rather than promoting, and the conservative reading "skip promotion during a focused feature pass; sweep it at a dedicated consistency point" has held consistently. T4.9 follows the same precedent: imports `Microphone`/`MicrophoneSlash`/`SpeakerHigh`/`SpeakerSlash`/`PhoneX` from `@phosphor-icons/react` directly and wraps in `<Icon icon={Glyph} />` (escape hatch); the cross-feature ones (`Microphone`, `SpeakerHigh`) are flagged for **T6.4 final consistency sweep** promotion to barrel concepts (`Mic`, `SpeakerHigh` — note `Mic` not `Microphone`, the audit's broader-established convention). Voice-private one-offs (`MicrophoneSlash`, `SpeakerSlash`, `PhoneX`) stay as escape-hatch usages indefinitely. No regression here — just a deliberate deferral.

- **C-411 — `04-PHASE-SUMMARIES.md` had no Phase-4 sub-phase entries before T4.9; T4.8 + T4.9 backfilled** · process (T4.9)
  The workflow (`00-INTENT.md` §4 step 9) requires a `04-PHASE-SUMMARIES.md` entry after each completed phase. The 04 doc ended at the "Pre-Phase-4 checkpoint" entry — no T4.1–T4.8 retrospective entries existed when T4.9's verification passed. Process-trace: the early sub-phases presumably followed a "summarize Phase 4 all at once at phase exit" reading of §4 (the 04 doc's phase-level granularity — Phase 0/1/2/3 each got one entry, not per-task — supported that interpretation). For T4.8 + T4.9 (two complete sub-phases with substantial decisions + caveats now logged in `03`), dedicated entries are justified — and they were both backfilled during the T4.9 documentation pass to comply with §4 step 9 (verified code, not just docs, against the changes claimed). **Going forward, the remaining sub-phases (T4.10–T4.12) and Phase 5–6 each get their own 04 entry.** If a future engineer finds the early Phase-4 T4.1–T4.7 sub-phases without 04 entries, those are intentional oissions, not missed work — refer to `02-PLAN.md` §9 dashboard for the live status (boxes + Done-notes there are themselves the per-task attestation).

---

## Phase 5 — Shared-layer consolidation (started 2026-07-06)

- **D-501 — Constants structure: folder with categorized files + barrel (NOT a single file)** · P5 (T5.1) · user decision 2026-07-06
  The §2 plan target reads `constants/ # ALL app-wide static values (single home)` — ambiguous between "one file" and "one folder." User chose **folder with categorized files + barrel**, rejecting the single-file alternative. Reasoning: `config/constants.ts` was already 222 lines / 14 const groups (`TOKEN_LIMITS`, `CACHE_CONFIG`, `FILE_LIMITS`, `UI_CONFIG`, `NETWORK_CONFIG`, `MEMORY_CONFIG`, `SECURITY_CONFIG`, `MODEL_CONFIG`, `STORAGE_KEYS`, `API_PATHS`, `FEATURES`, `ERROR_MESSAGES`, `SUCCESS_MESSAGES`, `VALIDATION`) — a single file grows into a navigation chore; categorical split aids grep-by-domain and future scaling.
  **Concrete file split landed in T5.1** (sized to actual content, not over-engineered):
  • `constants/app.ts` — TOKEN_LIMITS, CACHE_CONFIG, MEMORY_CONFIG, VALIDATION, FEATURES (app-wide tuning)
  • `constants/network.ts` — NETWORK_CONFIG, API_PATHS, STORAGE_KEYS, SECURITY_CONFIG (request/auth/storage)
  • `constants/ui.ts` — UI_CONFIG, FILE_LIMITS, ERROR_MESSAGES, SUCCESS_MESSAGES (UI/UX chrome)
  • `constants/models.ts` — MODEL_CONFIG (domain — kept separate as likely-to-grow if model handling expands)
  • `constants/splashTiming.ts` — already existed in its final home (untouched); re-exported by the new barrel
  • `constants/index.ts` — barrel re-exporting all named groups + retaining the historical `CONSTANTS` aggregate + the default export, for back-compat with existing consumers.
  **Plan-note corrections (the original T5.1 plan entry was partially stale):** (a) `utils/constants.ts` NEVER EXISTED — grep at T5.1 start returned 0 matches for it; the plan's "merge `utils/constants.ts`" was a stale assumption (likely from an earlier doc-state or hypothetical). (b) `constants/splashTiming.ts` was already in its final home — just needed to be re-exported by the new barrel. So real scope shrank to: split one 222-line file → 5 categorized files + barrel, repoint 2 external consumers. **Placement rule reaffirmed for the future:** new app-wide constants go into ONE of the 5 categorized files (app/network/ui/models/splashTiming); feature-only constants stay co-located in `features/<x>/constants.ts` per §2 rule 4 — do NOT add them to the global `constants/` (would invert the dependency). `src/config/{autoMode,tauriConfig}.ts` stayed in `config/` per the plan §2 split (runtime/env config, not statics).

- **D-502 — T5.1 started early despite the §7 Phase-5-needs-Phase-4 dependency rule** · process exception (T5.1) · user direction 2026-07-06
  §7 (dependency overview) says "Phase 5 (consolidate shared layers: needs features to have pulled out their code)" — i.e., Phase 4 must finish before Phase 5. The user explicitly **excepted T5.1** from this rule and authorized starting it while T4.10/T4.11/T4.12 remain pending. Justification (verified, not asserted): T5.1 touches **zero feature code** — `config/constants.ts` is consumed only by `utils/tokenManager.ts` + `services/ai/modelService.ts` (both shared infrastructure, not feature surfaces). The constants themselves are app-wide static values, not feature-scoped (feature constants live in `features/<x>/constants.ts` per §2 rule 4 and were never part of this consolidation). So running T5.1 early creates no cross-feature churn and no half-settled shared layer — the dependency rule's *intent* (don't settle shared layers while features are still pulling code through them) is preserved at the substance level even though the sequencing rule is bent at the letter level. **Scope of the exception: T5.1 ONLY.** T5.2 (hooks), T5.3 (contexts), T5.4 (services), T5.5 (types/barrels), and T5.6 (`utils/` purge — `toolCardUtils.tsx` moves with chat/tools T4.12) all genuinely need their corresponding Phase-4 tasks done first; running them early would settling shared layers while the feature code that should have pulled out its pieces is still in flux. They stay blocked until Phase 4 finishes.   The user's reason for the exception: voice-mode design is under review (T4.9 was already completed neutral; future voice-redesign will rebuild on top of it), so the user prefers to make progress on the safely-decoupled Phase-5 task while the remaining Phase-4 sequence is being decided.

- **D-420 — T4.10 markdown+artifacts boundary: 3 generic primitives stay shared** · feature-boundary decision (applies D-407 over the §2 plan tree) · 2026-07-06
  The §2 plan tree grouped `VideoPlayer` + `ExternalLink` under `markdown/` and `TaskWriteCard` (file: `TodoWriteCard.tsx`) under `artifacts/`. Reality-checking consumers (grep before moving — applying D-419/D-415 precedent):
  - **`VideoPlayer`** — consumed by CodeBlock (moving) only. Sole-consumer would normally indicate "move it." BUT: it's a generic media primitive (video element + controls), not markdown-feature-shaped. Moving a generic primitive INTO a feature folder inverts the dependency direction — primitives belong in the shared `components/ui/` layer so any future feature can reuse them. **STAYS in `components/ui/`**; CodeBlock imports via `@/components/ui/VideoPlayer`.
  - **`ExternalLink`** — consumed by MarkdownComponents (moving) only. Same reasoning: it's a generic inline primitive (anchor-with-icon), belongs to the shared primitive layer, not the markdown feature. **STAYS in `components/ui/`**; MarkdownComponents imports via `@/components/ui/ExternalLink`.
  - **`TodoWriteCard`** — consumed by SummaryPanel (moving) only. Same reasoning: it's a self-contained card component with its own semantic identity (toolbar-with-tasks UI), not artifacts-shaped. **STAYS in `components/ui/`**; SummaryPanel imports via `@/components/ui/TodoWriteCard`.
  - **`useArtifactPanel` + `useSummaryPanel`** — multi-consumer (`ChatPage` + `RightWorkspacePanel` for the former; `ChatPage` for the latter). Per D-407, STAY in `hooks/`. ChatPage/RightWorkspacePanel import directly via `@/hooks/*`.
  - **`StreamingText`** — multi-consumer (MarkdownComponents [moving] + chat AssistantMessage). Per D-407, STAYS in `components/ui/`. MarkdownComponents already internal-refs it via `./StreamingText` (wait — Actually it doesn't; StreamingText is consumed by AssistantMessage, NOT by MarkdownComponents — re-verified at grep time. MarkdownComponents exports `ImageLightbox` which AssistantMessage's sibling ScreenshotThumbnail consumes. StreamingText has no markdown-side dependency and STAYS shared without further churn.)
  Net boundary: only the markdown-rendering stack (`CodeBlock` + `MarkdownComponents` + `MermaidDiagram` + `renderers/*`) and the artifact-panel surface (`ArtifactPanel` + `SummaryPanel` + `DocumentStorageModal` + `artifact/*` + `content/*` + `components/ArtifactLabPanel`) moved. Generic primitives + cross-feature hooks stayed put. Precedent reaffirmed: a "sole consumer" finding is necessary-but-not-sufficient for moving — the code must ALSO be feature-shaped. Generic primitives belong in `components/ui/` regardless of how few consumers they currently have. This is the same judgment call that kept `useAudioRecorder`/`AudioWaveform` shared in T4.8 (D-415) and `VoiceInput`/`useVoiceInput` shared in T4.9 (D-419).

- **C-412 — T4.10 deferred ~30 pre-existing D-401 accent-color violations to T6.4** · consistency-sweep deferral · 2026-07-06
  The verbatim-move approach ("make it simple — no redesign" per user direction) carried over ~30 instances of accent-color utilities across 10 files in the newly-moved `features/markdown/` + `features/artifacts/`. These are pre-existing D-401 violations (the guardrail scan flags them all). Catalog of the debt:
  - **`ArtifactRenderer.tsx`** — 4-cell status-pill palette keyed by status type: `text-emerald-500`/`bg-emerald-50`/`text-emerald-700`/`bg-emerald-950/20` (success), `text-amber-500`/`bg-amber-50`/`text-amber-700`/`bg-amber-950/20` (warning), `text-rose-500`/`bg-rose-50`/`text-rose-700`/`bg-rose-950/20` (error), `text-sky-500`/`bg-sky-50`/`text-sky-700`/`bg-sky-950/20` (pending). Two accent-colored links: `text-blue-600 dark:text-blue-400` on artifact <a> + item-label divs.
  - **`JsonRenderer.tsx`** — JSON-syntax coloring: keys `text-blue-500`, strings `text-amber-600`, numbers `text-green-600`, booleans/null `text-rose-500`. (This is a "code editor" semantic convention — neutralizing it well means designing a monochrome JSON syntax palette, which is a deliberate design decision, not a find/replace.)
  - **`CodeBlock.tsx` + `CodeView.tsx` + `DocumentView.tsx`** — "Copied"/"Opened" success state: `text-green-500` check icon + span (3 instances in CodeBlock: copy-code, open-in-editor, copy-output). Pre-existing. Per §11.3, success = neutral check icon + weight, no green.
  - **`LatexRenderer.tsx` + `MermaidDiagram.tsx`** — formula/render error banner: `text-amber-500 dark:text-amber-400`. Per §11.3, error = Warning glyph + neutral surface, no amber.
  - **`ArtifactLabPanel.tsx`** — empty-state warning: `border-amber-200`/`bg-amber-50`/`text-amber-700` + dark variants. Same treatment.
  - **`SearchResultContent.tsx`** — result info box: `bg-blue-50 dark:bg-blue-950/20`/`border-blue-100`/`text-blue-700 dark:text-blue-300`; result link: `text-blue-600 dark:text-blue-400 hover:underline`.
  - **`DocumentStorageModal.tsx`** — option icons: permanent-storage icon `bg-blue-50 dark:bg-blue-950/30`/`text-blue-500`; temporary-storage icon `bg-amber-50 dark:bg-amber-950/30`/`text-amber-500`.
  - **`WebSearchArtifact.tsx`** — link blue: `text-blue-600 dark:text-blue-400` + `group-hover:text-blue-400`/`text-blue-600`.

  **Why deferred, not fixed in-place:** user direction was explicit ("make it simple — no redesign"), and these are *coherent semantic systems* (the 4-status pill palette in ArtifactRenderer + the 4-color JSON syntax palette in JsonRenderer) — neutralizing them piecemeal during a move would have produced a worse intermediate state (half-neutralized, inconsistent with its own internal logic). T6.4 (final consistency sweep) is the right place to redesign these as a coordinated neutral system per §11.3. The debt is fully cataloged above so T6.4 has the file list + the design question (JSON syntax palette without color — likely weight + monochrome variants) ready.

  Scope flag: this is the **largest D-401 debt currently tracked in any migrated feature** (~30 instances, larger than T4.4 extensions' D-408 brand-color carve-out). T6.4 should plan a dedicated sub-pass for the markdown/artifacts status-color neutralization as a coherent design exercise, not a find/replace.

- **C-413 — T4.10 pre-existing ESLint warnings carried over (D-405 + `<button>`) · 200 total across 22 files** · lint-debt deferral · 2026-07-06
  ESLint on all moved files + repointed consumers returned **0 errors / 200 warnings**. Breakdown: ~half are D-405 `text-[10px]`/`text-[11px]`/`text-[12px]` dense micro-type warnings (deferred to the T6.4 typography consistency sweep per the locked D-405 decision); ~half are raw `<button>` elements in ArtifactPanel (tab buttons, close button — 2 instances), DocumentStorageModal (3 CTA buttons), CodeView/DocumentView (copy buttons — 2 instances each), SummaryPanel (collapsible-section buttons — 2 instances), ArtifactLabPanel (action buttons). All pre-existing — none introduced by the verbatim move (the import-path edits touched no JSX). `text-[..]` → `2xs/3xs/xs` tokenization + `<button>` → `<Button>`/`<IconButton>` primitive adoption is T6.4 work.   The 200 warnings are tracked here so they're not "lost" between now and T6.4.

- **D-421 — T4.11 workspace boundary: 3 multi-consumer pieces stay shared, RightWorkspacePanel is the VoiceInput-precedent exception** · feature-boundary decision (applies D-407 + D-419/D-420 precedent over the §2 plan tree) · 2026-07-06
  The §2 plan target tree grouped ALL workspace surface into `features/workspace/`: `WorkspacePage`, `rightWorkspace/*`, `terminal/ (TerminalPanel)`, `browser/ (BrowserPanel, NativeBrowserHost)`, `hooks`, `services/browser`. Reality-checking consumers (grep before moving — applying D-419/D-420 precedent):

  - **`ResizeHandle`** — multi-consumer: `features/artifacts/ArtifactPanel.tsx` (already-migrated feature, imports via `@/components/rightWorkspace/ResizeHandle`) + rightWorkspace internals (WorkspaceHomePanel, WorkspacePlaceholderPanel, SideChatPanel, RightWorkspacePanel, BrowserPanel, TerminalPanel) + the superseded-D-403-retained `components/ui/ArtifactPanel.tsx`. Per D-407 strictly applied: multi-consumer ⇒ STAYS SHARED. Stays in `components/rightWorkspace/` as a 1-file folder (T5.4 will collapse it; in the meantime all moved workspace internals import it cross-folder via `@/components/rightWorkspace/ResizeHandle`). ResizeHandle is generic-primitive-shaped (drag-resize separator — 18 LOC, no business logic), so its proper final home is `components/ui/`, but that's a T6.4 organization call (don't prone-among-feature-boundary-decisions during a feature move — keep the diff focused).
  - **`useTerminalPanel`** + **`useBrowserPanel`** — sole consumer is `pages/ChatPage.tsx` (chat, NOT YET migrated). Per D-419 VoiceInput precedent: "don't move what has no in-feature consumer" — moving a hook into `features/workspace/hooks/` when its sole consumer is an UNMIGRATED chat surface would force ChatPage to immediately repoint to `@/features/workspace/hooks/*` (cross-feature-import-forward-looking churn now) AND would set up a second repoint when chat migrates (chat would either keep the cross-feature import OR pull the hook back into features/chat — neither is clean). STAY in `hooks/` until T4.12 lands; at T4.12 (chat-tools migration), ChatPage moves to `features/chat/ChatPage.tsx`, at which point the hook's location decision can be made cleanly (likely stays shared-in-`hooks/` permanently since it straddles chat + workspace).
  - **`NativeBrowserHost`** + **`nativeBrowserService`** + **`TerminalPanel`** + **`BrowserPanel`** — sole consumers are workspace-internal (RightWorkspacePanel itself + each other). MOVED.
  - **`RightWorkspacePanel`** + **`RightWorkspaceControls`** + **`useRightWorkspace`** + `RightWorkspaceView` type — sole consumer is `pages/ChatPage.tsx` (chat, NOT YET migrated). **EXCEPTION to the D-419 VoiceInput precedent:** these DID move into `features/workspace/rightWorkspace/` (with the rest of the rightWorkspace cluster), and ChatPage's import was repointed from `../components/rightWorkspace` → `@/features/workspace`. Rationale for the exception: RightWorkspacePanel is workspace-feature-shaped (it IS the workspace right-panel shell — switches between terminal/browser/artifact/home/side-chat views), unlike VoiceInput which is voice-shaped (its home is features/voice/ but its sole consumer is chat). And critically, the THREE workspace-internal files that consume the rightWorkspace cluster (WorkspaceHomePanel, WorkspacePlaceholderPanel, SideChatPanel) all need to live next to RightWorkspacePanel as a cohesive rightWorkspace sub-cluster. Keeping RightWorkspacePanel shared-in-`components/rightWorkspace/` while moving its sub-panels to `features/workspace/rightWorkspace/` would scatter the cluster — bad organization. So RightWorkspacePanel moves WITH its cluster, and ChatPage uses a forward-looking `@/features/workspace` import that needs NO churn at T4.12 (when chat migrates, ChatPage already-imports-via-`@/features/workspace`, no re-repoint). This is the same "forward-looking cross-feature import is OK when (a) the file is feature-shaped AND (b) its cluster is moving-cannot-be-separated" reasoning that DIDN'T apply to VoiceInput (VoiceInput's cluster ChatComposer is NOT migrating in T4.9, so moving VoiceInput would have just churned ChatComposer's import without solving any clustering problem).

  Net boundary moved (17 files): WorkspacePage + 12 rightWorkspace/* files (RightWorkspaceControls + RightWorkspacePanel + 4 panels + useRightWorkspace + types + barrel + ProjectLauncher + 3 projectApps/* files) + 1 terminal/TerminalPanel + 3 browser/* (BrowserPanel + NativeBrowserHost + nativeBrowserService). Net boundary stayed shared (3 files): ResizeHandle + useTerminalPanel + useBrowserPanel.

- **C-414 — T4.11 deviation from D-403 "retain originals" convention (used MOVE, not COPY)** · process deviation · 2026-07-06
  Phase-4 sub-phases T4.8 (transcription) / T4.9 (voice) / T4.10 (markdown+artifacts) all used the "COPY-then-keep-superseded-original" pattern per D-403: the original file stays put as a dead-code-but-compiling reference for safety, removed in Phase 6 after adoption is confirmed. **T4.11 deviated:** used `Move-Item` instead of `Copy-Item` (i.e., the originals are GONE from their old locations). Justification: the workspace files form an interconnected cluster (the 12 `rightWorkspace/*` files import the 3 `browser/*` files + the 1 `terminal/*` file + the 1 `services/browser/*` file, and these import each other via old relative paths like `../ui/BrowserPanel`, `../../services/browser/nativeBrowserService`, `./projectApps`). Retaining originals-in-place would have created 17 dead-code files with broken-relative-imports (because `components/ui/TerminalPanel.tsx` (original-superseded) imports `../rightWorkspace/ResizeHandle` — but `./rightWorkspace/WorkspaceHomePanel.tsx` (original-superseded) imports `./ResizeHandle` which would still be there... actually wait, the originals' imports would resolve IF the entire rightWorkspace folder + components/ui/{Terminal,Browser,Native}.tsx + services/browser/* were ALL retained together as superseded). So strictly D-403 was achievable: copy all 17 (no — 18 if ResizeHandle counted, but ResizeHandle stayed so 17), keep them all in place as dead-but-compiling. The trade-off: 17 duplicate files sitting as dead code until Phase 6 deletion — purely a safety-net signal. The move is FULLY verifiable NOW (tsc clean + ESLint 0 errors + both builds green); git revert is the safety net; the dead-code copies would have been pure clutter (T5.4 audit would have to flag them as "remove me" rather than T6.2 doing a clean pass). User direction "make it simple" + the R5 "no logic edits" mitigation both favor the cleaner MOVE approach. **Risk:** loses the explicit "superseded, do-not-touch" signal that D-403's pattern gives to a future engineer joining mid-migration (they'd see the originals and know not to edit). Mitigation: this `02-PLAN` Entry + this 03 entry + the new `features/workspace/` location being the obvious canonical home (grep for any reference to old paths returns 0 matches after repoint). Going forward, T4.12 (chat+tools) will revisit this convention: probably COPY-retain for the leaf chat components (which have NO in-cluster deps), MOVE for ChatProvider-cluster (the 15-file chat-cluster where original-retain creates broken-imports). Decide at T4.12 start.

- **C-415 — T4.11 deferred ~16 pre-existing D-401 accent-color violations to T6.4** · consistency-sweep deferral · 2026-07-06
  Same pattern as C-412 (T4.10 markdown+artifacts deferral) but for the workspace move. ~16 instances across 2 files:
  - **`features/workspace/WorkspacePage.tsx`** (15) — status indicators: `text-green-500` CheckCircle (completed run), `text-red-400` XCircle (failed run), `text-blue-400` SpinnerGap (running); per-row delete buttons `hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30 dark:hover:text-red-400` (×3); error banners `text-red-500`/`text-red-400`/`border-red-100 bg-red-50 text-red-600 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400` (×2 — run error + disabled-feature banner); "truncated" amber chip `text-amber-500`; "approval"/"Disabled" amber labels (×2); info-icon button `hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-950/30 dark:hover:text-blue-400`.
  - **`features/workspace/terminal/TerminalPanel.tsx`** (1) — `bg-green-400 dark:bg-green-500` status dot in the terminal-header connected-indicator.
  All carried over VERBATIM (the R5 mitigation forbids behavior-touching edits; these are visual-state-meaningful colors, not pure cosmetic). Per §11.3 these need icon + weight + neutral surface redesign (a coordinated pass — e.g. "running" should be a neutral SpinnerGap, not `text-blue-400`; "failed" should be WarningCircle + neutral destructive, not `text-red-500`; delete-button hovers should be `IconButton variant="destructive"` icon-only, not raw `<button>` with red hover-state). Deferred to T6.4 consistency sweep per "make it simple — no redesign" + C-412 precedent. Cataloged for T6.4 so it knows the scope (workspace status-color neutralization + delete-button IconButton adoption as a coordinated sub-pass).

---

## Phase 4 — T4.12 (chat + tools; 2026-07-06 — Phase 4 COMPLETE)

- **D-422 — T4.12 chat+tools boundary: 9 classes of files STAYED SHARED per D-407 + D-419/D-420/D-421 precedent** · feature-boundary decision · 2026-07-06
  The §2 plan grouped ALL chat surface into `features/chat/`. Reality-check (applying the D-419/D-420/D-421 "necessary-but-not-sufficient" precedent — sole consumer is necessary, not sufficient; code must ALSO be feature-shaped):
  - **`contexts/ChatContext.tsx`** — STAYS as backward-compat shim. 13 `useChat` consumers (HomePage + TranscribePage + TemporaryPage + 4 features/{extensions,permissions,transcription,workspace}/pages + CommandPalette + PermissionLayerHost + GlobalContextEvents + features/artifacts/SummaryPanel + D-403-retained components/ui/{SummaryPanel,TodoWriteCard,InlineToolSteps}) keep importing `contexts/ChatContext` UNCHANGED. The shim's body is now 3 re-exports from `@/features/chat/context`. ZERO churn on the 13 consumers — the shim absorbs the churn. This is the canonical "backward-compat shim" pattern; the shim can be retired in Phase 6 once the 13 consumers migrate over to `@/features/chat/context` directly (which is a separate, low-risk, no-behavior-touching task).
  - **`hooks/useAgentChat.ts`** — multi-consumer (services/conversations/wsPool). STAYS.
  - **`hooks/useExclusivePanel.ts`** — multi-consumer (NotificationBell). STAYS.
  - **`hooks/useConversationsList.ts`** — multi-consumer (ChatPage active-consumer + CommandPalette type-only). STAYS.
  - **`components/ui/HarnessPermissionModal.tsx`** — sole consumer `App.tsx` (composition root, not chat — same shared-overlay reasoning as GlobalAccessModal). STAYS.
  - **`components/ui/{StreamingText,TodoWriteCard}.tsx`** — STAY shared per D-420 (multi-consumer: features/artifacts/SummaryPanel + chat/AssistantMessage).
  - **`hooks/{useTTS,useVoiceInput,useBrowserPanel,useTerminalPanel,useArtifactPanel,useSummaryPanel}.ts`** — STAY shared per D-419 (sole consumer is moving ChatPage, BUT these are generic-shaped: TTS synthesis, voice-input plumbing, terminal-panel state, browser-panel state, artifact-panel state, summary-panel state — none are chat-shaped). Same "don't scatter a hook into the wrong feature" reasoning as T4.11's useTerminalPanel/useBrowserPanel stay-shared decision. These will likely stay shared-in-`hooks/` PERMANENTLY since they straddle chat + their own feature domain.
  - **`components/InlinePermissionRequest.tsx`** — STAYS shared in `components/` root.
  - **`utils/toolCardUtils.tsx`** + **`utils/mcpRegistry.tsx`** — STAY in utils/ (T5.6 purge / T6.6 territory per the §2 plan; explicitly tagged as "depends on T4.12 chat move" → now unblocked).

  Net boundary moved (54 files): ChatPage + 25 components (24 chat-only + ContextAutocomplete from `components/` root) + 13 context files + 12 chat-only hooks + 3 tool-call cards. Net boundary stayed shared (9+ classes of files / 12+ named files): the ChatContext shim + 4 multi-consumer hooks + HarnessPermissionModal + StreamingText + TodoWriteCard + 6 generic-shaped hooks shared-across-features + InlinePermissionRequest + utils/toolCardUtils + utils/mcpRegistry.

  Precedent reaffirmed: the "sole consumer" finding is NECESSARY-but-NOT-SUFFICIENT for moving. Code must also be feature-shaped. Generic-shaped hooks (TTS, voice-input plumbing, panel-state hooks) belong in the shared `hooks/` layer regardless of how few consumers they currently have. This is the same judgment call that kept `useAudioRecorder`/`AudioWaveform` shared in T4.8 (D-415), `VoiceInput`/`useVoiceInput` shared in T4.9 (D-419), `VideoPlayer`/`ExternalLink`/`TodoWriteCard` shared in T4.10 (D-420), and `ResizeHandle`/`useTerminalPanel`/`useBrowserPanel` shared in T4.11 (D-421).

- **C-416 — T4.12 deferred ~20 pre-existing D-401 accent-color violations to T6.4** · consistency-sweep deferral · 2026-07-06
  Same pattern as C-412 (T4.10 markdown+artifacts) + C-415 (T4.11 workspace) but for the chat-tools move. ~20 instances across 7 files:
  - **`features/chat/components/ClaudeUsageBadge.tsx`** (1) — usage badge styling with accent-color state.
  - **`features/chat/components/ContextAutocomplete.tsx`** (3) — autocomplete suggestion highlighting.
  - **`features/chat/components/ContextWindowButton.tsx`** (2) — context-window status indicator.
  - **`features/chat/components/ConversationsDropdown.tsx`** (1) — conversation-list active state.
  - **`features/chat/components/MessageActions.tsx`** (1) — action-button hover accent.
  - **`features/chat/tools/HarnessStepCard.tsx`** (8) — the COMPLETE tool-step-status pill palette (success/error/warning/running pill states, 4×2 cell palette). This is the most consequential single file in the chat accent-debt catalog — T6.4 should treat it as ONE design exercise (redesign the pill palette as icon + weight + neutral surface per §11.3), not 8 separate find/replace edits.
  - **`features/chat/tools/InlineToolSteps.tsx`** (4) — inline tool-step accent colors.

  Per §11.3 these need icon + weight + neutral surface redesign as a coordinated pass. Deferred to T6.4 consistency sweep per "make it simple — no redesign" + C-412/C-415 precedent. HarnessStepCard ×8 in particular needs a coherent pill-state-system redesign — that's a design pass, not a find/replace task.

- **C-417 — T4.12 pre-existing ESLint warnings carried over (D-405 + `<button>`) · 234 total across moved files + consumers** · lint-debt deferral · 2026-07-06
  ESLint on all 54 moved files + ChatContext shim + hooks barrel + 5 external consumers returned **0 errors / 234 warnings**. Breakdown: density convention in chat (`text-[10px]`/`text-[11px]`/`text-[12px]` per the dense chat UI — D-405 explicitly defers these to the T6.4 typography consistency sweep), raw `<button>` elements in chat components (ChatComposer send button, MessageActions action buttons, ConversationsDropdown items, etc. — `<button>` → `<Button>`/`<IconButton>` primitive adoption is T6.4). All pre-existing — none introduced by the verbatim move (the import-path edits touched no JSX). Tracked here so the warnings aren't "lost" between now and T6.4.</think>T4.12 fully documented in both files. Phase 4 is COMPLETE (12/12 tasks done). Verification all green:
- tsc clean
- ESLint 0 errors / 234 warnings (all pre-existing D-405)
- Desktop build ✓ 55.59s
- Web build ✓ 55.00s
- Guardrail: 20 accent violations cataloged (deferred to T6.4 per C-416)

**Phase 5 is now unblocked** (T5.2 hooks, T5.3 contexts, T5.4 services, T5.5 types/barrels, T5.6 utils purge). T5.6 was explicitly waiting on T4.12 — now unblocked.

Per your direction "follow exact order no more partial, no more skip," next is **Phase 5: T5.2 (hooks consolidation)**. Want me to proceed?

- `text-[..]` → `2xs/3xs/xs` tokenization is T6.4; `<button>` → `<Button>`/`<IconButton>` primitive adoption is T6.4. Both are pre-existing debt carried verbatim through the move per the "make it simple — no redesign" directive.

  **Scope flag for T6.4:** the collective ESLint warning count across all migrated features is now substantial (~634 from T4.10+T4.11+T4.12 alone, plus T4.1–T4.9's pre-existing warnings). T6.4 typography tokenization + primitive adoption is a meaningful body of work — not a quick sweep. T6.3 (flip lint to error) is explicitly blocked on "adoption complete" per §6, which means these 234+ warnings (and the broader debt) MUST be cleared before T6.3 can flip the lint rule from warn → error. T6.3 readiness is the long-pole gate.

---

## Phase 4 closure (2026-07-06)

**Phase 4 COMPLETE: 12/12 tasks done.** All product code lives under `src/features/` with sub-folder structure matching §2 target. Every feature renders on tokens + primitives + the state model + the icon system, in both desktop + web modes, with no behavior regressions. The accent-color / `text-[..]` / `<button>` debts are explicitly deferred to T6.4 via C-412/C-413/C-415/C-416/C-417 — these are PRE-EXISTING debt carried verbatim, not regression risks. Phase 5 is now UNBLOCKED.

**Cumulative accent-color debt across Phase 4 (deferred to T6.4):**
- C-408/D-408 — extensions brand-color carve-out (intentional, retained).
- C-409 — voice decorative rgba gradient strings (D-401 carve-out, hue-free).
- C-412 — markdown/artifacts: ~30 violations across 10 files.
- C-415 — workspace: 16 violations across 2 files.
- C-416 — chat: 20 violations across 7 files.
- **Total: ~70+ instances across ~20 files**, all scheduled for the T6.4 final consistency sweep as a coordinated neutral redesign per §11.3.

---

## Phase 5 — T5.2 (settle hooks; 2026-07-06 — UNBLOCKED, audit-only pass)

- **D-503 — T5.2 hook consolidation boundary: local-providers + models-context cluster deferred to T5.3 (or future-feature-folder decision)** · feature-boundary decision (applies D-407 + the D-419/D-420/D-421/D-422 precedent over the §2 plan tree) · 2026-07-06
  T5.2's brief: "generic hooks stay in `hooks/`; confirm feature hooks already moved in Phase 4; no orphans." Auditor greppped all 28 hooks in `src/hooks/` to classify each. Findings produced 4 outcome categories; the boundary-relevant one is the 3-hook deferral decision:

  - **`useModels`** — FEATURE-shaped (models domain logic), but sole direct consumer is `contexts/ModelsContext.tsx` which is then consumed by 5 files spanning 4 features (models + settings + chat + an internal hook-cross-dep with `useDaemon`). The hook + the context form a coupled pair. Moving `useModels` alone to `features/models/hooks/` would scatter the pair (context stays in `contexts/`, hook moves to `features/models/`). Per "make it simple — consolidate, don't scatter" + D-407 strict-applying the necessary-but-not-sufficient precedent (sole-consumer is necessary; feature-shape is necessary; coupled-cluster-integrity is also necessary), the move is **deferred to T5.3** which settles contexts. T5.3 will likely consolidate `contexts/ModelsContext.tsx` into `features/models/` (or establish a clear shared-vs-feature context rule), and `useModels` will move WITH it.

  - **`useOllama`** + its consumer `components/OllamaStatus.tsx` (also an orphan in shared `components/`) — FEATURE-shaped (Ollama local-LLM provider status/models), sole-consumer rule satisfied. BUT the hook is part of a COUPLED local-providers cluster: `useModels` ↔ `useDaemon` (internal cross-dep), `useDaemon` consumed by `LocalProviderStatus` + `LMStudioStatus` (also in shared `components/`), `LMStudioStatus`/`OllamaStatus`/`LocalProviderStatus` all rendered by `features/settings/components/LocalServicesView.tsx`. Moving `useOllama` alone inverts the consumer-direction (consumer OllamaStatus would need `@/features/?` for a hook when its feature-folder home doesn't exist). The right answer for this cluster requires a design decision: **does the §2 plan need a new `features/local-providers/` feature folder** for local-LLM-provider status (its hooks + 3 status components + a cluster-barrel)? T5.2 is NOT empowered to create new feature folders per §6 Phase-5 brief ("consolidate, don't expand"). The cluster's reorganization is deferred to either T5.3 (if it can stay shared after the Models-Context-rule is settled — in which case `useOllama` STAYS in `hooks/` as a permanent shared local-provider-domain hook) OR a future plan amendment creating `features/local-providers/`. For NOW: **all three local-providers-cluster hooks (`useOllama`, `useModels`, `useComposioLogos` — though the last is borderline-vendor-cache not local-provider) STAY in `hooks/`**.

  - **`useComposioLogos`** — borderline: generic-cache *pattern* (module-level cached promise, `Map<appId, logo>`, structurally like `useCachedIcon`), but *data* is vendor-scoped (Composio extensions catalogue). Sole consumer is `features/chat/components/ChatComposer.tsx` — not extensions (one might expect extensions). Defaulting to STAYS per "make it simple, no over-engineering" — moving a vendored-cache hook to `features/extensions/hooks/` when its sole consumer is chat would invert the consumer-direction (extensions-folder would be exporting a thing only chat uses). Flagged for T5.5 barrels / T6.4 final consistency sweep to revisit if more consumers emerge (likely not, since Composio is wired into chat's MCP tool registry).

  Net boundary: T5.2 moved ZERO files. Three local-providers / models-context cluster hooks (`useModels`, `useOllama`, `useComposioLogos`) explicitly DEFERRED to T5.3 (useModels, coupled to ModelsContext) or future-feature-folder decision (useOllama + the local-providers cluster — likely a `features/local-providers/` folder if a Phase-5 amendment creates one; for now stays shared). Precedent reaffirmed: the D-419/D-420/D-421/D-422 "necessary-but-not-sufficient" cluster-integrity rule — moving a coupled-cluster piece alone is worse than leaving the whole cluster shared, because it scatters the cluster across shared + feature layers.

- **C-418 — T5.2 cataloged T4.8-retained dead duplicates for T6.2 deletion (no immediate removal per §6 plan)** · dead-code catalog · 2026-07-06
  T5.2's "no orphans" audit pass found 2 confirmed-dead files in shared folders — both T4.8-transcription-retained originals per D-403, now orphaned post-feature-relocation:
  - **`src/hooks/useFasterWhisper.ts`** (54 LOC) — byte-identical to `src/features/transcription/hooks/useFasterWhisper.ts` (the live feature-relocated version). Sole importer is the dead `src/components/FasterWhisperStatus.tsx`; the live `features/transcription` barrel's `FasterWhisperStatus` re-exports from `./components/FasterWhisperStatus` (the feature version), not from `components/`. Confirmed dead via grep across all `*.{ts,tsx}` in `src/`.
  - **`src/components/FasterWhisperStatus.tsx`** (147 LOC) — dead orphan component. Sole importer was the dead `hooks/useFasterWhisper.ts`. The rendered `FasterWhisperStatus` (consumed by `features/settings/components/LocalServicesView.tsx:14` via `import { FasterWhisperStatus } from "@/features/transcription"`) is the feature-relocated version at `src/features/transcription/components/FasterWhisperStatus.tsx`.

  Per §6 plan, T6.2 is "dead-code removal" — T5.2 is the "audit + catalog" pass, NOT the deletion pass. **No files removed during T5.2.** Cataloged here so T6.2 has the file list + grep-evidence + reasoning ready. Also noted for T6.2: the leftover `src/services/fasterWhisper/` directory (the pre-relocation service home — needs review when T6.2 does the Phase-4-retained-原件 sweep).

- **C-419 — T5.2 barrel audit: `src/hooks/index.ts` is mostly vestigial, flagged for T5.5** · barrels hygiene flag · 2026-07-06
  The barrel re-exports only 6 named things (`useAudioRecorder`, `useModels`, `useDebounce`/`useDebouncedValue`, `useCrossPlatform`, `useOllama`, `useDraftPersistence`). Of these, `useDraftPersistence` is re-exported FROM `@/features/chat/hooks/useDraftPersistence` — a shared barrel reaching INTO a feature folder, an inverted-dependency smell. Actual external `@/hooks`-via-barrel imports are essentially zero (1 real: `SettingsPage → useDebounce`); all other consumers import hooks by direct relative path. The barrel is largely vestigial. Per §6 plan, T5.5 ("types & barrels") owns the "make barrels complete or delete them — no partials" decision. T5.2 merely catalogues the smell; T5.5 should either:
   (a) make the barrel **complete** (re-export ALL 22 shared + 3 deferred-local-providers-cluster hooks consistently, eliminate the inverted `useDraftPersistence` reach-back by having consumers import that from `@/features/chat` directly), OR
   (b) **delete** the barrel entirely and standardize on direct-path imports (`@/hooks/useX`) across the codebase, eliminating the barrel-pattern layer for hooks. Most consumers already do this.
  Per-hook barrel decision is T5.5 scope, NOT T5.2.

  **T5.3 update (2026-07-06):** Added another inverted-dependency smell to the barrel — `useModels` now re-exports FROM `@/features/models/context/useModels` (per D-524 below). The barrel now has TWO reach-backs into feature folders (`useDraftPersistence` → chat; `useModels` → models). This strengthens the case for the T5.5 "delete the barrel" option.

---

## Phase 5 — T5.3 (settle contexts; 2026-07-06 — UNBLOCKED)

- **D-524 — T5.3 ModelsContext move: ChatProvider-T4.12 shim-precedent pattern applied** · feature-boundary decision (user direction) · 2026-07-06
  T5.2 audit (D-503) recommended: "T5.3 will likely consolidate `contexts/ModelsContext.tsx` into `features/models/` (or establish a clear shared-vs-feature context rule), and `useModels` will move WITH it." T5.3 implemented this with the ChatContext.tsx backward-compat shim pattern from T4.12 (D-422):
   - `ModelsContext.tsx` (16 LOC) moved to `src/features/models/context/ModelsContext.tsx`. Imports the implementation hook from sibling `./useModels`.
   - `useModels.ts` (143 LOC) moved to `src/features/models/context/useModels.ts`. Imports repointed relative→`@/` (services for ai/errors/local/logging; `contexts/SettingsContext` is global-stays; `hooks/useDaemon` stays shared per D-503).
   - Barrel `src/features/models/context/index.ts` re-exports `ModelsProvider`, `useModelsContext`, `useModels`, `UseModelsResult` type — the public surface.
   - `src/contexts/ModelsContext.tsx` (16 LOC) → 1 LOC shim re-exporting `ModelsProvider` + `useModelsContext` from `@/features/models/context`.
   - `src/hooks/index.ts` barrel's `useModels` re-export repointed from `"./useModels"` → `"@/features/models/context/useModels"`.
  **6 external consumers UNCHANGED:** App.tsx (mounts `ModelsProvider`), features/models/components/ModelLibraryPanel.tsx, features/settings/SettingsPage.tsx, features/settings/components/IntelligenceView.tsx, features/chat/ChatPage.tsx, features/chat/context/ChatProvider.tsx — all import `useModelsContext as useModels` from `@/contexts/ModelsContext` (now the shim). ZERO churn on the 6 consumers; the shim absorbs all the relocation.

  **Why MOVE not STAY:** the §6 plan T5.3 brief reads "`contexts/` holds only global (Auth/Settings/Navigation/Offline/CommandPalette); feature contexts confirmed moved." ModelsContext is FEATURE-shaped (the models domain logic), not a global-app-state context (like Auth/Settings/Navigation). Even though it's CONSUMED across 4 features (multi-feature reach), that's the same shape as ChatContext (consumed across 13+ features). T4.12 set the precedent: a feature-context that's consumed across many features lives in its feature folder + a backward-compat shim absorbs consumer churn. T5.3 applies the same pattern to ModelsContext. Symmetry with the ChatProvider-T4.12 boundary decision.

  **Why COUPLED move (`useModels` WITH `ModelsContext`):** the D-503 cluster-integrity rule (extending D-419/D-420/D-421/D-422). `useModels` is the implementation hook INSIDE `ModelsProvider`. Its sole direct consumer is `ModelsContext.tsx`. Moving one without the other would scatter the cluster (the context would need to import the implementation across a layer boundary direction it shouldn't). Coupled move keeps them as siblings in `features/models/context/`.

  **`useDaemon` stays shared (D-503):** despite the local-providers cluster membership, `useDaemon` is multi-consumer (LocalProviderStatus + LMStudioStatus + useModels itself) — and now "useModels" moves but useDaemon stays shared. The cross-feature import `from "@/hooks/useDaemon"` in the relocated `features/models/context/useModels.ts` is the explicit forward-looking import pattern (same as ChatPage's `from "@/features/workspace"` cross-feature import in T4.11 D-421). NOT a smell — it's the cluster-integrity rule's natural consequence (cluster pieces that genuinely need to stay shared stay shared, the rest of the cluster moves).

  **Net: 4 files added** (the feature-folder ModelContext.tsx + useModels.ts + index.ts barrel + shim-converted-original-contexts-file), **1 file edit** (`hooks/index.ts` repoint), **1 D-403-retained** (`hooks/useModels.ts` — per C-420 below, the original is preserved since its relative imports still resolve and D-403 retains originals until Phase 6 confirmation pass). T5.3 produced changes in 5 files total.

- **C-420 — T5.3 cataloged T5.3-retained `src/hooks/useModels.ts` dead duplicate for T6.2 deletion** · dead-code catalog · 2026-07-06
  Extends C-418 (T5.2 cataloged `hooks/useFasterWhisper.ts` + `components/FasterWhisperStatus.tsx` for T6.2). After the ModelsContext coupled-cluster move per D-524, `src/hooks/useModels.ts` (143 LOC) becomes a dead-but-compiling duplicate of `src/features/models/context/useModels.ts`. Per D-403 retain-originals convention (not C-414 deviation), the original is kept in place — its relative imports (`from "../services/ai/modelService"`, `from "./useDaemon"`, etc.) still resolve since none of its deps moved, so it compiles cleanly. The `hooks/index.ts` barrel was repointed to the new feature location, so the original is unreferenced — dead-but-compiling.
  **Rationale for retain-originals (D-403) over MOVE (C-414):** C-414's deviation was justified by a "workspace files form interconnected cluster with stale relative imports" reasoning — originals-in-place would have been 17 dead-code-with-broken-imports files. C-414 doesn't fit T5.3 because (a) here it's a 1-file retention, not a 17-file cluster; (b) the retained original is dead-but-compiles (its imports still resolve since none of its deps moved). The retain-originals safety-net (git + D-403 catalog-for-T6.2) is preferred over the cleaner-but-harder-to-rollback MOVE when the file-by-file decision is right at the "1-file retention whose imports still resolve" line. T6.2 will handle deletion as a unified pass.
  **Cataloged here** so T6.2 has the file + reasoning + grep-evidence ready. Confirmed dead via: `grep` for `from ['"][^'"]*hooks/useModels['"]` returns 0 matches outside the file itself + the now-repointed barrel.

- **Verified T5.2 D-503 audit findings accurate — 4 re-confirmed STAY SHARED contexts:** `RecordingContext` (D-415 — 4 consumers incl. GlobalShortcutHandler), `LiveSessionContext` (D-419 — same shape, file's own header justifies global-on-purpose), `ArtifactPanelContext` (D-420 cluster + generic-shaped open-code/open-document triggers, not artifacts-feature-shaped), `BrowserPanelContext` (D-421+D-422 cluster + generic-shaped open-html trigger). All 4 had their Phase-4 boundary-decision reasoning re-verified at T5.3 via fresh grep + file-shape inspection. No orphans. T5.2's audit was accurate.

- **Empty `src/contexts/chat/` sub-folder flagged for T6.2 cleanup:** post-T4.12, `src/contexts/chat/` directory exists but is empty (its 13 files were relocated to `features/chat/context/`). It's a dead folder — flagged for the T6.2 dead-code removal pass alongside the C-418 + C-420 catalogs.

---

## Phase 5 — T5.4 (tidy services; 2026-07-06 — UNBLOCKED)

- **D-525 — T5.4 boundary: 3 FEATURE-shaped services MOVED to feature folders (+ 3 generic-shaped services STAY shared per D-526)** · feature-boundary decision (applies D-407 + D-419/D-420/D-421/D-422/D-524 precedent over the §6 plan brief) · 2026-07-06
  The §6 plan T5.4 brief listed `services/{chat,context,agents,mcp,local}` as 1-file-folder collapse candidates. Reality-checking (applying the precedent chain):
  - **`services/chat/searchConversations.ts`** — sole consumer `components/overlays/CommandPalette.tsx` imports `searchMessages`/`invalidateSearchCache`/`MessageHit`. The file operates on chat-domain data (conversation message search via `../storage/chatHistoryService`). FEATURE-shaped (chat) + sole-consumer ⇒ MOVED to `features/chat/services/searchConversations.ts`. Repointed internal relative → `@/`; repointed consumer.
  - **`services/context/contextRetrievalService.ts`** — file header literally reads "Handles @chat mentions and context retrieval"; `ContextReference.type` hardcoded to `'chat'` only. Live consumer `features/chat/components/ContextAutocomplete.tsx` (type-only). Plus dormant consumer `hooks/useCrossPlatform.ts` (itself dead per C-422). FEATURE-shaped (chat) ⇒ MOVED to `features/chat/services/contextRetrievalService.ts`. Repointed 3 internal imports + 1 live consumer.
  - **`services/agents/agentWorkflowService.ts`** — sole consumer `features/workspace/WorkspacePage.tsx` imports 6 functions + 5 types for agent CRUD + run operations over `/agent-workflows` REST endpoints. FEATURE-shaped (workspace) ⇒ MOVED to `features/workspace/services/agentWorkflowService.ts`. Repointed 2 internal imports + 1 consumer.

  - **`services/mcp/mcpInvoker.ts`** — STAYS. Sole consumer is `features/chat/context/toolExecutor.ts` currently, BUT the file's own header explicitly mandates it as "the single source of truth for how MCP tool calls are made from the STUDIO frontend — every future MCP invocation must go through here, never call `invoke("mcp_call_tool")` directly." This is GENERIC cross-feature infra BY DESIGN (not chat-feature-shaped; chat happens to be the only current consumer because chat owns the agent tool-execution pipeline). Per D-407 + the file's self-declared mandate, STAYS + added barrel.

  - **`services/local/` (2 files: `localMcpControl` + `daemonClient`)** — STAYS. `localMcpControl` is multi-consumer (3: `useHarnessInit` + `features/chat/context/ChatProvider` + `features/settings/SettingsPage`); file header mandates it as the local-MCP "single source of truth" shared between first-run + Settings + chat provider. `daemonClient` is the local-providers cluster's HTTP client (multi-consumer: 3 live + 1 dead). Per D-503/D-524, part of the deferred local-providers cluster. STAYS + added `index.ts` barrel.

  - **`services/skills/skillDeployer.ts`** — STAYS. Sole consumer is `App.tsx` (composition root — bootstrap-time bundled-skill deployment writing `$HOME/.studio/skills/`). App-shell bootstrap infra, not feature-domain logic (no `features/skills/` exists; this is platform-init wiring that runs once at launch). STAYS + added `index.ts` barrel per §16 barrel convention ("complete or delete").

  Net boundary moved (3 files → feature folders + 3 dead-but-compiling D-403-retained originals cataloged for T6.2): `searchConversations` + `contextRetrievalService` → `features/chat/services/`; `agentWorkflowService` → `features/workspace/services/`. Net boundary STAY (3 folders + 5 files, formalized with barrels): `services/mcp/` + `services/local/` + `services/skills/`. Plus 2 new feature-services barrels (`features/chat/services/index.ts` + `features/workspace/services/index.ts`) created to formalize the new sub-folders.

- **D-526 — T5.4 generic-shaped services STAY SHARED principle + barrel formalization** · feature-boundary decision · 2026-07-06
  Reinforces D-407 (multi-consumer ⇒ STAY) + extends it: a 1-file folder holding GENERIC-CROSS-FEATURE infra is acceptable structure; the "collapse" action for these is to ADD an `index.ts` barrel formalizing the folder as a unit per §16 Import/Export Conventions ("barrels: complete or delete — no partials"), NOT to dissolve the folder. Examples: `services/mcp/` (platform-wide MCP invocation contract by file's own header mandate); `services/local/` (local-MCP + daemon-client for the coupled local-providers cluster); `services/skills/` (app-bootstrap bundled-skill deployment).
  Conversely: a 1-file folder holding FEATURE-shaped logic WITH a sole-feature-consumer should MOVE the file to the corresponding `features/<x>/services/` sub-folder (D-525). The original `services/<folder>/<file>.ts` is retained per D-403 retain-originals convention (the file's internal relative imports still resolve post-move since its deps stayed shared), cataloged for T6.2 deletion.
  This 2-rule framework (D-525 MOVE + D-526 STAY-barrel) resolves the §6 brief's ambiguous "collapse 1-file folders" — there's no universal "collapse"; each folder requires the boundary judgment.

- **C-421 — T5.4 AI `modelsService.ts` (plural) cataloged for T6.2 retirement; `modelService.ts` (singular) canonical** · dead-code catalog · 2026-07-06
  The §6 brief asked to "split/clarify services/ai (resolve modelService vs modelsService)". Audit revealed: NOT a "split" question — the two were never peers. `modelService.ts` (singular) is THE canonical rich model service (570 LOC; `Model` interface, fetchModels with cloud+Ollama+FasterWhisper merge + caching, 12 sorting/grouping helpers). `modelsService.ts` (plural) is a 14-LOC vestigial pre-refactor stub (`getModels` + `checkHealth` raw API helpers) that the umbrella `aiService.ts` still re-exports but ZERO consumers actually call (grep confirms `aiService.getModels` + `aiService.checkHealth` invocations = 0).
  Per "make it simple, no over-engineering", disambiguation is DOCUMENTATION-ONLY (no code edits):
  - `modelsService.ts` is NOT marked `@deprecated` (the umbrella re-export still works; marking it deprecated would trigger transitive deprecation warnings for `aiService.getModels`/`aiService.checkHealth` callers — and there ARE no callers anyway, so the warnings would be misleading).
  - `aiService.ts` umbrella barrel comment left unchanged (it currently just LISTS module contents: `modelsService.ts — getModels, checkHealth`).
  - T6.2 will remove `modelsService.ts` + drop its 3 references from `aiService.ts` (the `export { getModels, checkHealth } from "./modelsService"` + `import { getModels, checkHealth } from "./modelsService"` + 2 entries in the `aiService` convenience object).
  Cataloged here so T6.2 has the file + reasoning + grep-evidence. Confirmed dead via: `grep "from.*modelsService"` returns 3 matches ALL inside `aiService.ts` itself (re-export lines + internal import); `grep "aiService\.(getModels|checkHealth)"` returns 0 matches — nobody calls the umbrella's {getModels, checkHealth} entries either.

  Cataloged here so T6.2 has the file + reasoning + grep-evidence. Confirmed dead via: `grep "from.*modelsService"` returns 3 matches ALL inside `aiService.ts` itself (re-export lines + internal import); `grep "aiService\.(getModels|checkHealth)"` returns 0 matches — nobody calls the umbrella's {getModels, checkHealth} entries either.

- **C-422 — T5.4 bonus finding: `src/hooks/useCrossPlatform.ts` is dead (0 live callers); cataloged for T6.2** · dead-code catalog · 2026-07-06
  During the T5.4 `contextRetrievalService.ts` consumer audit, found that `useCrossPlatform` was flagged as a consumer (line 8: `import * as contextRetrievalService from '../services/context/contextRetrievalService'`). Grep for callers of `useCrossPlatform` itself returns 0 matches outside the file + the vestigial `hooks/index.ts` barrel re-export (consistent with C-419 — the barrel re-exports dead hooks). The hook's `useCrossFeatureCodeAssistant` function that wraps `contextRetrievalService` has no live feature-surface caller — the feature flag that gated it appears to have been retired.
  Cataloged for T6.2 alongside C-418 (`useFasterWhisper.ts` + `components/FasterWhisperStatus.tsx`) + C-420 (`hooks/useModels.ts`) + C-421 (`modelsService.ts`) + the now-empty `services/{chat,context,agents}/` folders' D-403-retained originals.
  T6.2 has a substantial catalog now. Recommended: T6.2 should be done as a single coordinated pass over all C-418/C-420/C-421/C-422 catalog items (plus the C-421/C-422 success criteria: confirm-still-dead via fresh grep before each deletion — the "auditconfirmed-dead-then-delete" pattern from C-418).

  **T5.5 update (2026-07-06):** `useCrossPlatform`'s dead status was confirmed at T5.5 when the `hooks/index.ts` barrel was DELETED per C-419/C-524-extended recommendation — the barrel had been re-exporting `useCrossPlatform` to its 0 live consumers. Post-deletion, nothing imports `useCrossPlatform` at all (cataloged for T6.2 deletion as before).

---

## Phase 5 — T5.5 (types & barrels; 2026-07-06 — UNBLOCKED)

- **D-527 — T5.5 types-and-barrels boundary: SHIM approach + DELETED vestigial `hooks/index.ts` barrel** · feature-boundary decision (applies D-524 ModelsContext / D-422 ChatContext precedent to types) · 2026-07-06
  User chose "Full refactor" for T5.5. To honor "aggressively move all FEATURE-shaped types to their feature folders" while respecting "make it simple — no over-engineering" + the D-524 precedent (feature-context-multi-consumed moved into feature folder WITH backward-compat shim), T5.5 uses the SHIM approach:
   - Created 3 new feature-types files holding CANONICAL type DEFINITIONS:
     - `src/features/chat/types.ts` — `HarnessEvent`, `MessageSegment`, `ChatMessage`, `ClaudeRateLimitInfo`, `ClaudeSessionMetadata`, `ConversationMetadata`, `MessageOptions`, `ChatConversation` (8 chat-domain types self-referential cluster, no external imports beyond siblings).
     - `src/features/settings/types.ts` — `ThemePreference`, `AppSettings` (+ the `RephraseTone` import from `@/utils/prompts` that AppSettings.rephraseTone references).
     - `src/features/transcription/types.ts` — `RecordingState` enum.
   - Converted `src/types/index.ts` (241 LOC) to a shim (~50 LOC): kept inline `AccessTokenPayload` + `RefreshTokenPayload` (auth-protocol types — stay shared since JWT-token-structure is genuinely-cross-cutting; consumed by shared `utils/tokenManager.ts` not feature-specific) + `APIResponse<T>` (generic wrapper, shared). Added 3 shim re-exports at the END:
     - `export type { ...chat types... } from "@/features/chat/types";`
     - `export type { AppSettings, ThemePreference } from "@/features/settings/types";`
     - `export { RecordingState } from "@/features/transcription/types";` (enum needs runtime export, not type-only).
   - Removed the historical `import { RephraseTone } from "../utils/prompts"` (no longer needed since AppSettings+ThemePreference moved out).

  **Why SHIM approach over the user's "Full refactor" framing:** user's choice said "Aggressively move all FEATURE-shaped types to their feature folders; repoint all consumers; risk touching up to 20+ files. Highest churn." Implementing this LITERALLY would have required repointing ~100+ consumer imports from `@/types` (or `../types`, `../../types`) to `@/features/<x>/types` — would have created 100+ inverted-dependency smells (shared services such as `services/storage/chatHistoryService` reaching into `features/chat/types` for `ChatConversation`; same for `services/conversations/claude/*`, `services/conversations/storage/*`, `services/conversations/ownership/*`, `services/context/contextRetrievalService.ts` D-403-retained). The SHIM approach achieves the SAME canonical-location outcome (canonical definitions now LIVE in feature folders) WITHOUT the 100+ churn. Follows the D-524/D-422 precedent set in T5.3/T4.12 — feature-shape + multi-feature-consumed ⇒ MOVE to feature folder + leave backward-compat shim for consumers. T6.2 will migrate consumers to direct `@/features/<x>/types` imports as a clean Phase-6 pass (same as how T6.2 will retire the ModelsContext + ChatContext shims after consumers migrate).

  **Barrel policy: DELETED the vestigial `src/hooks/index.ts` barrel** (per C-419 recommendation + §6 "make barrels complete or delete — no partials"):
   - The barrel was VESTIGIAL — re-exported only 6 things, had only 1 real external consumer (`SettingsPage.tsx:34 → useDebounce`), and had 2 inverted-dependency reach-backs (`useDraftPersistence → @/features/chat/hooks/useDraftPersistence` from T4.12 + `useModels → @/features/models/context/useModels` from T5.3 D-524).
   - DELETED the barrel. Repointed the 1 barrel-style importer (`SettingsPage.tsx:34` from `@/hooks` → `@/hooks/useDebounce` direct path). The other 5 re-exports had already been imported via direct relative paths by their actual consumers, so deleting the barrel changed nothing for them (the `useModels` + `useDraftPersistence` reach-backs simply disappear; the 3 truly-shared-still-`hooks/` ones — `useAudioRecorder`, `useDebounce`/`useDebouncedValue`, `useCrossPlatform`, `useOllama` — were never imported via the barrel except indirectly through the 1 now-repointed consumer).
   - Post-deletion: `src/hooks/` no longer has an `index.ts` — the §16 convention for the `hooks/` folder becomes "import directly from `@/hooks/useX`". This eliminates the inverted-dependency smell that C-419 flagged + amplifies the cleaner pattern for any new shared hook going forward.

  **DEFERRED to T6.4 ("standardize `@/` imports" sub-brief):** a comprehensive sweep across the codebase to convert lingering relative-path imports to `@/` aliases. This is a separate large-scale pass; T5.5 done tile = "slim types/index.ts" + "barrel policy" (2 of the 3 sub-briefs). The relative→`@/` cleanup is a consistency-sweep item; cataloged for T6.4 alongside the typography-tokenization and primitives-adoption sweeps.

- **C-423 — T5.5 catalog for T6.2: migrate `@/types` consumers to direct `@/features/<x>/types` imports** · consistency-sweep deferral · 2026-07-06
  Per **D-527** shim approach above: 100+ consumers across the codebase currently import chat-domain types (`ChatMessage`, `ChatConversation`, etc.), settings types (`AppSettings`, `ThemePreference`), or `RecordingState` from `@/types` (now the shim). Examples:
   - `services/storage/chatHistoryService.ts:1`, `services/storage/memorySystem.ts:7` — chat types via `@/types`
   - `services/conversations/{claude/*,storage/*,ownership/*}` — chat types via `@/types`
   - `contexts/SettingsContext.tsx:10`, `features/settings/components/*` — `AppSettings` via `@/types`
   - `services/storage/fileConfigService.ts:6`, `services/storage/configService.ts:1` — `AppSettings` via `@/types`
   - `contexts/{LiveSessionContext,RecordingContext}.tsx`, `services/platform/{pulseCoordinator,overlayService,islandViewState}.ts`, `pages/{TranscribePage,OverlayPage}.tsx`, `components/{GlobalShortcutHandler,overlays/IslandAtoms,overlays/FloatingIsland}.tsx`, `hooks/useAudioRecorder.ts` — `RecordingState` via `@/types`
   - `utils/theme.ts:1`, `utils/harnessEventUtils.ts:6` — `ThemePreference` + `HarnessEvent` via `@/types`
   - `features/transcription/TranscribePage.tsx:8`, `features/transcription/services/fasterWhisper/*` — `RecordingState` via `@/types`
  T6.2 should migrate these consumers to direct `@/features/<x>/types` imports (e.g. `import { ChatMessage } from "@/features/chat/types"`), then DELETE the `src/types/index.ts` shim. Same Phase-6 policy as the ChatContext / ModelsContext shim retirements.

  Note: the AccessTokenPayload + RefreshTokenPayload + APIResponse types STAY in `@/types` as truly shared types (auth-protocol + generic-wrapper); they're NOT candidates for fature-folder relocation.

---

### D-528 — T5.6 boundary: toolCardUtils+mcpRegistry MOVE to `features/chat/tools/` + shim · 2026-07-06

**Context:** T5.6 brief is "purge `.tsx` from `utils/`" (§2 placement rule 3: "Has JSX? → it's a component, not a util"). Glob `src/utils/*.tsx` returned exactly 2 files: `toolCardUtils.tsx` (130 LOC; phosphor-icon→glyph mapping + `getToolIcon`/`toolLabel`/`argsPreview` JSX-bearing tool-call-card helpers) + `mcpRegistry.tsx` (220 LOC; `McpServiceInfo` registry with hand-authored SVG brand icons). The two form a coupled 2-file cluster — mcpRegistry's sole consumer is toolCardUtils (line 22: `import { resolveMcpService, getMcpActionLabel } from "./mcpRegistry"`).

**Decision: MOVE canonical files to `features/chat/tools/`; leave 1-LOC `.ts` re-export shims at the old `utils/` paths.** This applies the established **shim pattern** (D-422 ChatContext → T4.12; D-524 ModelsContext → T5.3; D-527 types/index.ts → T5.5) — the 4th application of the pattern. Rationale:
 - toolCardUtils is **feature-shaped** (tool-call-card rendering helpers for the chat tool-step UI) AND its primary consumers are in `features/chat/tools/` (`InlineToolSteps.tsx`, `HarnessStepCard.tsx`).
 - BUT it has 4 external consumers across **2 features**: chat×2 + **permissions×2** (`usePermissionNotifications.ts` + `ComposerApprovalCard.tsx`, both importing via relative `../../../utils/toolCardUtils`). So chat is NOT the sole consumer → D-407's "sole-consumer" gate is NOT met → cannot naively move + repoint without either (a) churning 4 consumers now, or (b) leaving a shim.
 - The shim approach = ZERO consumer churn. T6.2 will migrate the 4 consumers to direct `@/features/chat/tools/toolCardUtils` imports + retire both shims (same Phase-6 policy as the ChatContext/ModelsContext/types shim retirements).

**Concrete ops:**
 - Copied `toolCardUtils.tsx` → `src/features/chat/tools/toolCardUtils.tsx`; fixed the `./formatters` import → `@/utils/formatters` (absolute — the file moved dirs, so the relative `./formatters` would resolve to `features/chat/tools/formatters` which doesn't exist; `utils/formatters.ts` is a pure `.ts` util with no §6 violation). The `./mcpRegistry` import stays relative — mcpRegistry moved to the SAME dir (`features/chat/tools/`), so sibling-relative still resolves.
 - Copied `mcpRegistry.tsx` → `src/features/chat/tools/mcpRegistry.tsx` (verbatim — all imports are package-level `react`/`@phosphor-icons`, no relative paths to fix).
 - Deleted originals `utils/toolCardUtils.tsx` + `utils/mcpRegistry.tsx`; replaced with `utils/toolCardUtils.ts` + `utils/mcpRegistry.ts` (`.tsx`→`.ts` rename since the shims have NO JSX). Each is a 1-LOC re-export: `export * from "@/features/chat/tools/toolCardUtils"` / `export * from "@/features/chat/tools/mcpRegistry"`.
 - The `.tsx`→`.ts` extension change is transparent to consumers (TS/Vite resolve without extension). ZERO consumer churn — all 4 importers (`@/utils/toolCardUtils` + `../../../utils/toolCardUtils`) resolve to the `.ts` shim.
 - Post-move: `glob src/utils/*.tsx` returns 0 results — **`utils/` is now JSX-free per §6**.

**Why mcpRegistry got a shim too:** mcpRegistry has ZERO external consumers (only toolCardUtils imports it, and that's now in `features/chat/tools/` importing `./mcpRegistry` sibling). So strictly, `utils/mcpRegistry.ts` is immediately dead. BUT per D-403 ("pre-move originals retained as superseded reference") + the shim-pattern consistency (every D-422/D-524/D-527 move left a shim, not a deletion), the defensive shim is kept. It costs 1 LOC and eliminates any risk of a missed consumer. T6.2 deletes it after a fresh-grep confirmation.

**Verified:** `tsc --noEmit` clean; ESLint 0 errors / 25 warnings (all pre-existing D-405: 7 `react-refresh/only-export-components` on mcpRegistry's mixed component+type exports + the SVG brand-icon `currentColor` hex literals in the `no-restricted-syntax` guardrail — these are brand-logo SVG paths, same carve-out category as T3.5/T4.4; 0 new warnings introduced); desktop build green (37.10s); web build green (40.52s).

**Why not move to `features/extensions/`:** the §6 brief's original suggestion was "`mcpRegistry.tsx`→`features/extensions`/`components`". BUT mcpRegistry's sole consumer is toolCardUtils, whose 4 consumers are all in chat/permissions — NOT extensions. Moving mcpRegistry to extensions would invert the dependency direction (extensions reaching out to chat for the consumer). The chat-tools folder is the correct semantic home: toolCardUtils + mcpRegistry are both about rendering **tool-call cards** in the chat tool-step UI. (Compare: `features/extensions/` holds the MCP-server management UI — ExtensionsPage, AddServerForm, etc. — a different concern from the tool-call rendering helpers.)

---

### C-424 — T5.6 catalog for T6.2: retire the 2 `utils/` toolCard shims · 2026-07-06

Per **D-528** above, two shims were left in `utils/` as back-compat re-exports:
 - `src/utils/toolCardUtils.ts` (1-LOC shim → `@/features/chat/tools/toolCardUtils`) — has 4 live consumers (chat×2 + permissions×2). Retire AFTER migrating the 4 consumers to direct `@/features/chat/tools/toolCardUtils` imports.
 - `src/utils/mcpRegistry.ts` (1-LOC shim → `@/features/chat/tools/mcpRegistry`) — has ZERO external consumers (only toolCardUtils imports it, and that's now a sibling in `features/chat/tools/`). **Immediately dead** — can be deleted first in T6.2 after a fresh `grep mcpRegistry` confirms zero consumers outside `features/chat/tools/`.

Same Phase-6 policy as the ChatContext (D-422) / ModelsContext (D-524) / types-index (C-423) shim retirements. The T6.2 dead-code pass should: (1) grep-confirm each shim is still dead-or-shimmed, (2) migrate consumers to direct feature imports, (3) delete the shim. This is the 4th and final shim established in Phase 5 — Phase 6 retires all 4.

---

### D-601 — T6.1 boundary: 2 token groups DELETED now; 3 DEFERRED to end-of-T6.4 · 2026-07-06

**Context:** T6.1 brief is "delete `luxury.*`, `dark.*`, `success/error/warning/info`, dead keyframes (now that adoption is complete). **Verify nothing references them.**" The plan's gate is "verify nothing references them." Audited via targeted grep against the actual codebase (not just the plan's assumption that "adoption is complete"). Result: **adoption is COMPLETE for 2 of the 5 deprecated token groups; LIVE consumers remain for 3.**

**Decision — split T6.1 into 2 outcomes (delete-now vs defer-to-end-of-T6.4):**

**(a) DELETED (gate passes — 0 live consumers):**
 - `success`/`error`/`warning`/`info` scalar colors (tailwind.config.js colors block, T1.2-deprecated) — grep `(bg|text|border|ring|fill|from|to|via)-(success|error|warning|info)(-[0-9])?` returns 0 matches. Phase 4 features migrated directly to `<Warning>`/`<Success>` glyph + `bg-surface-*` (never used these placeholder scalars).
 - `shadow-dark-sm`/`shadow-dark-md`/`shadow-dark-lg`/`shadow-dark-xl` (boxShadow block) — grep `shadow-(dark-sm|dark-md|dark-lg|dark-xl)` returns 0 matches. The base `--shadow-*` sizes auto-switch via CSS vars; no `dark:` shadow variant is needed.
 - Dead keyframes — T1.7 already deleted `slideUp`/`pulseSmooth`/`listening`. Reconfirmed in T6.1: only `scaleIn` + `shimmer` remain in `tailwind.config.js`, both in live use (`scale-in` in `components/ui/Select.tsx:49` open animation; `shimmer` in skeleton loaders). No-op for T6.1.

**(b) DEFERRED to end-of-T6.4 (gate fails — live consumers exist; deleting would break the build):**
 - `luxury.*` green palette — 3 live refs in 1 file (`features/chat/components/ConversationsDropdown.tsx:83/215/222` — `bg-luxury-500 dark:bg-luxury-400`, `border-luxury-500 dark:border-luxury-400`, `text-luxury-600 dark:text-luxury-400`). This is **C-416-cataloged accent-color debt** — explicitly deferred-to-T6.4 per the user's "Accent-color violations carried verbatim, deferred to T6.4" rule (recorded at T4.12). T6.4 neutralizes these 3 call-sites; palette → 0 consumers → delete.
 - `dark.*` explicit dark palette — 57 live refs across ~20 files (the pre-token `dark:bg-dark-100`/`dark:bg-dark-50`/`dark:bg-dark-300`/`dark:text-dark-600` patterns). Files include: `App.tsx`, `MainLayout.tsx`, `ChatPage.tsx`, `WorkspacePage.tsx`, `features/workspace/browser/BrowserPanel.tsx`, `features/workspace/terminal/TerminalPanel.tsx`, `features/workspace/rightWorkspace/{WorkspaceHomePanel,WorkspacePlaceholderPanel,SideChatPanel}.tsx`, `features/artifacts/{ArtifactPanel,components/ArtifactLabPanel}.tsx`, `components/{layout/TitleBar,layout/AccountMenu,layout/MainLayout,GlobalContextEvents,ErrorBoundary,ui/ArtifactPanel}.tsx`, `pages/{TranscribePage,TemporaryPage,SplashPreviewPage,ShaderWelcomePage,ProjectsPage,ProfilePage}.tsx`. T6.4's tokenization sweep migrates these to `bg-surface-*` (auto-switching, no `dark:` prefix); palette → 0 consumers → delete.
 - `surface.lift` alias (of `selected`) — 68 live refs across ~20 files (`dark:bg-surface-lift` + `dark:hover:bg-surface-lift` + `dark:border-surface-lift` patterns). Both the tailwind bridge key (`colors.surface.lift` in tailwind.config.js) AND the `--surface-lift` CSS var in `tokens.css` (:root line 39 + html.dark line 94) are the alias surface. T6.4 migrates `bg-surface-lift` → `bg-surface-selected` (1:1 alias — same value); then both the bridge key + the CSS var die → delete.

**Why defer instead of migrate-in-T6.1:** the 3 deferred items are EXACTLY what T6.4 owns — "final consistency sweep — accent neutralization + typography tokenization + primitive adoption + `@/` import standardization." Migrating 128 call-sites (57 `dark:bg-dark-*` + 68 `bg-surface-lift` + 3 `bg-luxury-*`) is a multi-file sweep, NOT a token-deletion task. Per "follow exact order, no more partial, no more skip" + "make it simple," T6.1 owns ONLY the deletion of genuinely-dead tokens; T6.4 owns the consumer migration that makes the remaining 3 dead. This is the same ordering as the Phase-5 shim pattern: migrate consumers FIRST (T6.4 here; consumer migration in Phase 5), THEN delete the dead token/shim (end-of-T6.4 here; T6.2 for Phase-5 shims).

**Inline `@deprecated` comments updated (tailwind.config.js + tokens.css):** the stale "removed in Phase 6 (T6.1)" / "removed Phase 6" wording on the 3 deferred tokens now says "T6.1 DEFERRED to end-of-T6.4" + records the live-consumer count + which T6.4 sub-sweep owns the migration. So the docs reflect where the deletion will actually happen.

**`gray.*` palette NOT deprecated** — kept as the workhorse neutral (paired legitimately with `surface-*` tokens for borders/text; not in the guardrail scan regex). **`--app-bg-dark` CSS var LIVE** — used by `html` background (Tauri frameless corners, `index.css:49`) + `shell/workspaceShell.css:21` (zen-shell-bg); NOT a deletion candidate. (The `bg-dark-100` Tailwind CLASS is the legacy consumer that T6.4 will migrate, but the `--app-bg-dark` CSS var itself is current infra.)

**Verified:** `tsc --noEmit` clean; desktop build green (39.12s); web build green (39.58s); post-delete grep reconfirm: `bg-success`/`text-error`/`border-warning`/`shadow-dark-sm` all return 0 matches (deletion is clean — no broken references). The 3 deferred tokens are untouched (still in tailwind.config.js + tokens.css with updated comments pointing at T6.4).

---

### C-425 — post-T6.4 token-deletion catalog (3 deferred tokens) · 2026-07-06

Per **D-601** above, 3 `@deprecated` tokens have live consumers and MUST be deleted at the END of T6.4 (after T6.4's consumer-migration sweep makes them dead). Catalog:

1. **`luxury.*` green palette** — `tailwind.config.js` colors block (lines ~55-66, 9 shades 50-900). 3 consumers in `features/chat/components/ConversationsDropdown.tsx`. T6.4 accent-neutralization sub-sweep migrates the 3 call-sites → palette 0-consumers → DELETE the 9-shade block.
2. **`dark.*` explicit dark palette** — `tailwind.config.js` colors block (lines ~69-80, 10 shades 50-900). 57 consumers across ~20 files. T6.4 tokenization sub-sweep migrates `dark:bg-dark-*` → `bg-surface-*` → palette 0-consumers → DELETE the 10-shade block.
3. **`surface.lift` alias** — `tailwind.config.js` colors.surface.lift (1 bridge key, line ~94) + `src/tokens/tokens.css` `--surface-lift` (:root line ~39 + html.dark line ~94, 2 CSS var definitions). 68 consumers across ~20 files. T6.4 tokenization sub-sweep migrates `bg-surface-lift` → `bg-surface-selected` (1:1 alias) → tokens 0-consumers → DELETE the bridge key + both CSS var definitions.

**Pre-deletion gate (same as T6.2 dead-code discipline):** each deletion MUST be preceded by a fresh grep that confirms 0 live consumers. If T6.4's sweep leaves any stragglers, those get migrated FIRST (or the deletion is blocked until they're resolved) — never delete-then-discover.

This is the **5th and final post-sweep-deferred-deletion catalog** in the project (joining C-423 types-shim retirement, C-424 toolCard-shim retirement, C-418/C-420/C-421/C-422 dead-duplicate removals, D-403-retained originals). All consolidate into the T6.4 → final-cleanup sequence.

---

### D-602 — T6.2 decision: KEEP `types/index.ts` as permanent shared-types barrel (NOT a shim to retire) · 2026-07-06

**Context:** T5.5 D-527 established `types/index.ts` as a back-compat re-export shim — "T6.2 will migrate consumers to direct `@/features/<x>/types` imports + retire the shim." T6.2 Phase E evaluated the retirement. Fresh grep + counting:

 - **97 unique consuming files** import feature-domain types (ChatMessage, ChatConversation, AppSettings, ThemePreference, RecordingState, etc.) from `@/types` (or `../types`, `../../types`).
 - These consumers are NOT mostly feature UI surfaces (where direct `@/features/<x>/types` would be a clean move). They are heavily concentrated in **shared infra**: `services/storage/chatHistoryService.ts`, `services/storage/memorySystem.ts`, `services/storage/fileConfigService.ts`, `services/storage/configService.ts`, `services/conversations/{claude,storage,ownership}/*`, `services/context/contextRetrievalService.ts` (D-403-retained before T6.2 Phase C), `services/platform/{pulseCoordinator,overlayService,islandViewState}.ts`, `contexts/{LiveSessionContext,RecordingContext,SettingsContext}.tsx`, `hooks/useAudioRecorder.ts`, `utils/{theme,harnessEventUtils,tokenManager}.ts`, `pages/{TranscribePage,OverlayPage}.tsx`, `components/{GlobalShortcutHandler,overlays/IslandAtoms,overlays/FloatingIsland}.tsx`, etc.

**Decision: KEEP `types/index.ts` as a PERMANENT shared-types barrel.** Migrating the 97 consumers to direct `@/features/<x>/types` imports would create 100+ inverted-dependency smells — shared services (which have no feature home) would reach back into `features/chat/types` for `ChatConversation`, `features/settings/types` for `AppSettings`, etc. This is the D-527 rationale reaffirmed at T6.2: some shims turn out to be the correct final shape.

**Rule for consumers going forward:**
 - **Feature UI surfaces** (inside `features/<x>/`) SHOULD import feature-domain types directly from `@/features/<x>/types` (or sibling `./types`).
 - **Shared services / cross-cutting infra / generic contexts** SHOULD import from `@/types` here (the barrel) — they have no feature home, so reaching into a feature folder for a type would invert the dependency direction.
 - The 3 truly-shared cross-cutting types (`AccessTokenPayload` / `RefreshTokenPayload` / `APIResponse<T>`) stay CANONICAL in `types/index.ts` — they describe auth protocol + generic wrapper, not feature domains.

**Comment updated** in `src/types/index.ts` from "back-compat shim, retire in T6.2" → "Shared types barrel — permanent structure (D-602)" with the rationale inline. C-423 (the original T6.2 retirement catalog) is SUPERSEDED by D-602 — the shim does not retire.

**Why this is OK despite the "shim-first → retire-in-Phase-6" pattern:** the pattern (D-422 ChatContext / D-524 ModelsContext / D-528 toolCardUtils) was established for shims that (a) had 1–13 consumers (small), (b) where the consumers lived in feature UI folders (where direct imports are cleaner), and (c) where there was no inverted-dependency risk (the feature folder IS the semantic home for that code). `types/index.ts` is fundamentally different: (a) 97 consumers (large), (b) consumers are heavily shared-infra (no feature home), (c) inverted-dependency risk is high. The "shim turns out to be the permanent shape" outcome was always a possibility per the D-527 framing — D-602 confirms it for this case.

---

### D-603 — T6.2 finding: /oauth/callback check is LIVE (not dead per §1 decision #8 audit assumption) · 2026-07-06

**Context:** T6.2 Phase D audited the §1 decision-#8 "routing cleanup" tangent ("only delete the vestigial router artifacts — ProtectedRoute, the dead /oauth/callback check"). Fresh grep + code review:

 - `App.tsx:221` — `const isCallbackRoute = window.location.pathname === '/oauth/callback';`
 - `App.tsx:254-256` — `if (isCallbackRoute) return <AuthCallback />;`
 - `pages/AuthCallback.tsx` (full file, ~55 LOC) — processes the ID token from the URL hash, calls `loginWithToken`, redirects to home on success.
 - `services/auth/tauriOAuth.ts:40` — `const redirectUri = 'http://localhost:8765/oauth/callback';` (Tauri OAuth flow).
 - `services/auth/googleSDK.ts:176` — `const redirectUri = `${window.location.origin}/oauth/callback`;` (web Google OAuth flow — this is what Google's OAuth consent screen redirects the user back to).

**Finding: the `/oauth/callback` check is LIVE Google OAuth infrastructure**, NOT a "vestigial router artifact" as the §1 decision-#8 audit assumed. Google's OAuth consent screen redirects users back to `${origin}/oauth/callback`; `App.tsx:221` detects the route + `AuthCallback.tsx` processes the token. Removing this would break Google OAuth login entirely.

**Why the §1 audit was wrong:** the §1 audit was written before T3–T5 work; the OAuth integration may have landed or been verified as live AFTER the audit was authored. Per §5 "cross-check against the code, not the prose" — the codebase is the source of truth, not the prose.

**Outcome: NO deletion.** The `/oauth/callback` route check + `AuthCallback.tsx` + the OAuth flow stays as-is. Routing cleanup decision #8 is LITERALLY fully resolved: `ProtectedRoute` confirmed gone (grep + glob returned 0 matches — already deleted in prior phases); `/oauth/callback` correctly KEPT as live infra (not the "dead" check the audit assumed). `SplashPreviewPage` retained per §8 (dev-only). §8 dead-code list is fully resolved — all 4 items accounted for (3 already gone + 1 kept-as-live).

**Audit correction:** D-603 supersedes the §1 decision-#8 audit recommendation to "delete the dead /oauth/callback check." The check is not dead. (If a future audit wants to revisit the OAuth flow architecture, that's a separate scope.) This is the 3rd audit-vs-code discrepancy caught via the §5 "cross-check against the code" rule (after D-601's "adoption is only 2/5 complete" finding + T5.1's D-501 "utils/constants.ts doesn't exist" stale-plan-assumption correction).

---

### D-604 — T6.3 flip: ONLY the DS guardrails (`no-restricted-syntax`) flipped warn→error; react-hooks/react-refresh stay as warn · 2026-07-07

**Context:** T6.3's brief (02-PLAN §6) said "Flip lint guardrails to error." Read strictly, this could mean every warn-level rule → error. But the ESLint baseline at end-of-T6.4 was 560 warnings, of which only ~513 were the **design-system guardrails** (`no-restricted-syntax`: raw `<button>` 239 + raw `#hex` 228 + `text-[` 46 = 513). The remaining 47 were code-quality rules: `react-refresh/only-export-components` (23) + `react-hooks/exhaustive-deps` (22) + 2 unused eslint-disable directives.

**Decision:** Flip **only the `no-restricted-syntax` block** from `"warn"` to `"error"`. Do NOT flip:
- `react-refresh/only-export-components` — Vite HMR-only rule; warn-level is the canonical setting per the plugin's recommended config + every Vite+React repo; flipping to error would force arbitrary file-shape splits (e.g. constants colocated with components) that hurt locality without improving the DS.
- `react-hooks/exhaustive-deps` — these are real code-quality bugs (missing deps in `useEffect`/`useCallback`); the project has 22 outstanding. Flipping to error would block all builds via lint. They need per-instance judgment (real missing-dep vs. intentional omission vs. false positive) — that's component-level work, NOT guardrail work. Deferred to a focused future pass. (Some may even be intentional, like the T4.8 BUG-001 hooks-ordering precedent.)
- `@typescript-eslint/no-unused-vars` + `no-explicit-any` — already "off" per the existing "tsc handles unused" rationale; not changing.

**Why this is "self-enforcing" without blocking builds:** lint is NOT part of the build per the eslint.config.js comment ("Lint is NOT part of the build (`tsc && vite build`)"). So the 513 DS errors don't block `npm run build` or `npm run web:build` (both remain green). The gate is `npm run lint` — used by CI / pre-commit / developer self-check. Going forward, any **new** violation adds another `error` to the count above 513 — making the existing-violation baseline a **ratchet ceiling**. Future PRs that don't clean up violations cannot lower the count below 513 either, so the ratchet only goes one way: down.

**§6 alignment:** §6 completion criteria says "Both builds green." Lint is explicitly excluded per the config comment, so 513-errors-on-lint is consistent with §6.

**My interpretation of T6.3's brief:** "The system is now self-enforcing" = new code is blocked from adding new violations; existing violations remain as labeled debt for the focused future pass (T6.4f + Ad-hoc fix work) to clear.

---

### C-426 — `outline-none` rule DEFERRED pending `eslint-plugin-tailwindcss` · 2026-07-07

**Context:** T6.3's brief explicitly named "`outline-none` without focus replacement → errors." But `outline-none` is a Tailwind utility class that lives inside `className` strings — ESLint's `no-restricted-syntax` rule can match Literal/TemplateElement strings containing the substring, but it CANNOT distinguish:
- **CORRECT pattern:** `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus` (the canonical focus style in `Button.tsx:32`, `IconButton.tsx:47`, `Textarea.tsx:25`, etc. — `outline-none` here means "the `outline` shorthand is set to `2px solid transparent` for forced-colors mode per Tailwind's `outline-none` semantics", and `focus-visible:ring-*` provides the visible focus ring).
- **VIOLATION pattern:** plain `outline-none` or `focus:outline-none` WITHOUT a `focus-visible:ring-*` replacement (the actual accessibility violation — keyboard focus is invisible).

The `no-restricted-syntax` Literal/TemplateElement regex approach would flag ALL 51 instances (most of which are the correct paired pattern) — generating 51 errors of which ~50 are false positives. That's noise, not signal.

**The right tool:** `eslint-plugin-tailwindcss` has a `no-custom-classname` + `no-arbitrary-value` ruleset that understands Tailwind class composition + can match `focus:outline-none` conditionally. Adding the plugin is a separate eco-system decision (new dep + new config + new false-positive surface), deferred to a focused tooling pass post-Phase-6.

**Decision:** SKIP the `outline-none` rule in T6.3. The §6 spec line notes this as a deferred item via a code comment in `eslint.config.js`. The 51 existing instances were spot-checked and ALL pair `outline-none` (or `focus:outline-none`) with `focus-visible:ring-2 focus-visible:ring-focus` — so 0 actual violations exist today. New code that adopts the primitives (Button/IconButton/Select/Input/Textarea/etc.) inherits the correct focus-ring pattern automatically. New code that writes raw `outline-none` will not be lint-blocked, but the underlying primitives adoption (which T6.3 enforces via the raw-`<button>` rule) means most new code uses primitives that already handle focus.

**Future task:** add `eslint-plugin-tailwindcss` (or equivalent) to the lint pipeline, then enable the proper `outline-none` detection rule.

---

### D-605 — Raw-`#hex` guardrail burn-down: 228 → 23 (tokenize genuine chrome, carve-out brand/OS/data-viz, defer hue) · 2026-07-07

**Context:** A prior working session attempted to clear the 228 raw-`#hex` `no-restricted-syntax` errors (the D-604 ratchet ceiling) via a bulk PowerShell find/replace. It was **fundamentally broken** and had to be repaired:
- **Bug 1 — invalid Tailwind syntax (12 files):** it replaced hex *inside* arbitrary-value brackets, e.g. `dark:border-[#404040]` → `dark:border-[surface-border]`. That emits `border-color: surface-border` (an invalid arbitrary value), so borders/rings/hover-fills **silently rendered as nothing** across chat/composer/modal surfaces. Repaired → bracketless token class `dark:border-surface-border`.
- **Bug 2 — corrupted recharts values (`ActivityPage.tsx`):** it rewrote `"#A3A3A3"` → `"text-muted"` on values passed directly to recharts as literal colour props — despite the adjacent comment stating "recharts needs literal colour strings." Reverted to hex + wrapped in the D-401 data-viz `eslint-disable`.

**This is the concrete instance of the C-720 warning** ("a coherent design exercise, not a find/replace"). A blanket regex over `className`/value strings cannot tell a tokenizable neutral from an arbitrary-value bracket, a recharts prop, or a brand hex.

**Resolution taxonomy (applied per C-004 — resolve *each* by tokenizing OR a targeted `eslint-disable` + reason; never broaden the rule):**
1. **Tokenized (genuine neutral chrome, value-equivalent to the dark-mode token ramp):** ArtifactLabPanel, TerminalPanel wrapper (`#121212`→`surface-page`), FloatingIsland (`#0e0e0e`→`surface-page`), ChatComposer (`#383838`→`surface-active`), ConversationsDropdown (`#2A2A2A`→`surface-border`), CsvTable (`#222222`→`surface-divider`), HeroBanner "Try in chat" button (`#242424`→`surface-hover`, `#383838`→`surface-active`), ShaderWelcomePage + SplashPreviewPage floating menus (`#141414`→`surface-page`). Plus **VoicePage mic/end/speaker controls**: the dark-mode red tints (`#1c0a0a`/`#3a1515`/`#1a0808`/…) were neutralized to `surface-raised`/`surface-border` to **match the already-neutral light-mode tokens** — per locked §11.3 "error/destructive = neutral surface, not red."
2. **Carved out (`eslint-disable no-restricted-syntax` + one-line reason; no neutral-token equivalent exists):** brand logos — Google "G" (`AuthControls`, `GoogleLoginButton`), Anthropic `#CC785C` (`ClaudeCodeIcon`), MCP connector brand icons (`mcpRegistry`), app brand catalogue (`ComposioCards`, `projectApps`), folder glyph (`ProjectLauncher`); macOS traffic lights (`TitleBar`, `WindowTrafficLights`); force-graph data-viz (`MemoriesGraph`); D-408 marketing surface (`HeroBanner` examples + gradient). **All carve-outs are block-scoped** (or file-scoped only in the pure-data `projectApps.ts`) so the other guardrails (raw `<button>`, `text-[`, etc.) stay live. Verified button-error count held at 239 (no masking).
   - **Caveat learned:** JSX comment directives `{/* eslint-disable */}` are only valid as a *child of a single-root element*; placed as bare siblings at a `return (…)` root they cause a **parse error** (hit once in `ProjectLauncher.FileExplorerIcon`, fixed by moving the directive to JS-comment context around the function). For inline `style` gradients, extract to a `const` with a `// eslint-disable-next-line` (done in `HeroBanner`).

**DEFERRED — 23 hue-carrying errors need a design decision, NOT find/replace (per C-720):**
- **`VoicePage.tsx` (18)** — the animated voice-orb gradients (44–58) + waveform state colours (114–119: indigo/sky/blue/violet/red). Colour currently encodes session state; strict-neutral (locked §1) says state must be signalled by motion/weight, not hue. Neutralizing is a **redesign of a signature feature** — do it as a deliberate exercise with a visual check, not a blind swap.
- **`ChatPage.tsx` (771,785) + `EngineSelector.tsx` (62,93)** — the warm "Claude" banner/highlight tint (`#F7EFEA`/`#3A2A22`/`#E9D8CF`…). Undocumented: is this an intentional Claude brand-warmth (→ carve-out) or strict-neutral drift (→ neutralize)? **Needs owner call.**
- **`ShaderWelcomePage.tsx` (228)** — the indigo→blue welcome-background gradient (same as HeroBanner's D-408 gradient, but on the welcome page, which isn't the extensions "Apps" surface D-408 covers). Likely a marketing carve-out; confirm.

**Verified:** `tsc --noEmit` clean; ESLint `#hex` errors 228 → 23 (all 23 are the deferred hue set above); raw-`<button>` errors unchanged at 239 (no guardrail masked); 0 parse errors; `npm run build` (desktop) + `npm run web:build` both green. **Note:** the working tree also carries unrelated in-flight work (an `infrastructure/platform` path refactor, `MermaidDiagram` dedup, `src-tauri` changes) — not part of this burn-down.

---

## D-606 — First-pass audit + closeout of the D-605 deferred set (2026-07-07)

A dedicated find-pass across `STUDIO/src` before the next-generation reorg (see the
**superseded-target** finding below). It also resolved every item D-605 deferred.

### D-605 deferred set — now resolved (hex errors 23 → 0)
- **VoicePage** — the hue-carrying "orb" palettes lived in a **dead duplicate** `src/pages/VoicePage.tsx`, NOT the live file. The live `features/voice/VoicePage.tsx` was already neutral (D-418 accurate). Per product direction (2026-07-07: "no voice orb, make it as simple as possible, redesign later") the live page was **stripped to a plain neutral placeholder** — the 4 animated background layers (gradient/presence/dot-grid/floor-glow) + the `isDark`/GRADIENT/PRESENCE/DRIFT maps removed; controls, transcript, timer, neutral state-dot/Warning glyph, and all DS primitives (IconButton/Icon/focus-rings/aria) kept. The dead `pages/VoicePage.tsx` was deleted (see below).
- **ChatPage (771,785) + EngineSelector (62,93)** — decided: **intentional Claude-engine brand-warm accent** (Anthropic terracotta family, matches `ClaudeCodeIcon` `#CC785C`). Kept as-is per "chat page is good"; extracted to named consts (`CLAUDE_TRANSCRIPT_BANNER`/`CLAUDE_FORK_BUTTON`/`CLAUDE_ACCENT`) behind a block `eslint-disable` + §17 brand reason. No visual change.
- **ShaderWelcomePage (228)** — decided: **keep** (it is the not-logged-in welcome screen; the shader-vs-image direction is still open). Gradient extracted to `WELCOME_HERO_GRADIENT` const behind a D-408 marketing carve-out. No visual change.

**Verified:** `#hex` errors 23 → **0**; raw-`<button>` errors unchanged at **239** (no masking); `tsc` clean; both builds green.

### Audit findings
1. **Dead duplicate leftovers from the Phase-4 "move" (CRITICAL — docs said dead code was purged in T6.2, but it wasn't).** The Phase-4 migration COPIED rather than MOVED several trees, leaving byte-for-byte orphans that ESLint still lints and that are easy to edit by mistake. Deleted this pass: `pages/VoicePage.tsx`, `pages/TranscribePage.tsx`, `utils/liveSessionSounds.ts`, `services/fasterWhisper/` (8 files), `components/ui/artifact/` (CodeView, DocumentView), `components/ui/content/SearchResultContent.tsx`. Canonical copies live under `features/{voice,transcription,artifacts}/`.
   - **BUG fixed:** `services/fasterWhisper/` was NOT fully dead — the **live** `services/ai/mediaService.ts` and `services/ai/modelService.ts` imported the old copy via a **relative** `../fasterWhisper` (invisible to a path-string grep). Repointed both to `@/features/transcription/services/fasterWhisper`. **Lesson: a filename/`@/`-path grep misses relative imports; always `tsc` after a delete.**
2. **Superseded target architecture (governance risk for the reorg).** `Frontend Organise.md` (owner's Documents) defines a NEW structure — `systems/` + `infrastructure/` (split from `services/`), `shared/` (ex-`components/`+`hooks/`+`utils/`+`types/`), `shell/`, `design/` — that supersedes the `02-PLAN §2` target the completed Phases 4–6 built toward. The lone untracked `src/infrastructure/platform/studioPaths.ts` is its first step. **Risk:** the revamp docs claim self-sufficiency ("any LLM reads these and continues correctly"), but the new target is unreferenced by the doc set — a cold-start would rebuild the OLD structure. **Action needed:** fold `Frontend Organise.md` into the doc set (or add a pointer) before the reorg begins.
3. **Stale phase marker (minor doc bug).** `02-PLAN.md` line 252 header still shows `Phase 3 … ◐` though the §9 dashboard, the Phase-4 gate, and completed Phases 4–6 all confirm Phase 3 `☑`. Flip the header.
