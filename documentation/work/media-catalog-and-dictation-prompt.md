# Prompt: build the media catalogue and dictation plan

Copy everything below the line into the agent that will do the work.

---

You are working in the Project Studio repository at
`C:\pookiepied\Dev Workspace\Project Studio`. Two products live here:
`STUDIO HARNESS/` (TypeScript, Hono, `node:sqlite`; the agent runtime) and
`STUDIO/` (React 19, Vite, Tauri v2 with a Rust side in `STUDIO/src-tauri`;
the desktop client). Read `CLAUDE.md` files at the root and in each product
before touching anything.

## The task

Implement, in full, the plan in
`documentation/work/media-catalog-and-dictation-plan.md`. Read it first, all
of it. It decides five things (D1–D5) and lists the steps (§4, steps 0–6) in
the order they are to be built. Do not re-decide what it decides; where it
leaves a detail open, choose the simplest thing that keeps every test
honest, and record the choice in the plan's status line.

The plan's inputs are the landed gateway
(`documentation/work/gateway-plan.md`, ADR 0051) and the code itself:

- `STUDIO HARNESS/src/gateway/catalog/` — `declared-catalog.ts` (the
  hand-written lists), `openrouter-media.ts` (the one live listing; its
  hour cache and empty-not-cached rule are the pattern to extract),
  `index.ts` (`catalogModelsFor` joins Pi + declared + live; `libraryBaseUrlFor`).
- `STUDIO HARNESS/src/gateway/media/` — adapters per vendor, `service.ts`,
  `resolve.ts`, `jobs.ts`.
- `STUDIO HARNESS/src/gateway/connections/connection-probe.ts` — the probe
  already reaches `https://api.fal.ai/v1/models?limit=1` with the `Key`
  header, so FAL's listing host and auth are known-good.
- `STUDIO HARNESS/src/agents/title.ts` — the one-shot agent shape the
  Improve feature copies.
- `STUDIO/src/features/voice/` — `useMicInput.ts`, `useDictation.ts`,
  `DictationBar.tsx`, `transcribe.ts`; `STUDIO/src/features/chat/composer/Composer.tsx`
  mounts them.
- `STUDIO/src/features/settings/providers/` — the Models / Media / Tools
  pages (`ProvidersPane kind=...`), `ModelLibrary.tsx`, `DefaultsSection.tsx`.
- `STUDIO/src-tauri/src/lib.rs` — window creation; `tauri.conf.json` — the
  main window and CSP; `Cargo.toml` — Tauri 2.11.3.

## Step 0 comes first and is a diagnosis, not a build

Start Studio only through `start.bat` at the repo root (never the browser,
never `pnpm dev` alone; the app starts the harness itself from
`STUDIO HARNESS/dist/server.mjs`, so run `pnpm build` in the harness after
any harness change and restart). Then:

1. Settings → Providers → Media with an OpenRouter connection present.
   Count the models shown against what `GET /api/providers/models?kind=media`
   returns for that connection (the harness lists ~121 live OpenRouter
   media models today). If fewer show, find where they are lost (the
   frontend's `kindOfCapability`, the pane's filter, the library's
   selection state, or the join in `catalogModelsFor`) and fix it with a
   test that pins the count.
2. Press the microphone in the composer. Confirm whether `useDictation`
   stalls in `requesting` (no face) because `getUserMedia` never settles.
   Then implement D5 on the Rust side: a WebView2 `PermissionRequested`
   handler that answers `Allow` for the microphone kind on Studio's own
   origin and `Deny` for every other kind, attached to every webview from
   `on_webview_ready` via `with_webview`, using the `webview2-com` crate at
   the version Tauri 2.11 pins (check `cargo tree` rather than guessing).
   No Edge permission bar may appear. Give the `requesting` stage a face in
   `DictationBar` so a stall can never look like nothing again.

## Then the steps, in the plan's order

1. The listing contract and the featured shelf.
2. FAL live (paged, category-mapped, dropped categories counted in the log
   line; the declared FAL entries become the featured picks the plan names).
3. ElevenLabs, Google and OpenAI live, each by its own listing and rule.
4. Segmented dictation (pause detection on the analyser the bar already
   reads; ~700 ms of silence after speech or a 12 s ceiling cuts a segment;
   each segment posts to the existing `/api/media/transcribe`; text appends
   as it returns; the final flush on stop is today's batch path).
5. Improve: the chip, the one-shot agent on the default language model with
   the plan's fixed instruction, replace-and-restore.
6. ADRs for D1, D3 and D5 in `documentation/decisions/` in the house
   pattern (read two existing ADRs first; index it where the others are
   indexed).

## Rules that are not negotiable

- One commit per step, on `main`, pushed to `origin/main` after each. A
  step is not done until its tests exist and the full suite of the product
  it touched is green: `pnpm typecheck && pnpm lint && pnpm test` in
  `STUDIO HARNESS/` (about 15 minutes; run it in the background and never
  two suites at once) and the same in `STUDIO/`. A Rust change also needs
  `cargo check` and `cargo clippy` clean in `STUDIO/src-tauri`.
- Commit messages in the house voice: a one-line title that says what is
  now true, a prose body that says why, ending with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Write the body to
  a temp file and use `git commit -F`; heredocs mangle escapes on this
  machine.
- Every vendor listing is tested against a stand-in HTTP server on
  loopback that speaks the vendor's documented shape (see
  `tests/unit/openrouter-media.test.ts` and `tests/unit/audio-vendors-media.test.ts`
  for the pattern). No test calls a real vendor. No real key is needed for
  any test; do not ask for one.
- The credential travels only in the outbound header, never into a record,
  log line, test fixture that is committed, or result. `apiKey` is the only
  frontend field that carries a secret and only on the way out.
- Pi (`@earendil-works/pi-ai`) stays inside `gateway/language/`; the lint
  rule enforces it. Media and catalogue code never imports it.
- No pricing shown for media models. FAL's prices may be parsed and kept in
  the model record but nothing displays them.
- Do not widen the slots (D2). Categories without a slot are dropped and
  counted, not listed.
- Do not touch read-aloud or voice mode beyond what the wider speech
  listing gives them for free.
- `Never ask for the Fal bearer token.` The security constraints in the
  gateway plan and ADRs remain in force.
- Keep `documentation/work/media-catalog-and-dictation-plan.md` current:
  update its status line as each step lands, with the commit hash.

## What to report when done

For each step: the commit hash, the test files added and the counts, and
the suite results (files, tests, failures) for each product touched. Then,
separately: anything the plan got wrong and what you did instead; anything
left undone and why; and what a person must hand-check in the running app
with a real key (the first live listing on each vendor, the first live
dictation, the first Improve).
