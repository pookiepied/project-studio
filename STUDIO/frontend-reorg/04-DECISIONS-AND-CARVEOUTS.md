# 04 — Decisions & Carve-outs (salvaged, load-bearing)

Distilled from `frontend-revamp/03-DECISIONS-AND-CAVEATS.md`. Only what's still
true and load-bearing is kept here. This is the **legend** for `eslint-disable`
and carve-out markers already sitting in the shipped code — do not lose it when
the revamp folder is deleted.

## D-401 — Strict-neutral palette (locked, user-confirmed)

No hue, ever, for UI. State is signalled by **icon + weight + neutral surface**,
never color. Applies to ALL status/health surfaces. Accent color is "a bug to fix
on sight." The `no-restricted-syntax` lint rule enforces this (see D-604).

## Carve-out registry (legitimate exceptions to D-401 / the hex rule)

Each is wrapped in code with `eslint-disable no-restricted-syntax` + a reason.
These are **intentional**, not debt:

1. **§17 brand-logo multi-color marks** — external brand logos may keep brand
   color (not UI accent): Google, Anthropic (`ClaudeCodeIcon` `#CC785C`), MCP,
   Browser brand blue, etc. SVG paths using `currentColor`/brand hex.
2. **macOS OS chrome** — traffic-light window controls.
3. **Data-viz literal colors** — libraries that need literal color strings, not
   CSS classes: **recharts**, **THREE/force-graph WebGL**, **mermaid** canvases,
   **xterm ANSI** palette.
4. **D-408 marketing surfaces** — Apps hero / connect-modal gradients + app brand
   colors (extensions). Intentional carve-out, user-confirmed 2026-06-29.
5. **C-409 voice decorative rgba() gradients** — neutral, hue-free
   `rgba(0,0,0,x)` / `rgba(255,255,255,x)` strings in composited gradients where a
   CSS var can't be substituted (alpha layering). Hue-free; accepted exception.
   (Note: VoicePage was later stripped to a neutral placeholder — see below — so
   most of these no longer render, but the rationale stands for any gradient work.)
6. **Claude-engine brand-warm accent** — `EngineSelector` `CLAUDE_ACCENT` and the
   `ChatPage` "Claude Code owns this transcript" banner/fork button. Anthropic
   terracotta family (matches `#CC785C`); no neutral-token equivalent. Kept with
   carve-out per D-605/D-606.

## D-604 — Lint enforcement state (2026-07-07)

- **`no-restricted-syntax` (the DS hex/color guardrail) is ERROR.** Raw hex in
  className/style/TemplateElement fails the build.
- `react-hooks` / `react-refresh` rules stay **warn**.
- **Raw `<button>` debt (~239) is grandfathered** — intentional, not in scope.
- Hex→token burn-down is **complete**: 0 `no-restricted-syntax` hex errors.

## VoicePage — deliberate neutral placeholder (2026-07-07)

Stripped to a plain neutral surface (no orb, no animated gradient) per owner
direction "make it as simple as possible, redesign later." Live file:
`features/voice/VoicePage.tsx`. **Do not restore the animated-gradient design.**

## Deferred design debt — the "later pass" (was Phase-6 T6.4)

~70+ pre-existing accent-color instances across ~20 files, carried verbatim during
Phase-4 moves ("make it simple — no redesign"). These need a **coordinated neutral
redesign per §11.3 (icon + weight + neutral surface), NOT find/replace.** Do this
in the post-reorg dead-code/consistency pass. The consequential clusters:

- **`features/chat/tools/HarnessStepCard.tsx`** (~8) — the COMPLETE tool-step
  status pill palette (success/error/warning/running). Treat as ONE design
  exercise (redesign the pill-state system), not 8 edits. Largest single item.
- **`features/markdown/` + `features/artifacts/`** (~30) — "Copied"/"Opened"
  success states (`text-green-500` checks), formula/render error banners
  (`text-amber-500`), JSON syntax palette, ArtifactRenderer 4-status pills.
  The largest debt cluster; needs a coherent monochrome-syntax approach.
- **`features/workspace/`** (~16) — status colors ("running" `text-blue-400` →
  neutral SpinnerGap; "failed" `text-red-500` → WarningCircle + neutral
  destructive; delete-button hovers → `IconButton variant="destructive"`).

**Governance:** any hex work here is a coherent design exercise (C-720), decided
per item — never a mechanical find/replace.
