# Studio Inspector V0

## Scope

Build an independent local collector/store, historical import, read-only MCP/CLI,
portable instructions/package and an explicit opt-in feed from normal Studio
desktop sessions. No cloud telemetry, automatic patching, provider proxy,
hidden reasoning, or inspection of Codex/Claude's own internals is implied.
Work branch: `codex/studio-inspector`. Preserve other work.

## Issue register

| Issue | Category | Work / proof required |
| --- | --- | --- |
| #1 | Implemented | Default-off desktop sharing, fixed admitted GETs, private owner credential, bounded atomic files, clear/epoch/generation fences. Native fixtures cover admission, export, consent and cross-process reads; client fixture proves sharing does not enable capture. |
| #2 | Implemented | Independent bounded SQLite store, redaction, separate content opt-in, deduplication, rollback, durable live watermarks, orphan cleanup and receipt-age retention. |
| #3 | Implemented | Actual diagnostic/native/conversation contracts and Inspector archives; preserved bounded raw records, source clocks, provenance, explicit unsupported formats and omissions. |
| #4 | Implemented | Nine read-only MCP tools: status, sessions, overview, timeline, operation, source timeline, raw event, payload and watch. Separate operator CLI import/export/erase. |
| #5 | Implemented | README, AGENTS/CLAUDE instructions, consumer skill, portable plugin manifests, local Codex/Claude registration and explicit optional web tunnel guidance. No implicit installation. |
| #6 | Verified in fixtures | Regression/mutation proofs and full client/native gates passed, including the retained-window fix. Actual user-session activation remains a manual acceptance step. |

## Decisions

Normal desktop sessions are the first live source, as requested. A local,
user-enabled export feed avoids inventing a new permission system or exposing
Studio's private host credential. Collector persistence is a separate operator
choice. MCP consumers receive only the configured Inspector store, never a
generic file/network/SQL interface. No source or account is connected implicitly.
Use Node built-ins and the existing Rust/client dependencies.

## Execution order

Implement core ingestion/storage and queries, then desktop feed and consent UI,
then MCP/CLI/package. Exercise the complete contract with isolated fixtures,
review/fix, mutation-verify, and run relevant checks sequentially. Keep source
fixed during final checks. Do not claim a local plugin is installed in a host or
a real user recording has been inspected until that has actually been verified.

## Verification

Existing Studio baseline before this branch: harness 2,448 passed / 28 skipped;
client 1,537 passed; native 145 passed and Clippy with warnings denied. These
are earlier complete-gate results, not a newly rerun baseline. Harness source
is unchanged in this branch; its full suite was not rerun. Original design:
[Inspector plan](studio-inspector-plan.md). Durable source contract:
[observability](../architecture/observability.md).

The full client gate passed typechecks, lint and 169 files / 1,538 tests
(`studio-inspector-client-full.log`). The first full native gate passed 149 tests
plus binary/doc targets; Clippy passed `--all-targets -- -D warnings`
(`studio-inspector-native-full.log`, `studio-inspector-clippy.log`). A focused
native repeat passed all four bridge tests after the external query changes.

The Node suite currently passes 24 tests. It exercises real stdio child
processes, live cursor updates, missing-store discovery, native/source-only
evidence, historical records, Unicode paging, cross-session references,
operator CLI export/import/erase, size limits, stale/silent collectors,
redaction, content gates, rollback, replay, retention and leaf usage.
The native fixture starts a real loopback diagnostic server, validates its GET
credential/request-ID headers, performs the actual Rust snapshot read and
atomic publication, then invokes the Node collector and reads retained evidence
through an actual stdio MCP child. All state is isolated under temporary paths.

Deliberate mutations were restored after observing these failures:

| Broken rule | Failing proof |
| --- | --- |
| MCP SQLite connection made writable | Read-only test's direct DELETE was accepted. |
| Collector content opt-in bypassed | Payload was retained without the operator flag. |
| Live watermark skip removed | Evicted snapshot history was inserted again. |
| Payload/session ownership join removed | Another session could read the payload. |
| Redaction bypassed | Credential/environment examples reached retained payloads. |
| Rollback replaced by commit | Failed batch left partial evidence. |
| Turn deduplication keyed by event instead | Replay inflated leaf usage. |
| Tool IDs treated as globally unique | Reused provider call ID across turns collapsed two calls. |
| Stale-file guard bypassed | Expired feed was ingested. |
| Stdio size limit raised | A valid but oversized JSON ping was accepted. |
| Native default-off/revision guard weakened | Disabled publisher created a feed. |
| Final capture-epoch check removed | Changed capture was exported as one snapshot. |

Evidence logs are under the system temporary directory, with prefix
`studio-inspector-mutations-`, plus `studio-inspector-mutation-frame.log` and
`studio-inspector-native-mutation2.log`. An initial frame mutation survived
because the fixture used invalid JSON; changing it to oversized valid JSON made
the size-specific test meaningful. An initial native mutation was restored
before compilation completed and proved nothing; the repeated mutation ran to
completion and failed the two intended tests. No temporary mutation remains.

Self-review found and corrected inaccessible source-only native evidence,
unreported projection omissions, stale collector status, cross-turn tool ID
collisions, partial writes on failed imports, and the stopped-recording export
rule. Stopping recording preserves evidence by contract; explicit sharing must
be able to export that retained window without enabling recording. The final
native repeat passed 149 tests (plus binary/doc targets) and Clippy with warnings
denied (`studio-inspector-native-full2.log`, `studio-inspector-clippy2.log`).
The final external suite passed all 24 tests. No independent reviewer was delegated.
Final CLI review also corrected archive namespaces so a maximum-length legal
source label can export/reimport without growing identity prefixes; the existing
real CLI round-trip fixture now uses that boundary label. Final suite evidence:
`studio-inspector-final-tests7.log`; final native-to-MCP focused fixture:
`studio-inspector-native-final-focused2.log`. Both passed after restoration.

The implementation adds bounded local-source retention/query rules requested by
the Inspector design, not a new execution permission policy. Their privacy,
identity, failure and boundary tests are recorded above. One existing instruction
points at missing `documentation/mental-model.md`; the actual
`documentation/architecture/mental-model.md` was read instead. No unrelated
product changes were made.

No new dependency, production analytics backend, account upload, global MCP
configuration, recording enablement or real user-session collection was
performed. The manual acceptance step is to restart/build Studio, enable local
sharing with the desired recording scope, run the collector, register the MCP
server, then inspect a chosen conversation from a fresh assistant chat. This
verifies the user's actual binary, feed path and host configuration; the isolated
protocol fixture does not substitute for that claim. Source capture and external
archive deletion remain separate controls.

## Local activation acceptance - 17 October 2026

Following the user's explicit request to set up the running desktop session,
the actual Studio started through `start.bat` was configured using its existing
Diagnostics controls. Local recording/sharing and one selected conversation's
content scope are enabled. A hidden independent collector is running with its
store outside the repository. No source credential was read or exported.

The actual feed reported ready, recording enabled, and no source drops or gaps.
An existing conversation became discoverable in the independent store. A real
stdio MCP process discovered all nine tools and successfully read its overview
and timeline, with healthy harness/native source receipts. This closes the
previously pending native-desktop-to-collector-to-MCP acceptance step.

User-level Codex and Claude Code MCP entries were added after backing up their
existing configuration files locally. Claude Code's own connection check passed.
The current assistant chat's tool inventory did not refresh dynamically; access
from a fresh Codex chat (or app reload if needed) remains to be observed by the
user. No claim is made that this existing chat gained a new live tool namespace.
Setup instructions, process/log references and recovery details are saved only
in the user's local Inspector directory. No personal evidence/configuration is
part of the Git commit or GitHub push. The Inspector feature branch is published;
`main` is unchanged. Source sharing remains intentionally off after Studio exits.
