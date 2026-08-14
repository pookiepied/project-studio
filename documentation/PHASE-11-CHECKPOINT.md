# Phase 11 Checkpoint And Repository Health Audit

## Audit Scope

- Audit date: 2026-08-13.
- Branch: `task/phase-11-mcp-l-06`.
- `HEAD`: `4a4df87`; current tree has uncommitted Phase 11 changes.
- Evidence reviewed: all three applications, source/import graph, tests, manifests/lockfiles, build/deployment configuration, root/task/phase documentation, Harness docs, the ADR set through 0031, known issues, roadmap, check-later entries, generated/vendor references, and current dirty diff.
- This checkpoint was written before task 007 remediation. Its issue register is
  retained as evidence and reconciled below against the current dirty tree.

## Executive Health Summary

| Area | Rating | Basis |
| --- | --- | --- |
| Harness foundation | Healthy | Flue durable loop, recovery, Pi adapters, SQLite separation, snapshots, and broad tests are real |
| Harness policy/tool libraries | Acceptable | Permission, bounds, sandbox, native tools, retrieval, credentials, and OTel are implemented and tested |
| Harness production composition | Improving | Native registrars and workspace summary now use CallGate; product identity remains local-session-only |
| MCP core protocol | Acceptable | Dual-era wire/client, stdio, Streamable HTTP, supervision, catalog, grants, and real integration tests exist |
| MCP lifecycle correctness | Needs Attention | Recovery/catalog refresh, dynamic tool changes, credential rotation, cancellation, result semantics, and names are covered; restart persistence and OS containment remain |
| Authentication/security boundary | Needs Attention | Harness route admission, headless loopback binding/readiness, and Gateway fail-closed checks are implemented; packaged Host ownership and external MCP OS containment remain |
| Gateway integration | High Risk | Harness custom SSE/bearer/request/model contracts do not match current Worker implementation |
| Desktop product | Critical for product completeness | React/Tauri remains demo-only and has no Harness/Gateway transport or persistence |
| Data/artifacts/product model | Needs Attention | Flue transcript is real; product projects, artifacts, memory, projections, and user ownership are absent |
| Documentation consistency | High Risk | Current implementation is materially ahead of task/status/README/architecture snapshots |
| Testing confidence | Needs Attention | Harness backend confidence is high; Gateway/UI/desktop boundary confidence is low; Gateway has no tests |
| Dependency hygiene | Acceptable with cleanup | No confirmed unused Harness runtime dependency; Gateway Drizzle and orphan adapters are residue |
| Deployment readiness | High Risk | No CI; auth/config fail-closed assumptions are not enforced; cross-application deployment is unproven |

### Checkpoint Verdict

**The repository cannot yet be treated as a clean stable Phase 11 baseline.** The central MCP execution path is substantially implemented in the dirty tree and has meaningful real integration evidence. The blockers are not perfection: they are an unreviewed/uncommitted implementation, stale source-of-truth documentation, unresolved architecture conflicts, an incomplete listener/Host admission lifecycle, lifecycle correctness gaps, and a disconnected desktop/Gateway boundary.

## Confirmed Issue Register

Every issue below has a severity, category, state, evidence, and recommended resolution. `Confirmed` means the code/test graph establishes the behavior; `Needs runtime verification` is reserved for deployment/runtime conditions not reproducible from this checkout.

| ID | Severity | Category | State | Finding and evidence | Resolution |
| --- | --- | --- | --- | --- | --- |
| AUDIT-01 | P1 | Security | Partially resolved | `src/transport/http/create-app.ts` places one in-memory bearer verifier before Flue, MCP, and permission routes; the patched generated Node listener and `src/host/harness-launcher.ts` now enforce `127.0.0.1`, `PORT=0`, FD-3 readiness, and restart credential replacement. Packaged desktop Host bootstrap and desktop client integration remain absent. | Complete 006.5–006.6: private Tauri Host bootstrap, child ownership, restart handling, and desktop client integration. |
| AUDIT-02 | P1 | Security | Resolved in dirty tree | `requireAdmin()` now permits keyless access only in explicit development/test mode, and `/admin/discovery/run` invokes it. `tests/auth.test.ts` covers production failure. | Keep the test and deploy with a production `ADMIN_TOKEN`. |
| AUDIT-03 | P1 | Security | Resolved in dirty tree | Gateway consumer routes use `requireGatewayBearer()` and fail closed outside explicit development/test mode, including an empty key table. | Keep the test and deploy with a production gateway key. |
| AUDIT-04 | P1 | Security | Explicitly bounded by ADR 0031 | Harness Gateway client sends a Studio access/session token while Worker verifies `sk-gw_*`; the values are intentionally not reused. The current Worker is not a supported Harness backend. | Reopen for a public/service-binding contract decision and cross-project test. |
| AUDIT-05 | P1 | Integration | Explicitly bounded by ADR 0031 | Harness expects typed custom SSE/camelCase events while the current Worker remains OpenAI-compatible/snake_case. No deployment path claims them compatible. | Implement one authoritative contract before enabling Worker-backed Harness production. |
| AUDIT-06 | P1 | Security | Resolved in dirty tree | `src/extend/mcp/input-security.ts` recursively rejects secret-shaped fields, sensitive args, URL credentials, and sensitive query keys before route projection and registry persistence. | Keep route and registry-level regression tests. |
| AUDIT-07 | P1 | Integration | Resolved in dirty tree | Supervisor lifecycle callbacks refresh/remove catalog state for initial start, background retry, ready death, and stop; retry edits are generation/key guarded. | Add any future provider-specific recovery test before changing lifecycle callbacks. |
| AUDIT-08 | P1 | Architecture | Resolved in dirty tree | ADR 0029 chooses append-only session membership; retained tools have dispatch-time availability and new sandboxes rebuild from current selection. | Do not implement Skills against a different membership contract. |
| AUDIT-09 | P1 | Incomplete implementation | Resolved in dirty tree | `registerNativeTools()` registers filesystem/search/Git/shell/web/workspace-summary through `CallGate`; the direct Flue bypass is removed and schemas are exposed. | Keep native posture/manual-mode decisions explicit. |
| AUDIT-10 | P1 | Security | Locally bounded; multi-user deferred | ADR 0030 puts admitted client/session identity and separate agent/conversation fields in `ExecutionScope`. Account-backed user ownership, child authority, and multi-user service mode remain intentionally absent. | Require a trusted product identity/schema decision before multi-user or Phase 13 subagent work. |
| AUDIT-11 | P1 | Security | Resolved in dirty tree | Model-supplied `-c`, attached forms, and `--config-env` are rejected; the fixed Project Studio option remains authored code. | Keep Git argument regression coverage. |
| AUDIT-12 | P1 | Security | Confirmed | External MCP stdio processes are not OS-contained. `LocalSandbox` is in-process; effect rules require OS isolation for execute/network, but current ADR 0025 permits explicit policy approval for user-connected code. | Keep the limitation explicit and user-visible, or block uncontained third-party execute/network until an OS/remote sandbox exists. This is an architectural decision, not a hidden implementation detail. |
| AUDIT-13 | P2 | Bug | Resolved in dirty tree | Approval requests accept `AbortSignal`, remove pending entries on abort, and the kernel checks cancellation before grant persistence. | Preserve explicit restart behavior for in-memory pending approvals. |
| AUDIT-14 | P2 | Bug | Resolved in dirty tree | MCP results preserve content, `isError`, structured content, non-text blocks, and fallback text through the gate projection. | Keep protocol-level JSON-RPC failures as transport errors. |
| AUDIT-15 | P2 | Security | Resolved in dirty tree | Credential rotation/deletion stops live servers; removal deletes the keychain entry before the durable row. | Keep cross-store failure tests as stores evolve. |
| AUDIT-16 | P2 | Security | Resolved in dirty tree | Cross-origin redirects now retain only safe presentation headers and strip arbitrary configured auth headers/session ids. | Keep redirect tests for custom headers. |
| AUDIT-17 | P2 | Bug | Resolved in dirty tree | MCP names enforce `^[a-zA-Z0-9_-]{1,64}$`; model-facing names use length-prefix encoding and duplicate detection. | Keep the name grammar as the public contract. |
| AUDIT-18 | P2 | Bug | Resolved in dirty tree | `McpConnection` surfaces server notifications; `tools/list_changed` marks catalog state dirty and refreshes at the next turn boundary. | Keep dynamic refresh coalesced and non-partial. |
| AUDIT-19 | P2 | Bug | Resolved in dirty tree | Gateway model lookup/listing now require both provider and model enabled flags; discovery preserves existing admin flags on conflict. | Add deployment-level D1 discovery smoke coverage later. |
| AUDIT-20 | P2 | Bug | Resolved in dirty tree | Gateway Responses now fails with typed provider configuration when encryption key is absent. | Keep shared credential plumbing aligned with chat. |
| AUDIT-21 | P2 | Security | Resolved in dirty tree | MCP content is labeled untrusted before reaching the model, including structured/non-text result envelopes. | Preserve the label for future connector/skill result paths. |
| AUDIT-22 | P2 | Integration | Confirmed | Desktop `useChatSession()` returns `useDemoChatSession()`, and `ProjectsProvider` stores all projects/chats/notes/tasks/files in memory. No `FlueHarnessClient`, Gateway call, artifact route, or Tauri sidecar exists under `STUDIO/src`. | Implement the Phase 18 transport/auth seam; do not call the current UI product-connected. |
| AUDIT-23 | P2 | Persistence | Confirmed | Pending approval promises are only in `PermissionApprovalBroker.#pending`; restart loses them. MCP management also spans SQLite/keychain/live state without one transaction/compensation path. | Define restart behavior and cross-store mutation ordering before production settings/approval UI. |
| AUDIT-24 | P2 | Incomplete implementation | Explicitly deferred | OAuth 2.1, the bundled library, and model-facing management remain absent by task 007 scope; current auth shapes and HTTP management are not silently called complete. | Reopen only if Phase 11 scope is expanded before Skills. |
| AUDIT-25 | P2 | Documentation | Reconciled in dirty tree | Task 007, README, STATUS, Phase 11 overview, architecture, known issues, ADRs, and audit snapshots now point at current callers and remaining boundaries. Historical work-plan prose remains historical. | Run this cross-reference audit again after commit/clean-checkout review. |
| AUDIT-26 | P2 | Documentation | Reconciled in dirty tree | Architecture phase counts, ADR count, Gateway map, task 006/007 routing, and current Harness structure are updated; absent archive/MCP directories remain accurately described as absent. | Keep repository maps current at phase boundaries. |
| AUDIT-27 | P2 | Architecture | Resolved in dirty tree | ADR 0028 and `transport/http/create-app.ts` define business route composition as an application transport boundary; `app.ts` only wires dependencies. | Amend ADR 0004 text to reference the factory boundary. |
| AUDIT-28 | P2 | Integration | Accepted local limit | ADR 0030 records one bound project/runtime per local Harness launch; authenticated multi-project service mode is deferred with product identity. | Do not claim multi-project shared service support. |
| AUDIT-29 | P3 | Dead code | Confirmed | Gateway `gatewayAuth`, no-op `telemetry`, raw `hashGatewayKey`, provider definitions, helper DB functions, and old provider adapters are unused or placeholders. | Remove/archive or integrate after the authoritative Gateway architecture is chosen. |
| AUDIT-30 | P3 | Duplication | Confirmed | Gateway chat/responses duplicate auth, rate limit, model lookup, credential, and decryption logic and already diverge. Provider inventory is duplicated between registry and migrations. | Consolidate shared Worker policy after the contract decision; preserve intentional Harness/Gateway process separation. |
| AUDIT-31 | P3 | Dependency | Confirmed | Gateway declares Drizzle ORM/Kit and `db:generate` but uses raw D1 and has no Drizzle config/imports. | Remove or document the dependency when cleanup is permitted. |
| AUDIT-32 | P3 | Testing | Confirmed | Gateway has Vitest configuration but no test files; STUDIO has no test directory/script; no desktop-to-Harness or current Worker contract E2E exists. | Add boundary tests before calling those applications integrated. |
| AUDIT-33 | P3 | Observability | Confirmed | Gateway telemetry is no-op; request IDs and Harness-to-Gateway correlation are not propagated; Harness has trace/span fields but no user/session/run-wide contract. | Define correlation IDs at the application boundary and test propagation/redaction. |
| AUDIT-34 | P3 | Maintainability | Confirmed | Desktop `components.json` declares Lucide while the code uses Phosphor; README/config defaults still describe old relative DB paths; several docs duplicate phase state. | Clean configuration/document routing during documentation pass. |
| AUDIT-35 | P3 | Bug | Confirmed | `src/process/exec.ts:162-167` still spawns bare `taskkill`, and `child.stdin.end()` is unguarded. These are already tracked as P-05/P-06. | Fix in the process task before broader native/MCP production exposure. |
| AUDIT-36 | P4 | Performance | Confirmed | Large tool output is truncated rather than offloaded to a stable artifact handle, contrary to mental-model section 3.5 and check-later C-11. | Measure first; then decide whether offload belongs to native/MCP result handling. |

## Designed But Not Implemented

| System | Design evidence | Actual state |
| --- | --- | --- |
| Context Engine and optimized context | ADR 0003, `mental-model.md` | Only generic optimizer port and passthrough implementation |
| Append-only `expandedTools`/`tool_discover` | `mental-model.md:162-243`, ADR 0029 | Append-only session membership is implemented; `tool_discover` UI/API remains deferred |
| Skills | Roadmap Phase 12, extension kind | No loader/catalog/storage/executor |
| Connectors/Composio | `mental-model.md` section 6 | No implementation |
| Planner | Roadmap/architecture | No implementation |
| Project/artifact ownership | Roadmap Phases 14/18 | UI-only project data; no product model |
| Memory/RAG | Roadmap Phase 15 | Absent |
| Product event projections | Roadmap Phase 18 | Removed dead envelope; no consumer-backed replacement |
| Remote OS/VM sandbox | Roadmap Phase 9 | Absent; only in-process sandbox |
| MCP OAuth, bundled library, model-facing management tool | Phase 11 design/work plan | Absent |
| Public API/auth worker and service binding | ADR 0002/roadmap | Absent from checkout |
| Desktop Harness client | Architecture frontend seam | Demo hook remains active |
| Gateway media execution | Gateway provider categories | Catalog metadata/placeholder adapters, no dedicated media routes |

## Implemented But Not Integrated

| Implementation | Evidence | Why it is not integrated |
| --- | --- | --- |
| Native tool families | `src/tools/*/index.ts`, `src/tools/native/index.ts` | Wired through the production CallGate in dirty tree |
| `workspace_summary` gate replacement | `src/tools/workspace-summary.ts` | Native descriptor and CallGate registration are active |
| Retrieval service/web tools | `src/retrieval/`, `src/tools/web/` | Wired through `registerNativeTools()`; provider settings remain local |
| `FlueHarnessClient` | `src/application/harness-client.ts` | Desktop has no import/caller |
| `StudioCloudModelProviderAdapter.loadCatalog()` | `src/models/studio-cloud-adapter.ts` | No production lifecycle caller |
| `PassthroughContextOptimizer` | `src/context/context-optimizer.ts` | Deliberately retained seam; no context engine consumer |
| Gateway provider definitions/helpers | Gateway registry/db helpers | Active routes use other adapter/SQL paths |
| Desktop project data model | `ProjectsProvider` | No persistence/API binding |

## Documentation And Decision Discrepancies

| Discrepancy | Source claim | Code reality | Resolution owner |
| --- | --- | --- | --- |
| Phase 11 callers | Historical task text said zero callers | Dirty `app.ts`, `StudioRuntime`, and real MCP tests provide callers | Task 007 records the current remediation |
| L-06/L-07/L-08/L-09 | Historical loose-end snapshot called them open | Hashes, revocation, withheld diagnostics, management, gate execution, and E2E path exist | Mark closed with evidence; keep remaining lifecycle items separate |
| Harness API | Historical README said no custom API | Authenticated `/api/mcp` and `/api/permissions` are mounted and documented | Keep README and transport-factory references current |
| Phase 10 count | Architecture/status use older 7/9 of 10 language | Nine native families exist; task/skill are later-phase capabilities | Normalize phase counting and exposure status |
| Local BYOK | README/older ADR text says unavailable | ADR 0009 and local runtime/tests show operational Harness-side BYOK | Mark older text superseded |
| `app.ts` route boundary | Historical ADR 0004 wording forbade business routes | `app.ts` wires `createHttpApp()`; route code is in transport boundary | ADR 0004 amended and ADR 0028 records the boundary |
| Tool membership | Mental model mandates append-only | ADR 0029 and runtime retain tools with unavailable dispatch results | Closed; do not regress for Skills |
| Gateway architecture | Blueprint says Anthropic-first/protocol registry; code has 20 providers and separate adapter registry | Provider definitions/adapters/discovery paths diverge | Choose one Worker architecture and update blueprint |
| Gateway/Harness contract | Roadmap says operational integration | Current Worker and Harness wire/auth/request/model contracts differ | Cross-project contract decision/test |

## Decision Record Reconciliation

| ADR | Classification | Evidence |
| --- | --- | --- |
| 0001 | Enforced with transport-boundary amendment | Flue/Pi split is real; application routes are globally admitted |
| 0002 | Partial | Two-gateway intention exists; public proxy/service binding absent |
| 0003 | Partial/deferred | Optimizer port exists without production caller |
| 0004 | Implemented with transport-factory amendment | OTel setup works; `app.ts` contains wiring, not business route handlers |
| 0005 | Superseded in availability details | Composition remains; ADRs 0006/0009 make cloud/local operational |
| 0006 | Harness-side implemented | Custom Studio Gateway adapter/tests exist; current Worker mismatch |
| 0007 | Enforced in Harness | Keyring and migration guard |
| 0008 | Implemented | PKCE/session refresh and callback-port guard |
| 0009 | Implemented | Local Pi runtime/keychain/provider service |
| 0010 | Implemented | Separate DBs, migrations, no-secret-column guard |
| 0011 | Implemented with open raw-error edges | Harness error reporter; CLI/Gateway exceptions remain |
| 0012 | Core implemented/partially wired | Kernel/sandbox/gate real; remote isolation deferred |
| 0013 | Implemented with P-05/P-06/V-01 limits | Process substrate and vendor resolver |
| 0014 | Implemented | Path ownership and `~/.studio` layout |
| 0015 | Implemented | Scope ladder and approver scope IDs |
| 0016 | Implemented with accepted limits | Shadow Git snapshots |
| 0017 | Implemented with accepted non-cooperative JS | Bounds/cancellation/FIFO |
| 0018 | Kernel implemented, product posture partial | Trust/mode logic; runtime defaults manual and no UI setting |
| 0019 | Library and native exposure implemented in dirty tree | Shell tool and chosen-program policy are registered through CallGate |
| 0020 | Implemented with K-04 open | Central effects table; Git per-call mismatch remains |
| 0021 | Implemented | Project-scoped grant query/index/migration |
| 0022 | Implemented/amended | Native and MCP network results carry destination/untrusted policy |
| 0023 | Implemented and registered in dirty tree | Retrieval slots/tools are wired through native registration |
| 0024 | Implemented in dirty tree | Switch filtering and withheld diagnostics |
| 0025 | Implemented | `author` provenance and policy ask |
| 0026 | Implemented | Redirect author, origin stripping, DNS pinning |
| 0027 | Implemented | Streamable HTTP synthesized failures/session handling |
| 0028 | Partial implementation | Global admission is implemented; explicit listener/Host/desktop seam remains |
| 0029 | Implemented in dirty tree | Append-only MCP session membership and boundary availability |
| 0030 | Implemented for local v1 | Client/session execution identity; account-backed multi-user deferred |
| 0031 | Accepted boundary | Current Worker is not a supported Harness backend until a cross-project contract exists |

## Remediation Plan

### Fix Before Next Phase

1. Review and commit the current Phase 11/audit implementation as a coherent change. The current branch remains dirty and `HEAD` does not contain it.
2. Keep ADR 0029's append-only session membership contract in force before Skills/connectors.
3. Carry the pinned Flue generator patch or replace it with an upstream listener API; then add private Host bootstrap, desktop ownership, and packaged restart handling.
4. Keep Gateway admin/consumer admission fail-closed and protect discovery; tests now cover the source contract.
5. ADR 0031 explicitly removes the current Worker from the supported Harness runtime path until a compatible public proxy/service-binding contract exists; implement that contract before re-enabling it.
6. Recursive MCP secret validation and credential cleanup/rotation are implemented; retain regression coverage.
7. MCP supervisor/catalog recovery, notification refresh, result semantics, naming, and credential lifecycle are implemented in the dirty tree.
8. Native tools now use one CallGate; retain local/manual posture and explicit external-MCP containment limits.
9. Finish the task/status/README/architecture/ADR documentation pass after the full checks.

### Fix During Current Cleanup

1. Approval waits are cancellation-aware; keep restart behavior explicitly process-memory for local v1.
2. MCP `isError`, structured content, non-text content, and untrusted labels are normalized through the gate.
3. MCP tool-name grammar and injective model-facing names are enforced.
4. Notification-driven tool-list refresh is implemented at turn boundaries; TTL refresh remains deferred.
5. Gateway model/provider enabled flags and `/v1/responses` encryption-key validation are enforced.
6. Gateway auth tests now exist; desktop/Harness contract tests remain blocked on the Host seam.
7. Fix process P-05/P-06 and add the Git `-c` regression test.
8. Remove/archive confirmed Gateway placeholders and unused Drizzle/provider-definition layers.
9. Add end-to-end correlation identifiers and audit fields once an authenticated application boundary exists.

### Intentionally Defer

These are safe to defer only if they are recorded as explicit scope, not silently called implemented:

- Skills and skill execution.
- Connectors/Composio.
- Planner and Project Studio subagent profiles.
- Memory, RAG, workflows, schedules, and evals.
- Product artifacts, attachments, project persistence, and transcript projections.
- Remote OS/VM sandbox.
- Desktop product integration until the backend contracts are stable.
- MCP resources, prompts, deprecated HTTP+SSE, Roots, Sampling, and Logging.

### Architectural Decision Required

- Append-only `expandedTools` versus removal on disable.
- Whether user-connected MCP execute/network is acceptable uncontained by OS isolation.
- Whether Phase 11 includes OAuth, bundled extensions, and a model-facing management tool.
- Per-call Git effect declarations versus capability-level effects.
- Public API/service-binding architecture and the token translation between Harness and Gateway.
- Authenticated user/project/session identity and subagent authority derivation.
- Product artifact ownership and Flue-to-project binding.

### Documentation Only

- Refresh stale Phase 11 task/status/overview/roadmap statements after implementation review.
- Amend ADR 0004 for application business routes or relocate those routes.
- Mark ADR 0005/0006 local-provider statements superseded by ADR 0009.
- Correct repository map references to absent `archive/`/`MCP/`, current ADR count, Gateway scope, and current Phase 10/11 counts.
- Update Harness README structure, API, database defaults, local BYOK, and MCP descriptions.

### No Action Required

- Separate Flue and application databases are intentional under ADR 0010.
- Shadow Git rather than a snapshot table is intentional under ADR 0016.
- HTTP+SSE, Roots, Sampling, and Logging are intentionally excluded by the selected MCP revision.
- `PassthroughContextOptimizer` is an intentional future seam, not dead code.
- Desktop demo hooks and in-memory project state are intentional transitional code until Phase 18.
- Independent package lockfiles and no shared package are consistent with the two-process boundary.

## Testing Audit

### Existing Confidence

- Harness unit coverage covers architecture boundaries, errors, credentials, storage, trust/modes, permissions, effects, bounds, snapshots, process, native tools, retrieval, provider adapters, OTel, MCP wire, channels, handshake, supervisor, registry, selection, and reconciliation.
- Harness integration coverage covers Flue persistence/recovery/cancellation, generated-server Gateway adapter behavior, auth login, keyring, local BYOK, observability, and dirty-tree real MCP runtime/Flue paths.
- `CI=true pnpm check` is green for the dirty Harness tree: typecheck, Flue build, 62 test files, 1,077 passing, 9 skipped.
- `git diff --check` passed.

### Gaps That Matter Architecturally

- Gateway source-level auth/model-state tests now exist; deployed Worker/D1 behavior remains untested.
- No STUDIO tests or test script.
- No desktop-to-Harness or Tauri sidecar test.
- No current Worker-to-Harness wire contract test.
- Packaged Harness listener/Host lifecycle and desktop transport remain untested.
- No product project/artifact/memory/identity persistence tests.
- OS keyring cases skip when no usable keyring is available, so real platform behavior is not fully covered in every environment.
- No deployment smoke test for Wrangler/D1/secrets or packaged desktop/Harness startup.

## Baseline Definition

A clean Phase 11 checkpoint does not require all later product phases. It does require:

### Mandatory Fixes

- Current Phase 11 implementation is reviewed, committed, and reproducible from a clean checkout.
- Harness and Gateway admission boundaries fail closed or are explicitly private and enforced.
- Nested MCP secrets cannot enter durable configuration; credential delete/rotation lifecycle is correct.
- MCP supervisor recovery and catalog state are coherent after failure/restart/retry.
- MCP tool-name and result/error semantics are stable.
- Native tool exposure is wired through the gate with a local/manual posture.
- ADR 0029's append-only behavior is decided and tested.

### Mandatory Documentation Updates

- `tasks/phase-11-mcp/005-loose-ends.md` reflects L-06 through L-09 and remaining L-10/L-11 truth.
- `STUDIO HARNESS/docs/STATUS.md`, `ROADMAP.md`, `KNOWN-ISSUES.md`, Harness README, `documentation/architecture.md`, and Phase 11 overview agree on current implementation.
- Any ADR/code conflict has an amendment or a code correction.

### Mandatory Tests

- Real MCP stdio through gate and Flue remains green.
- Recovery/catalog refresh, credential lifecycle, approval cancellation, name collisions, result errors, and route auth have regression tests.
- Gateway/Harness wire contract still needs an authoritative compatible Worker/proxy test.
- A clean `CI=true pnpm check` passes in Harness; Gateway has meaningful route tests; desktop build/typecheck is run with its dependencies.

### Accepted Limitations

- No skills, connectors, planner, memory, artifacts, product projections, or desktop product integration.
- No remote OS/VM sandbox, subject to explicit acknowledgement of uncontained user-connected MCP code.
- No deprecated MCP transports/features selected out of scope.
- Flue remains canonical transcript owner until a product projection has a real consumer.

### Deferred Work

- Phase 12+ capabilities, public API worker, product data model, and desktop integration.
- MCP OAuth/bundled library/model management tool if the owner explicitly moves them out of Phase 11.

## Snapshot Definition

### Baseline Architecture

Flue owns durable agent execution and canonical conversation. Pi owns model protocols. Project Studio owns policy, permissions, credentials, native/MCP tool composition, configuration, snapshots, and observability. External MCP servers are user-installed capabilities behind the CallGate. The desktop is a future client. The Gateway is independent until a compatible public-proxy contract is implemented.

### Baseline Implementation

Harness foundation, provider/auth/keychain/storage/permission/snapshot/observability libraries, native tool libraries, MCP client stack, and dirty-tree MCP/native runtime composition exist. Native and MCP capabilities are exposed through the current sandbox factory and share the CallGate.

### Known Issues

The issue register above remains open until remediation. Existing accepted/open issues in `STUDIO HARNESS/docs/KNOWN-ISSUES.md` remain authoritative where they do not conflict with current code.

### Next-Phase Preconditions

The next phase may assume Flue ownership, separate databases, keychain secrets, CallGate as the single execution boundary, authenticated local MCP routes, append-only tool semantics, and tested supervisor/catalog recovery. It may not assume packaged Host readiness, account-backed user scope, desktop transport, product project/artifact persistence, remote OS containment, or a compatible current Gateway Worker.

## Direct Executive Answers

1. **What exactly is Studio Harness today?** A local-first Node agent-runtime backend composed from Flue and Pi, with Project Studio policy/storage/tool libraries and a working dirty-tree MCP client path; it is not yet the connected desktop product.
2. **What is actually implemented?** Flue durable execution, provider adapters, local BYOK, auth/keychain, application DB, permission/gate/sandbox/snapshots, observability, native tool libraries, MCP protocol/lifecycle/core catalog, and current MCP management/approval wiring.
3. **What is only designed?** Skills, connectors, planner, memory, product artifacts/projects/projections, remote isolation, public API worker, workflows, evals, and several Phase 11 surfaces.
4. **What is partially implemented?** Subagents, context engine, account-backed identity, Gateway wire integration, desktop integration, and product persistence.
5. **What is implemented but not integrated?** `FlueHarnessClient` in the desktop, context optimizer, public Gateway proxy, and several Gateway registry/helpers.
6. **What is duplicated?** Gateway auth/credential/model plumbing, provider inventories/adapters, old and active provider adapter paths, and stale documentation snapshots. Harness/Gateway separation itself is intentional, not accidental duplication.
7. **What is dead or obsolete?** Gateway empty auth middleware, no-op telemetry, raw hash helper, orphan provider adapters/definitions, Drizzle residue, and unused desktop assets. Native libraries and demo code are transitional rather than dead.
8. **What contradicts the current architecture?** The remaining gaps are packaged Host/listener ownership, the Worker/Harness wire contract, and uncontained third-party MCP execution as an explicit approval boundary rather than sandbox containment.
9. **What contradicts decision records?** No current Harness route or tool-membership conflict remains; Gateway/Harness deployment assumptions are not realized and older local-BYOK text is superseded by ADR 0009.
10. **What documentation is stale?** Phase 11 task/status/overview/roadmap, Harness README, repo architecture/map/mental-model counts, Gateway blueprint, and older provider-status statements.
11. **What are the highest-risk bugs?** The remaining highest risks are packaged Host ownership, Harness/Gateway protocol mismatch, pending approval restart behavior, and uncontained external MCP execution; the listed MCP input/lifecycle/name/result/Git/cancellation bugs are fixed in the dirty tree.
12. **What are the highest-risk architectural problems?** No authenticated product identity, disconnected desktop, ambiguous tool membership, uncontained external MCP execution, absent product data/artifact ownership, and no authoritative Gateway/public-proxy contract.
13. **Which security boundaries are real versus conceptual?** Native path/env/process argument controls, keychain, destination pinning, CallGate, local route admission, headless loopback/readiness, Gateway fail-closed source checks, and Flue leases are real. Packaged loopback Host ownership, account/tenant identity, OS containment for MCP, and desktop auth remain conceptual or missing.
14. **What is production-ready versus experimental?** Harness foundation and isolated backend tests are the most mature. MCP stdio/Streamable HTTP is experimentally integrated. Gateway and desktop integration are not production-ready. The current control API is local-trust-only.
15. **What must be fixed before continuing?** Review/commit current code, complete the packaged Host seam, establish the Gateway wire boundary, and complete the source-of-truth documentation pass.
16. **What can safely be deferred?** Skills, connectors, planner, memory, artifacts, product projections, workflows, evals, desktop integration, and explicit out-of-scope MCP features, provided they are recorded as deferred.
17. **What should become authoritative?** Flue/Pi ownership, Project Studio policy and CallGate, keychain secrets, separate DBs, reconciled MCP lifecycle, append-only membership, one authenticated local application boundary, and explicit local-session identity should be the baseline architecture.
18. **Can the repository be treated as a stable Phase 11 baseline?** Not yet.
19. **What prevents that?** Dirty uncommitted implementation, packaged Host ownership, current Gateway mismatch, pending restart durability, remote containment, and disconnected desktop/product boundary.
20. **What assumptions may the next phase safely make after resolution?** It may rely on a reviewed, documented, authenticated MCP capability path and explicit scope/visibility semantics, while treating later product systems as absent and Flue as canonical transcript owner.
