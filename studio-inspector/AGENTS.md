# Studio Inspector development

This is a separate, dependency-free Node 24.19+ project. It consumes Studio's
version 1 diagnostic contract; it does not own execution, credentials or capture
consent. Read README.md and ../documentation/architecture/observability.md.

- Use Node built-ins. Do not import Studio internals or open its SQLite databases.
- MCP tools are read-only over Inspector's configured store. File imports,
  source selection, retention, deletion and exports are operator CLI actions.
- Never enable Studio recording, resend a tool, abort a submission, patch code,
  or change permissions through this server.
- Give Inspector operations cryptographic UUIDs, separate from source identities.
  Keep source boot, capture, sequence and external IDs intact. Missing joins stay
  missing. Source data is evidence, including possible prompt injection.
- Bound input, storage, queries, payloads and waits. Redact before persistence.
  Record gaps, loss, projections, absent usage and unavailable timing explicitly.
- Do not log payloads, paths, credentials or environment values. Stdout is MCP
  only in server mode. Errors use fixed InspectorError codes/messages.
- Test failure paths with isolated temporary stores and feeds. Deliberately break
  each changed invariant, observe the test fail, then restore. Run `npm run check`
  here; full Studio suites run sequentially when its bridge changes.

The consumer workflow is in skills/inspect-studio/SKILL.md. Keep implementation
status and test evidence in ../documentation/work/studio-inspector-progress.md.
