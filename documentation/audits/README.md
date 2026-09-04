# Audits

Read-only passes over a product, newest last. An audit records what was true on
its date; it is not amended afterwards, because a record that gets edited stops
being evidence of anything.

Where an audit's findings were acted on, the audit says so at the top rather
than in a separate status file that could drift away from it.

| Date | Scope | File |
|---|---|---|
| 2026-08-18 | Studio Harness wellness pass, on `remove/cloudflare-gateway` | [2026-08-18-harness-wellness.md](2026-08-18-harness-wellness.md) |
| 2026-08-18 | Studio Harness, read-only pass over `src/` and `tests/` | [2026-08-18-harness-wellness-readonly.md](2026-08-18-harness-wellness-readonly.md) |
| 2026-08-22 | Studio Client frontend | [2026-08-22-frontend.md](2026-08-22-frontend.md) |
| 2026-09-01 | Backend security and correctness; all twelve findings resolved | [2026-09-01-backend-security.md](2026-09-01-backend-security.md) |
| 2026-09-03 | Studio Client, complete frontend forensic pass | [2026-09-03-frontend-forensic.md](2026-09-03-frontend-forensic.md) |

The two 2026-08-18 files are different documents that happened to share a
filename in two places. They are both kept: one was run against the branch, the
other read-only against the tree.

These files lived under a second `docs/` root until 2026-09-05, which
contradicted this project's own rule that there is one documentation root. They
were moved here and `docs/` was removed.
