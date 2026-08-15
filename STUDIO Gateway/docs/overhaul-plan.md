# Studio Gateway — Overhaul Plan (Studio-fidelity)

> Gateway is a separate product now, but must be pixel-identical to Studio so it can later become Studio's native gateway. This plan makes that merge trivial.

## 0. Why overhaul vs patch
Current `STUDIO Gateway/UI` ships bespoke tokens (`#242424/#f5f5f3`), standalone shell (`246px/70px/42px`, custom `radius-lg:15px`, `G` mark), and minimal primitives. Studio's language is `oklch monochrome + surface ordering + hairline + blur + concentric radii + Inter/Newsreader/Instrument Serif`. Patching would leave permanent fork. Overhaul replaces the language wholesale and keeps the file tree merge-ready.

## 1. Studio invariants to preserve (no drift)
1. One source of truth per scale: radius/surface/blur/motion declared once in `index.css`/`shellConfig`/`motion.ts`.
2. Monochrome enforced: all `oklch` chroma 0 except `--destructive` + traffic-light hex.
3. Depth = `sunken < surface < raised` + `hairline` + `studio-blur`; never drop-shadow alone.
4. Concentric radii: inner = outer - padding (`windowRadius 20 - framePadding 8 = panelRadius 12`).
Plus: Inter for chrome, Newsreader 13px for prose, Instrument Serif only for display, motion caps 300ms, spring for moved-because-you-moved / duration+ease for appear/vanish, `cn()` via `twMerge`, Phosphor via barrel only, weight `regular` only.

## 2. What Pass 1 proved
- **UI already live-wired:** dashboard/requests/models/tokens/health all hit real `gatewayApi.*` — no widget mocks. Empty states honest.
- **Real bugs found live:** `D1_ERROR 29 values for 28 columns` (catalog upsert 28 cols vs 29 binds), `too many SQL variables at offset 283` (batch 100 × 28 bind vars = 2800 > SQLite 999). Both fixed live and verified (`6321 models`, `185 providers`).
- **Drift still open:** bespoke `UI/src/index.css` (hardcoded hex, `246px` shell), `App.tsx` sidebar `Studio workspace/Production` faux data, `Icon.tsx` not Studio barrel, `useState<Section>` nav without `NavigationProvider`, pagination client-only over 500, `time_to_first_token_ms` always null, `fallback_used` hardcoded 0, `scopes` stored but never enforced, CORS `UI_ORIGIN` missing in prod would block Pages→Worker, discovery static fixture masquerades as live.
- Proxy just fixed: `vite.config.ts` now `gateway:8787` + `/v1` (both .ts/.js).

## 3. File map — make Gateway merge-ready

### 3.1 Foundation (copy Studio verbatim, then adapt imports)
```
UI/src/index.css                ← replace with STUDIO/src/index.css (oklch, surface, blur, motion, prose, scrollbar, reduced-motion)
UI/src/lib/utils.ts             ← STUDIO/src/lib/utils.ts (cn)
UI/src/app/motion.ts            ← STUDIO/src/app/motion.ts
UI/src/app/shell/shellConfig.ts ← STUDIO/src/app/shell/shellConfig.ts
UI/src/app/theme/theme.ts       ← STUDIO/src/app/theme/theme.ts
UI/src/app/theme/ThemeProvider.tsx
UI/src/app/shell/ChromeProvider.tsx
UI/src/app/shell/useShellShortcuts.ts
UI/src/app/useMountTransition.ts
UI/src/app/navigation/*         ← optional: NavigationProvider/views adapted to Gateway sections
UI/components/ui/button.tsx     ← STUDIO Base-UI + CVA
UI/components/ui/popover.tsx
UI/components/ui/tooltip.tsx
UI/components/ui/separator.tsx
UI/components/ui/segmented-control.tsx
UI/components/icons/index.tsx   ← Phosphor barrel (single import surface, regular only)
UI/components/icons/SidebarOutline.tsx
UI/components/brand/StudioMark.tsx
UI/components.json              ← tailwind baseColor neutral, style base-nova
```
Keep `vite.config.ts` `@` alias and `tw-animate-css` + `shadcn/tailwind.css` import order.

### 3.2 Shell (reuse Studio composition)
```
UI/src/app/shell/AppShell.tsx        → GatewayAppShell (same outer: bg-surface-sunken, windowRadius 20, framePadding 8, panelGap 8, panelRadius 12, titleBar 40, sidebar 256/context 296, handle hit 10)
UI/src/app/shell/chrome/TitleBar.tsx
UI/src/app/shell/chrome/WindowTrafficLights.tsx (no-op in browser)
UI/src/app/shell/chrome/PanelToggle.tsx
UI/src/app/shell/chrome/ResizeHandle.tsx
UI/src/app/shell/chrome/SearchTrigger.tsx (→ gateway search)
UI/src/app/shell/sidebar/StudioSidebar.tsx → GatewaySidebar (same slide-not-reflow, SPRING_PANEL)
UI/src/app/shell/sidebar/SidebarProjects.tsx → SidebarNav (ROW h-7, active bg-muted)
UI/src/app/shell/sidebar/SidebarFooter.tsx → Account/Theme footer
UI/src/app/shell/panels/ContextPanel.tsx   → optional detail rail
```

### 3.3 Pages — redesign on Studio surfaces (keep logic, replace skin)
```
UI/src/pages/DashboardPage.tsx  → Studio surfaces: Surface/SectionHeading/Eyebrow, metric cards bg-surface-raised border-hairline, blur bars, consistent 13px/11px type
UI/src/pages/RequestsPage.tsx   → same table semantics, humanized finish reason, provider/model icons via barrel, real pagination/filters server-driven
UI/src/pages/ModelsPage.tsx     → catalog uses Studio cards (rounded-xl border bg-surface-raised, group hover), drag-drop draft stays but on Studio primitives
UI/src/pages/ProvidersPage.tsx  → provider cards on Studio panel radius, credential input via Popover, sync via Button
UI/src/pages/TokensPage.tsx     → key list with Popover/SegmentedControl patterns
UI/src/pages/HealthPage.tsx     → diagnostics as Studio prose + separators
UI/src/App.tsx                  → compose ThemeProvider → NavigationProvider → ChromeProvider → AppShell (no faux studio-workspace/Administrator constants)
```

### 3.4 Backend closure (separate from UI, same pass)
- Keep D1 fix: 28 placeholders, `D1_QUERY_BATCH_SIZE 25`, `D1_STATEMENT_BATCH_SIZE 25` (already live).
- Wrap `admin/models/bulk` + `PATCH /providers/:id/models` in `DB.batch` transaction (atomic, no partial 409).
- Add partial unique index or guard for duplicate `model_id WHERE exposed=1`.
- Decide `scopes`: either enforce in `gatewayAuth.ts` or remove column (currently dead).
- Keep telemetry as normalized DB row; tee streaming body safely instead of `clone().text()` buffering.
- Backfill or document `catalog_source NULL` → "Unknown" handling.

## 4. Sequence

**Pass 2A — Foundations (no visual change yet):**
1. Replace `UI/src/index.css`, add `lib/utils`, `app/motion`, `app/shell/shellConfig`, `app/theme`.
2. Add `components.json`, install missing deps (`@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `framer-motion` already present in STUDIO), wire `@` alias.
3. Verify `pnpm check` + `pnpm build` still pass (shell not yet swapped).

**Pass 2B — Shell swap:**
4. Add `icons` barrel + `StudioMark` + `ui/*` primitives verbatim.
5. Add `ChromeProvider`/`NavigationProvider`/`ThemeProvider`/`useMountTransition`.
6. Replace `App.tsx` shell with `GatewayAppShell` (same geometry, Gateway nav: Overview/Requests/Models/Providers/Tokens/Health/Routing/Settings). Keep existing session gate but switch to ThemeProvider-driven `dark` toggle.

**Pass 2C — Pages on Studio primitives:**
7. Rewrite each page's markup to use `Surface` (`border bg-surface rounded-lg`), `Eyebrow`, `Button`, `Popover`, `Tooltip`, `Separator`, `SegmentedControl` — no new token values.
8. Fix pagination: `GET /admin/models?limit=&offset=&category=&provider=&search=` driven server-side, not client slice; keep `Load more` but backed by `total`.
9. Fix `time_to_first_token_ms` display honestly as "Not reported" until streaming tee lands; surface `fallback_used` once real.

**Pass 3 — Sweep:**
10. `pnpm check`, `pnpm test`, `pnpm lint`, `pnpm build` (both projects).
11. Verify live: `wrangler dev` + `vite --host` + `curl` health/ready/admin/models + Tailnet `100.112.4.47:4173` + `100.112.4.47:8787/health`.
12. Record remaining gaps (OTel exporter, user model, fallback execution) as explicit "next" — no hidden half-done.

## 5. Non-goals this pass
- No new routing graph / classifier / RTK / Headroom. Architecture will be shaped so they fit without rebuilding the shell.
- No OTel exporter — seam stays no-op, normalized analytics is product API.
- No arbitrary provider creation UI beyond existing 22 + catalog-discovered 185 (disabled by default, explicit enable).

## 6. Merge readiness check
After Pass 2, `diff STUDIO/src/index.css UI/src/index.css` should be empty or comment-only; same for `motion.ts`, `shellConfig.ts`, `components/ui/*`, `icons/*`. Gateway pages should import only via `@/lib/utils` and `@/components/*`, never invent values.

## 7. Verification gates
- Type: `pnpm -C "STUDIO Gateway" check`, `pnpm -C "STUDIO Gateway/UI" build`
- Tests: `pnpm -C "STUDIO Gateway" test` (131 passed baseline)
- Runtime: `pnpm db:migrate --local` clean, `POST /admin/catalog/sync` 6321 no errors, `/admin/providers` 22 + credential_configured, `/admin/requests` detail join, `curl -i http://gateway:8787` vs `http://100.112.4.47:4173` both 200
