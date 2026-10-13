# Flue and Pi upgrade

Registry checked on 2026-10-14. Latest stable Flue packages: 2.3.0. Latest Pi AI and Pi agent core: 1.2.0.

Before: Flue runtime, SDK, Vite and OpenTelemetry 2.0.3; Pi AI 0.84.4 and agent core 0.83.0. The manifest's Pi 1.2.0 request was overridden by the workspace's 0.84.x constraint.

Changes:

- Harness package manifest, workspace configuration and lockfile: pin the four Flue packages to 2.3.0 and both Pi packages to 1.2.0. Align the existing Hono dependency with the runtime's compatible version.
- Runtime and Pi patch files: rebase onto the published releases and remove obsolete patch files. Preserve retry budgets and diagnostics, compaction prompts and markers, manual compaction, delegate scope context, queued follow-ups, steering, atomic queue controls and unknown provider stop reasons.
- Language runtime and catalog: preserve old Azure selections, credentials and catalog-backed connection rows through an alias; no user data or keychain entries are rewritten.
- Scripted model adapter: derive the current prompt and tool declarations from Pi's transcript system messages. Pi 1.x no longer supplies the old top-level fields to provider implementations; reading them made the delegate tests report zero tools and lose their prompt identity.
- Prompt tracing: replay transcript prompt/tool updates and exclude system entries from the message subtotal, preserving the diagnostic counts without writing prompt or message contents.
- Provider curation: keep Azure under its new id and record new vendors as disabled, preserving the existing enabled vendor list.
- Queue-control fallback: use the existing classified storage error contract when its runtime port is unavailable.
- Retry policy comment: point to the current patch filename.
- Agent-scope assertion: match the existing guarded attachment-copy expression rather than its obsolete statement form. The assertion still requires the host persistence call and now also requires its user-delivery guard.

Validation:

- The Azure compatibility test failed against the upgraded unadapted runtime because the stored selection no longer resolved, then passed after adding the alias. It also checks the existing credential and catalog lookup.
- Removing the Pi unknown-stop-reason fallback made the regression test fail on MALFORMED_RESPONSE. Restored afterward.
- Focused provider, catalog, architecture and compaction checks passed after compatibility fixes.
- The first full check exposed four delegation failures caused by the scripted adapter's obsolete context reads. Stopped that run, updated the adapter using Pi's own transcript replay helpers, and retained the existing assertions.
- All eight delegation integration tests passed after the adapter fix.
- The transcript-aware prompt-trace test failed before its compatibility fix (zero tools and duplicated system entries), then passed. It checks tool removal/addition and ensures private content does not enter the log.
- Removing the host attachment-copy call made the updated agent-scope assertion fail. Restored afterward; all 11 agent-scope checks passed.
- The earlier full harness check had 2,369 passing tests, two failures (an obsolete attachment-call assertion and an intermittent recovery timeout), and 28 skipped tests. The pre-upgrade client suite had 1,412 passing tests.
- Full harness check: type checking, lint, build, and 2,374 tests passed; 28 tests skipped across two skipped files. All 176 active test files passed. The serial run took 1,246.93 seconds, substantially longer than the house rules' two-minute estimate.
- Client check: type checking, lint, and all 1,412 tests across 149 files passed. The root pnpm check completed successfully with both suites run sequentially.
- Registry versions were rechecked after validation: Flue runtime, SDK, Vite and OpenTelemetry are still latest at 2.3.0; Pi AI and agent core are still latest at 1.2.0.

No additional product rules or direct dependencies were introduced. External provider requests use local test servers; no live account smoke test has been performed.

Publication includes the existing pending Studio improvements alongside the conversation controls and dependency upgrades. All of these changes were present during the successful full check. Publication uses codex/conversation-steering; no commit or merge is made on main.
