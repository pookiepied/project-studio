# Studio Cloud and Local Architecture Structure

## Purpose

This companion file turns `Cloud and Local.md` into a working structure for an architecture QA process. The source brief should remain the canonical raw capture. This file should become the operating map: what to decide, in what order, and what artifacts the architecture session must produce.

## Proposed Packet Structure

### 1. Orientation

Purpose:

- State the document goal.
- Define what is in scope for the architecture pass.
- Define what is explicitly out of scope until contracts and boundaries are settled.

Source sections:

- `1. Purpose of This Document`
- `28. Current Working Summary`
- `29. Instruction for the Architecture-Review LLM`

Output:

- One-page architecture brief.
- Confirmed requirement list.
- Assumption list.
- Deferred decision list.

### 2. Vocabulary and Boundary Model

Purpose:

- Normalize names before making design decisions.
- Separate runtime categories, shared services, duplicated concepts, and cloud-authoritative services.
- Establish trust boundaries, ownership boundaries, and plane boundaries.

Source sections:

- `2. Core Architectural Direction`
- `10. System MCP Servers`
- `11.3 Control Plane and Execution Plane`
- `18. Native Tools`

Output:

- Glossary.
- Component taxonomy.
- Cloud/local/shared/cloud-only matrix.
- Control-plane, execution-plane, and data-plane split.
- Trust-boundary map.

### 3. System Boundary Map

Purpose:

- Define each component by owner, runtime, persistence, trust level, inputs, outputs, dependencies, and non-responsibilities.
- Make the architecture review talk about boundaries before it talks about implementation.

Source sections:

- `3. Existing Components and Refactoring Intent`
- `5. Unified Registry`
- `6. Cloud Context Worker`
- `8. Cloud Agent Runtime`
- `12. Studio Data Worker`
- `14. Local Cloud-Access Service and the Bridge Concept`

Output:

- Component responsibility table.
- Non-responsibility list for each major component.
- Runtime/persistence/trust matrix.
- Initial request-flow diagrams used to expose missing contracts.

### 4. Current-State and Migration Inputs

Purpose:

- Capture existing systems that constrain the refactor.
- Decide what must be preserved, migrated, renamed, replaced, or deleted.
- Split current inventory from future intent.

Source sections:

- `3. Existing Components and Refactoring Intent`
- `17. Local MCP Runtime Refactor`
- `23. Explicit Candidate Removals or De-scoping`

Output:

- Current dependency map.
- Migration constraints.
- Deletion candidates.
- Parity checks required before removal.

### 5. Shared Contracts

Purpose:

- Define the contracts shared conceptually across cloud and local before designing either runtime in detail.
- Prevent duplicated cloud/local implementation details from hiding incompatible interfaces.

Source sections:

- `4. Library Systems`
- `5. Unified Registry`
- `6. Cloud Context Worker`
- `7. Tool Pool, Capability Discovery, and Progressive Expansion`
- `8. Cloud Agent Runtime`
- `20. Conversation, Transcript, and Context Lifecycle`
- `21. Agent State, Checkpoints, Pause, and Resume`

Output:

- Registry contract.
- Context package contract.
- Capability discovery and expansion contract.
- Permission contract.
- Agent definition schema.
- Agent invocation protocol.
- Transcript/event schema.
- Run state machine.

### 6. Core Resource Model

Purpose:

- Define the resources Studio can discover and expose.
- Keep libraries, registry, execution, and permissions separate.

Source sections:

- `4. Library Systems`
- `5. Unified Registry`
- `7. Tool Pool, Capability Discovery, and Progressive Expansion`
- `8.3 Agent Execution Tools`

Output:

- Resource type catalog.
- Registry ownership model.
- Capability metadata model.
- Progressive expansion protocol.

### 7. Context and Model Input Contract

Purpose:

- Decide what the Context Worker and Local Context Engine construct.
- Define context package boundaries without turning context into a catch-all service.

Source sections:

- `6. Cloud Context Worker`
- `15. Local Context Engine`
- `20. Conversation, Transcript, and Context Lifecycle`

Output:

- Context package schema.
- Capability catalog schema.
- Executable schema exposure rules.
- Transcript and compaction contract.
- Prompt-cache stability rules.

### 8. Agent Runtime and Orchestration

Purpose:

- Define how agents run, spawn, communicate, pause, resume, and recover.
- Decide whether orchestration is a distinct component or runtime responsibility.

Source sections:

- `8. Cloud Agent Runtime`
- `9. Agent-to-Agent Communication and Blackboard`
- `11. Cloud Orchestration and Inter-Worker Communication`
- `19. Deep Research and Other Cloud Sub-Agents`
- `21. Agent State, Checkpoints, Pause, and Resume`
- `22. Goal Mechanism`

Output:

- Agent definition schema.
- Agent invocation protocol.
- Parent-child contract.
- Blackboard contract.
- Run state machine.
- Checkpoint and recovery model.

### 9. Cloud Architecture

Purpose:

- Define cloud workers, routing, persistence, and internal service boundaries.
- Keep the Gateway narrow and prevent client APIs from exposing internal topology.

Source sections:

- `3.1 Gateway and Gateway V2`
- `12. Studio Data Worker`
- `13. Cloud API Architecture`
- `24.1 Cloud Chat Request`

Output:

- Cloud component map.
- Gateway contract.
- Cloud API capability map.
- Data worker contract.
- Cloud chat request flow.

### 10. Local Architecture

Purpose:

- Define how local Studio runs independently.
- Decide process model, persistence model, local MCP execution, and offline behavior.

Source sections:

- `15. Local Context Engine`
- `16. Local Runtime and Persistence`
- `17. Local MCP Runtime Refactor`
- `24.2 Local Chat Request`

Output:

- Local process diagram.
- SQLite or embedded persistence model.
- Local registry and library contracts.
- Local MCP lifecycle.
- Local chat request flow.

### 11. Hybrid and Cloud-Access Contract

Purpose:

- Define exactly how local Studio uses cloud-only capabilities.
- Avoid exposing internal services directly to the desktop client.

Source sections:

- `14. Local Cloud-Access Service and the Bridge Concept`
- `12.2 Local Interaction With Studio Data`
- `24.3 Child-Agent Request`

Output:

- Bridge contract.
- Cloud capability manifest.
- Authentication and device trust model.
- Hybrid execution policy.
- Artifact promotion and transfer rules.

### 12. Security, Permissions, and Observability

Purpose:

- Make trust, authorization, side effects, telemetry, and auditability first-class architecture constraints.

Source sections:

- `7.5 Permission Enforcement`
- `25.8 Permissions`
- `25.19 Observability and Tracker`
- `25.20 Security and Trust`

Output:

- Permission model.
- Side-effect classification.
- Audit event model.
- Minimum observability baseline.
- Tracker deferral statement.

### 13. Migration and Deletion Plan

Purpose:

- Convert the current-state inventory and architectural decisions into an ordered implementation and removal plan.

Source sections:

- `3. Existing Components and Refactoring Intent`
- `17. Local MCP Runtime Refactor`
- `23. Explicit Candidate Removals or De-scoping`
- `25.21 Migration and Refactor Sequence`

Output:

- Ordered migration plan.
- Gateway parity checklist.
- Legacy chat-worker extraction plan.
- V2 architecture salvage/delete plan.
- Local MCP transition plan.
- Rollback and compatibility notes.

### 14. Decision Log and Final Deliverables

Purpose:

- Record each architecture decision and the consequence of that decision.
- Convert answers into implementable artifacts only after dependencies are resolved.

Source sections:

- `26. Recommended QA Sequence`
- `27. Required Deliverables From the Future Architecture Session`

Output:

- Decision log.
- Final component map.
- Implementation sequence.
- Acceptance tests.
- Deletion plan.

## Dependency-Ordered QA Sequence

### Phase 1: Name and Boundaries

1. What are the final component names for cloud and local equivalents?
2. Which components are control plane, execution plane, or data plane?
3. What is the minimum first-version boundary between Cloud Studio and Local Studio?
4. Which concepts are shared, duplicated, cloud-only, local-only, or deferred?
5. Which capabilities must exist in both cloud and local on day one?
6. Which capabilities are explicitly cloud-only on day one?
7. Which capabilities must continue working while the local app is offline?
8. What is the trust boundary between cloud runtime, local runtime, connectors, user MCP servers, system MCP servers, and native tools?
9. Is the Studio Gateway only a model-provider gateway, or does it expose any Studio-native agent capability?
10. Is Bridge a distinct cloud service, an API facade, or the authenticated local-client contract?
11. Can the local app call Gateway directly, or must all cloud access go through Bridge?

### Phase 2: Resource and Capability Model

1. What resource types does the unified Registry index in the first version?
2. Do libraries own canonical resource definitions while the Registry owns only search and availability indexes?
3. What metadata is common across MCP servers, MCP tools, skills, agents, connectors, native tools, and system capabilities?
4. Which resources are executable, declarative, or both?
5. How are system resources distinguished from user-installed resources?
6. What is the minimum capability summary the model sees before requesting expansion?
7. What exact mechanism expands a capability into an executable schema?
8. What is the minimum Local Registry schema needed before local MCP and local agents can run independently?

### Phase 3: Context Contract

1. What inputs does the Context Worker or Local Context Engine accept?
2. What output format is provider-neutral enough to share conceptually across cloud and local?
3. Which parts of the context package are stable prompt-cache prefix, dynamic context, capability catalog, executable schemas, and runtime metadata?
4. Who owns memory retrieval, memory formatting, and memory persistence?
5. How are transcript, tool events, attachments, artifacts, and child-agent outputs represented?
6. What compaction contract preserves unresolved commitments and inspectability?

### Phase 4: Runtime and Orchestration

1. What is the canonical run state machine?
2. Is orchestration a separate component or part of the main agent runtime?
3. How are parent and child agent runs represented?
4. What is the contract for spawn, await, status, cancel, pause, resume, and result?
5. Does every agent use the same runtime loop, including planner, executor, deep research, and temporary child agents?
6. Is blackboard included in the first version, and if so, what is its scope?
7. How are retries, idempotency, side effects, and recovery handled?
8. What must be checkpointed for cloud and local runs?

### Phase 5: Cloud and Local Flows

1. What is the cloud chat request path from API entry to model call to streamed result?
2. What is the local chat request path from UI event to local model call or cloud call?
3. Which cloud services may local Studio call through the Bridge?
4. Is the Gateway directly reachable from local Studio, or only through Bridge?
5. Can a local parent spawn a cloud child in the first version?
6. Can a cloud parent spawn a local child in the first version?
7. What artifact, file, and generated-media operations cross the cloud/local boundary?

### Phase 6: Migration and Acceptance

1. What current code depends on the old Gateway?
2. What behavior was proven before the active `gateway` replaced the legacy gateway?
3. Which old registries, V2 folder concepts, and local MCP code paths are reusable?
4. Which folders or workers can be removed immediately, and which require parity tests first?
5. What acceptance tests prove the selected architecture is implemented correctly?

## Redundancy and Reordering Notes

- `28. Current Working Summary` should move near the front as an executive summary, then be updated as decisions are made.
- `29. Instruction for the Architecture-Review LLM` belongs near the front as operating rules for the QA session.
- `23. Explicit Candidate Removals or De-scoping` should be split between current-state migration inputs and final deletion plan.
- `25. Architecture QA` is useful, but too large to drive the conversation directly. It should be converted into dependency-ordered phases and used as a question bank.
- `24. Proposed Conceptual Request Flows` should move after the contracts it depends on, or be explicitly marked as illustrative until the contracts are decided.
- `20`, `21`, and `22` should be treated as lifecycle and resilience topics under runtime/orchestration instead of separate top-level pillars.

## Initial Contradictions and Tension Points

- The document says no final architecture decisions are made, but several items read like decisions: Gateway V2 replaces Gateway, unified Registry, Bridge concept, local SQLite, and cloud-hosted connectors. These should be relabeled as `proposed`, `assumed`, or `confirmed`.
- The Gateway is shared by both cloud and local runtimes, but local access may also go through Bridge. The architecture must decide whether Bridge proxies Gateway or only grants selected cloud capabilities.
- The unified Registry is meant to index many resource types, but it must not become an execution runtime or context compiler. Its ownership boundary needs a precise contract.
- The Context Worker needs registry, connector, memory, permissions, transcript, and runtime policy inputs, but it must not become the canonical owner of those systems.
- The local runtime should operate independently, but some capabilities are cloud-only. The minimum offline behavior needs to be explicit.
- System MCP servers are required even when user MCP libraries are empty. The architecture needs a trust and ownership taxonomy so system MCP is not confused with user-installed MCP.
- Agent definitions are declarative, but run-specific overrides are dynamic. The versioning and reproducibility contract must define what is pinned to a run.
- Tool discovery is intended to reduce schema bloat, but permissions still need runtime enforcement before execution.
- The tracker is deferred, but observability and recovery require a minimum event model before refactoring starts.
- Bridge risks becoming the general backend API that the source brief says to avoid.
- Architectural symmetry may over-constrain implementation. Cloudflare Workers and a local Tauri or sidecar runtime may need different operational mechanics even if the conceptual contracts match.
- Cloud/local child-agent behavior is high risk and should probably be excluded from the first implementation unless a required workflow depends on it.
- Durable Objects, queues, Workflows, WebSockets, and event logs remain open. Those decisions block credible streaming, resume, and run-state design.

## Decision Candidate Labels

Use these labels while processing the source brief:

- `Confirmed`: A requirement already accepted as architectural direction.
- `Proposed`: A likely direction that still needs review.
- `Assumption`: A working belief that may be replaced.
- `Constraint`: A non-negotiable boundary or dependency.
- `Deferred`: A topic intentionally excluded from the first architecture pass.
- `Rejected`: A path the architecture explicitly will not take.

Initial label suggestions:

| Source idea | Suggested label | Note |
|---|---|---|
| Cloud and local are separate runtime categories | Confirmed | Foundational to the brief |
| Cloud/local conceptual symmetry | Confirmed | Implementation may differ |
| Gateway remains narrow | Confirmed | Needs exact contract |
| Gateway V2 replaces old Gateway | Proposed | Requires parity proof |
| Unified Registry | Proposed | Needs ownership and scope contract |
| Local SQLite persistence | Assumption | Embedded persistence required; exact store not final |
| Bridge for local cloud access | Proposed | Could be service, facade, or client contract |
| Connectors remain cloud-hosted | Proposed | Strong security rationale, but still should be confirmed |
| Tracker redesign deferred | Confirmed | Minimum observability still required |

## Suggested Immediate Next Artifact

Create an `Architecture QA Workbook` from this structure with four live sections:

1. `Confirmed Requirements`
2. `Open Questions`
3. `Decisions`
4. `Derived Artifacts`

Each answered question should add or update a decision, then update the relevant derived artifact. This prevents the QA process from becoming another long static brief.
