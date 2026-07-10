# Frontend Loop Engineer - Open Questions

Status: First-pass questions recorded on 2026-07-10.

1. Should the raw-button ESLint rule be changed to ignore all
   `src/ui/primitives/*`, or should each primitive receive a local rule disable
   with a documented reason?
2. Which raw color carve-outs are product-approved: Claude accent, third-party
   brand icons, terminal ANSI colors, Mermaid/Recharts/Three colors, extension
   app colors?
3. Is `src/lib/api.ts` intended to become `core/network`, or should it stay as a
   shared browser API helper used by features?
4. Should desktop-only services under features, such as Faster Whisper and local
   conversation stores, move under `runtime`, or remain feature-owned service
   adapters?
5. Is the web build expected to be production-grade now, or is desktop the
   primary target and web bundle size a lower-priority concern?
6. Should `daemon/` be treated as frontend-adjacent runtime code for this task,
   or out of frontend scope unless directly imported?
7. Is `@vscode/ripgrep` used by scripts or local runtime behavior, or can it be
   marked unused after a dedicated scripts/package audit?
8. Are alert replacements allowed to change UX from blocking browser alert to
   non-blocking toast/inline error?
9. Should `runtime/ui/*` remain under `runtime`, or should React-specific runtime
   cards move to `ui/runtime` or `features/chat/runtime-ui`?
