# Studio Runtime Mental Model - Temporary

This document is a temporary working reference for the Studio cloud/local runtime architecture. It separates confirmed decisions, current recommendations, and remaining implementation details so implementation can proceed without treating every discussion point as final by accident.

## Decision Status

Confirmed decisions:

- Studio Data is the authoritative source for user-facing conversation data.
- Frontend transcript state is optimistic/rendering state, not durable truth.
- The Context Engine retrieves canonical transcript/projection data from Studio Data, not from a client-submitted transcript.
- The Context Engine constructs model-facing context but does not own callable tool registration.
- The Tool Pool is a separate worker from the beginning.
- The Tool Execution Worker stays on-demand and only executes explicit selected tool calls.
- Cloud Studio remains intentionally smaller than the future local/coding runtime.
- Cloud edits and regenerations use internal revisioning without exposing full branch navigation initially.
- Artifacts and transcripts are canonical platform-independent protocols first, then cloud and local persistence adapters implement those protocols separately.
- Studio shares schemas, contracts, validation rules, deterministic domain logic, and conformance tests across cloud and local. It does not share Cloudflare worker implementation code as the desktop runtime.
- Artifact versioning uses a stable artifact root plus separate version records. The root represents the logical artifact; versions represent each concrete revision/payload.

Current recommendations:

- Persist the active transcript projection, but keep canonical events as the rebuild source.
- Store Context Engine internal baseline/snapshot metadata in Context Engine-owned D1 tables.
- Store large context snapshots or compressed payloads in Context Engine-owned R2 when needed.
- Use KV only for short-lived non-authoritative acceleration, not as the source of truth.
- Rename the current expand-tool concept into Tool Pool discovery and resolution tools.

## Product Split

Studio has one shared conceptual model, but the cloud and local products expose different capabilities.

Cloud Studio is intentionally limited. It supports normal conversation, text and vision input, uploaded files, PDFs, documents, images, connectors, web search, image generation, artifacts, memory, tool discovery, and cloud agent execution. It does not support arbitrary local file access, repository editing, shell execution, code patches, or coding-harness behavior.

Local Studio may later support local files, terminal execution, repository state, code patches, richer permissions, local MCP servers, sub-agents, and detailed execution traces. The cloud implementation should reserve extensibility for those concepts without implementing unnecessary local-only functionality.

## Cloud And Local Sharing Boundary

Studio should use the hybrid architecture:

- Define artifact schemas, transcript schemas, tool contracts, context payload contracts, lifecycle states, event semantics, ordering rules, validation rules, and deterministic projection logic as platform-independent protocols.
- Keep cloud workers independently deployable. Cloud workers own Cloudflare-specific infrastructure such as D1, R2, Durable Objects, service bindings, worker routing, cloud authentication, and service-to-service identity.
- Keep the future desktop runtime as bundled local modules. Desktop modules own SQLite, local filesystem access, local IPC, local MCP processes, local credentials, terminal execution, and local permission enforcement.
- Do not copy the whole cloud worker implementation into desktop and permanently fork it.
- Do not turn every worker into one large shared runtime package.
- Share only stable domain logic and contracts where drift would be dangerous, and validate both cloud and local implementations with the same conformance tests.

For the immediate implementation, artifacts and transcripts should be designed as canonical protocols that can represent both cloud and future local events. The cloud implementation should initially implement only cloud-needed artifact and transcript types. Local-only coding events, terminal events, file edits, patches, repository state, and workspace permissions remain reserved protocol extensions until the local runtime phase.

## Core Components

The architecture separates four responsibilities:

1. Canonical Transcript: durable record of what happened.
2. Context Construction: temporary model-facing context derived from transcript, memory, files, artifacts, registry, and capability metadata.
3. Tool Pool Worker: owns callable capabilities, tool discovery, namespaces, availability, scope filtering, ranking, and schema materialization.
4. Tool Execution Worker: executes or routes an explicit tool call after an agent selects it.

The Context Engine remains the broader context-construction boundary, but it should not own callable capability registration or discovery. The Tool Pool should be a separate worker from the beginning.

## Canonical Transcript

The canonical transcript is the source of truth. It is not the same thing as the frontend transcript and it is not the same thing as the model context. Studio Data owns the canonical transcript and the active transcript projection.

Cloud transcript events should support:

- user messages
- assistant messages
- planner messages
- runtime events
- tool calls
- tool results
- connector calls
- connector results
- web search results
- image-generation results
- attachment references
- artifact references
- memory references
- context summaries
- interruptions
- retries
- edits
- branch creation

Coding-specific events such as terminal commands, repository edits, patches, and local file reads are reserved for local Studio and should not be implemented in the cloud model now.

## Turn Model

A user turn is the unit of intent. A turn may contain a user message, uploaded files, planning, tool discovery, one or more tool calls, connector results, generated outputs, artifact changes, assistant output, retries, edits, interruptions, and final completion state.

The transcript must preserve which events belong to the same turn, which result belongs to which call, which artifact was created by which operation, and which assistant message is the final visible answer.

Cloud conversations remain linear in the user interface for now. Internally, edits and regenerations are represented through revisions rather than destructive overwrites. The original revision remains stored, and the newest active revision is used by the active transcript projection.

Revision-aware records should include a stable logical message or event identifier, a unique revision identifier, a revision number, an optional previous revision identifier, an active or superseded status, storage schema version, timestamps, and revision-specific attachment or artifact references.

## Model-Facing Context

The model-facing context is derived from the canonical transcript. It may omit, summarize, compress, reference, or transform events.

The recommended context order is:

1. runtime-owned base system prompt
2. agent or planner system prompt
3. stable Studio environment context
4. stable capability guidance
5. available skill, MCP, connector, and tool summaries
6. conversation-specific instructions
7. relevant memory and user profile context
8. selected attachment, artifact, and file context
9. selected transcript history
10. current user input
11. materialized tool schemas

The runtime owns the base system prompt and agent loop. The Context Engine provides the contextual package and metadata needed by the runtime.

## Tool Pool Worker

The Tool Pool Worker owns callable capability availability and discovery. It should support:

- native tools
- MCP tools
- connector tools
- skill access tools
- agent delegation tools
- runtime actions exposed as tools
- system-scoped capabilities
- future user-scoped capabilities
- namespaces and conflict handling
- metadata search
- availability checks
- filtering and ranking
- source inventory refresh
- agent-specific eligibility
- duplicate handling
- tool version tracking
- lazy schema materialization
- tool-discovery support

The Context Engine may ask the Tool Pool for a curated default toolset and compact capability projection. It should not ingest every raw tool schema or own the complete catalog.

During execution, runtimes may call the Tool Pool directly to search, filter, resolve, and materialize additional tool definitions. Dynamic discovery should not require rebuilding the entire context package through the Context Engine.

Only callable resources belong in the Tool Pool. Non-callable context such as agent instructions, model configuration, memory content, transcript state, artifact references, conversation metadata, system policies, user profile context, and context baselines belongs in the Context Engine or its source systems.

## Tool Execution

The Tool Execution Worker is on-demand. It does not decide which tools the model sees and does not construct context. It receives an explicit selected tool call, validates/routes it, executes or forwards it to the owning service, and returns a structured result.

The Tool Pool discovers and materializes tools. The Tool Execution Worker executes selected tools.

## Artifacts And Attachments

Artifacts and transcripts should be designed separately first. An artifact is a durable user-facing object or activity representation. A transcript event records that something happened and may reference one or more artifacts. The artifact system should not be derived from transcript storage details, and the transcript should not inline large artifact payloads.

Confirmed UI direction: artifacts render inline in the chat transcript at the exact position where they occurred. A right-side area may later become an overview/workspace for conversation resources, but it is not the primary artifact rendering model and should not drive the backend contract now.

The frontend should not infer artifacts from plain assistant text. Studio Data must store structured artifact references/events in the transcript so the frontend can reconstruct a sequence like:

1. user message
2. assistant text
3. activity artifact
4. permission artifact
5. connector artifact
6. assistant response
7. generated-media artifact

All artifact types use one canonical envelope. The payload and renderer vary by artifact family, but lifecycle, ownership, IDs, provenance, versioning, storage references, and validation stay consistent.

Artifact envelope:

- `artifact_id`: stable ID for the artifact.
- `artifact_version_id`: stable ID for the concrete artifact version.
- `user_id`: required owner. Every artifact is user-scoped.
- `conversation_id`: optional parent conversation.
- `turn_id`: optional user-turn owner for inline placement.
- `message_id`: optional visible-message relationship.
- `execution_id`: optional runtime execution/run relationship.
- `tool_call_id`: optional tool-call relationship.
- `permission_request_id`: optional permission relationship.
- `family`: semantic artifact family.
- `type`: concrete artifact type within the family.
- `schema_version`: artifact schema version.
- `renderer_version`: minimum frontend renderer contract version.
- `version`: artifact version number.
- `status`: lifecycle status.
- `visibility`: `user_visible`, `internal`, or `debug`.
- `placement`: inline transcript placement metadata, including `event_id`, `sequence`, and optional `after_event_id`.
- `title`: short user-facing title.
- `summary`: optional user-facing summary.
- `model_presentation`: model-authored display text, labels, descriptions, and intent.
- `runtime_data`: runtime-authored IDs, execution refs, provider refs, dimensions, timestamps, source URLs, tool names, connection IDs, storage IDs, hashes, and errors.
- `payload_ref`: optional object-storage reference for large payloads.
- `preview_ref`: optional preview/thumbnail/reference payload.
- `created_by_event_id`: transcript event that created or first referenced the artifact.
- `updated_by_event_id`: latest transcript event that changed the artifact.
- `previous_artifact_id`: previous version or predecessor when applicable.
- `created_at`, `updated_at`, `completed_at`, `failed_at`.

Artifact lifecycle states:

- `planned`: model/runtime intends to create it but no execution has started.
- `proposed`: operation has been proposed and may require user confirmation.
- `awaiting_permission`: permission approval is required before execution.
- `running`: operation is in progress.
- `streaming`: incremental output is arriving.
- `waiting_for_input`: user confirmation or missing input is required.
- `completed`: final payload or result is available.
- `failed`: operation failed.
- `cancelled`: operation was cancelled.
- `rejected`: user denied the permission request or proposed operation.
- `partial`: partial result is available but work did not fully complete.
- `superseded`: replaced by a newer version.

Artifact storage model:

- `artifact_roots`: one row per logical artifact with owner, conversation, family, current version, visibility, status, and high-level title/summary.
- `artifact_versions`: one row per concrete artifact revision with payload references, model presentation, runtime data, provenance, status, and timestamps.
- `artifact_events`: optional lifecycle/event table when an artifact needs progress updates independent of transcript events.
- `storage_objects`: R2 payload metadata for large artifact bodies, previews, thumbnails, generated files, and exports.

Artifact update model:

- The artifact root is stable.
- Each durable revision writes an `artifact_versions` row.
- Small lifecycle/progress changes may write `artifact_events` without creating a new payload version.
- The active transcript projection renders the current artifact state at the original inline placement unless a later transcript event intentionally references a newer version.
- Streaming/progress updates can be represented as artifact events and compacted into the latest display snapshot for renderable projections.
- Updates must be idempotent by `idempotency_key` or by a stable tuple such as `(user_id, artifact_id, execution_id, tool_call_id, sequence)` to avoid duplicate inline artifacts on retries.

Model-authored fields are limited to presentation and intent: title, summary, user-facing step descriptions, requested output intent, draft prose, search intent, and similar UI text. Runtime-authored fields are authoritative for operational truth: tool names, connector IDs, execution IDs, timestamps, result IDs, URLs, file IDs, storage object IDs, dimensions, hashes, provider names, status transitions, errors, and completion metadata. The model must not be trusted to invent runtime facts.

Model-facing artifact proposal format:

The LLM should not create persisted artifact records directly and should not choose technical renderer categories. It may emit a constrained proposal that the runtime normalizes:

```json
{
  "action": "create_or_update_artifact",
  "presentation_intent": "activity | research | generated_media | connector_record | connector_action | permission | file | structured_data",
  "title": "Short user-facing title",
  "summary": "Optional concise summary",
  "activity_label": "Optional progress label",
  "body": "Optional user-facing content",
  "fields": {},
  "requires_permission": false
}
```

Runtime classification rules:

- The runtime determines final artifact `family`, `type`, lifecycle status, renderer hint, and trusted operational fields.
- Classification uses selected tool, tool route, permission policy, execution result, connector app/action, output content type, and runtime state.
- The model's `presentation_intent` is advisory and can be downgraded, corrected, or rejected.
- Invalid model-authored fields are sanitized or dropped; invalid runtime-authored fields fail validation.

Permission integration:

- Permission requests may be the first visible state of an artifact.
- Proposed side-effectful operations create an artifact in `proposed` or `awaiting_permission`.
- User approval updates the same artifact to `running`, then `completed`, `partial`, or `failed`.
- User denial updates the same artifact to `rejected`.
- Permission decisions need durable records with `permission_request_id`, `artifact_id`, `user_id`, `conversation_id`, `tool_call_id`, decision, decided_by, decided_at, and reason when available.
- Connector write actions, email sends, calendar updates, destructive changes, and future local file/terminal operations must not rely on model text as proof of permission.

Transcript integration:

- `artifact_created`, `artifact_updated`, `artifact_completed`, `artifact_failed`, and `artifact_permission_requested` should be explicit transcript event kinds or structured `artifact_reference` events with lifecycle subtypes.
- Transcript events store artifact IDs, version IDs, placement, and compact display metadata.
- Large payloads stay behind `storage_objects` or artifact payload references.
- The renderable transcript projection resolves inline artifact cards from artifact metadata plus current display snapshot.
- The model-facing context may include artifact summaries, selected payload content, or references depending on relevance and budget.

Security and privacy rules:

- Every artifact, artifact version, artifact event, payload reference, permission record, and transcript reference is user-scoped.
- Connector artifacts must redact provider tokens, raw credential data, hidden account IDs, and sensitive operational metadata from model-visible and frontend-visible fields.
- Runtime data may contain internal references, but only safe subsets should be exposed to the model or UI.
- Deleting a conversation must delete or detach user-owned inline artifacts according to the retention policy selected for that artifact family.

Initial cloud artifact families:

1. `activity`
   General activity/progress artifact for grouped execution cycles. It can represent "Searching memory", "Preparing the image request", "Checking calendar availability", or "Applying connector update". It should group low-level tool calls into a readable progress story without exposing every internal tool name. It may complete with only a compact status.

2. `research`
   Web search, web fetch, Firecrawl, and other source-review flows. It should track query/intention, fetched pages, reviewed sources, source status, result snippets, citations, summaries, and source payload references.

3. `generated_media`
   Image generation, image editing, and video generation. It should reserve output geometry/aspect ratio when known, track prompt/intention, provider/job IDs, progress, generated media object IDs, preview/thumb references, dimensions, duration, and final media references.

4. `connector_record`
   User-visible records retrieved or produced by connectors. Reusable shapes include message, thread, draft, calendar event, schedule, contact, file, document, spreadsheet, issue, ticket, task, CRM record, design asset, map/place, and database record.

5. `connector_action`
   Connector-side effects and confirmations. It should represent actions such as sent email, created event, updated task, archived message, updated CRM record, or posted Slack/Teams message. Rich confirmation is used when the user needs to inspect the result; compact confirmation is enough for background operations.

6. `file`
   Uploaded files, generated documents, PDFs, images, videos, transformed files, and exported reports. The artifact metadata records relationship and preview information; the binary payload stays in object storage.

7. `structured_data`
   Tables, JSON outputs, CSV-like data, extracted entities, comparison matrices, retrieval summaries, and other machine-readable results that may need a table or structured viewer.

Reserved future local families:

- `code_change`
- `terminal_session`
- `repository_state`
- `diagnostic`
- `local_file_operation`

These are part of the platform-independent protocol space, but the cloud implementation should not implement local file, patch, terminal, or repository behavior now.

Cloud capability classification:

- Native image generation -> `generated_media.image`.
- Native image editing -> `generated_media.image_edit`.
- Native video generation -> `generated_media.video`.
- Native web search -> `research.web_search`.
- Native web fetch -> `research.web_fetch`.
- Native RAG/retrieval -> usually `activity` or `structured_data` only when the result is user-visible and reusable.
- Native HTTP utility -> usually no visible artifact unless it produces a user-facing fetched resource, then classify by semantic result.
- Memory search/retrieval -> `activity` by default. Use a compact `connector_action`-like confirmation only for explicit user-visible memory write, update, or deletion. Do not create a visual artifact for silent context retrieval.
- MCP tools -> no generic MCP artifact. Classify by semantic result, because MCP is an execution mechanism.
- Skill tools -> no generic skill artifact. Reading or resolving a skill is usually `activity`; skill output is classified by its result.
- Agent delegation -> `activity` by default, with child execution progress/results linked through transcript events and optional artifacts created by the delegated work.

Curated connector classification:

- Gmail and Outlook: messages, threads, drafts, attachments, search results, and send confirmations use `connector_record` or `connector_action`. Label/archive/read-status actions use compact `activity` or compact confirmation.
- Google Calendar and calendar-like scheduling: events, schedules, availability, attendee lists, invitations, create/update confirmations use `connector_record.calendar_event`, `connector_record.schedule`, or `connector_action`.
- Slack, Microsoft Teams, Discord-like communication, Intercom conversations, Zendesk conversations: messages, threads, channels, tickets/conversations, drafts, and send/reply confirmations use reusable message/thread/action families. Low-level admin actions use `activity`.
- Google Drive, OneDrive, Dropbox: files, folders, search results, previews, and generated/exported files use `file` or `connector_record.file`. Move/rename/share confirmations use compact `connector_action`.
- Google Docs, Google Sheets, Notion, Airtable: documents, pages, spreadsheet ranges, databases, records, and extracted structured views use `file`, `structured_data`, or `connector_record`. Minor metadata updates use compact confirmation.
- GitHub, Linear, Jira, Trello, Asana, ClickUp: issues, tasks, cards, PRs, projects, board/list views, and workflow updates use `connector_record` and `connector_action`. Cloud Studio should represent the record/action but not implement local coding-harness transcript events.
- HubSpot and Salesforce: contacts, companies, deals, leads, CRM records, engagement history, and update confirmations use `connector_record.crm_record` and `connector_action`.
- Figma and Canva: design files, assets, frames, comments, and previews use `connector_record.design_asset`, `file`, or `structured_data` depending on payload.
- Google Maps: places, routes, geocoding results, and location lists use `connector_record.place` or `structured_data`.
- Firecrawl: crawled pages and extracted web content use `research.web_fetch` or `research.crawl`.
- Supabase: projects, tables, query results, and database records use `structured_data` or `connector_record.database_record`; administrative confirmations use compact `connector_action`.

Action-level rule:

Dedicated visual artifacts are justified when the user needs to inspect, confirm, compare, reuse, or open the result. Reuse an existing artifact family when the result shape matches message, thread, draft, calendar event, schedule, contact, file, issue, ticket, CRM record, design asset, place, or structured data. Use the general `activity` artifact when the operation is internal, temporary, low-detail, or only needs a simple success/failure indication. Use no visible artifact for invisible context preparation that should only appear in audit/runtime transcript events.

Artifact and attachment metadata belong in the transactional database. Large payloads belong in object storage. The transcript stores artifact and attachment references, not necessarily their full payloads. The Context Engine decides when to include full content, summaries, metadata, or references in model context.

## Storage Ownership

Use transactional storage for users, conversations, turns, immutable events, message revisions, active transcript projections, tool calls, registry records, artifact metadata, and current user-facing state.

Use object storage for uploaded files, generated files, images, PDFs, documents, and large artifact payloads.

Use vector or search indexes for memory, document retrieval, transcript search, and semantic discovery.

Use analytics/event storage for telemetry, traces, latency, usage, model performance, and tool performance. Analytics storage is not the canonical source of truth.

Studio Data owns user-facing conversation data, including canonical transcript events, revisions, and active transcript projections.

The Context Engine owns its internal state separately, including context baselines, compaction snapshots, context-construction records, and resource-resolution state. These records should not be stored in Studio Data merely because Studio Data has an R2 bucket.

Context Engine storage should use:

- D1 for durable, queryable baseline/snapshot metadata and context-construction records
- R2 for large compressed context payloads or snapshots when they exceed comfortable database size
- KV only for short-lived cache entries that can be safely recomputed

If a single first storage choice is required, use Context Engine-owned D1. Add R2 only for large payloads and KV only as an optimization.

The frontend may keep an optimistic active transcript for rendering, but it is not authoritative. When a conversation loads, it should retrieve the active projection from Studio Data. Runtime execution should identify the conversation and rely on Studio Data's canonical transcript/projection rather than trusting an arbitrary client-submitted transcript.

The frontend sends the new user input, attachment identifiers, conversation identifier, and client-side render state hints if needed. It does not send the authoritative transcript for model execution.

## Studio Data Decisions

Studio Data should remain a focused storage and retrieval worker. Its job is to create and maintain resource identifiers, store resources in the correct bucket, maintain metadata and ownership relationships, validate access, and return either resource data or resource references to trusted callers such as the Context Engine, runtimes, API worker, or frontend.

Every durable resource needs its own stable identifier even when it belongs to a conversation. A conversation has a `conversation_id`, but uploaded files, generated files, artifacts, attachment records, transcript events, tool calls, and stored outputs each need their own IDs. Conversation membership is a relationship, not the resource identity.

Bucket ownership:

- `CONVERSATIONS`: durable conversation exports or large conversation-adjacent payloads that should not live directly in D1.
- `UPLOADS`: user-provided files, including documents, PDFs, images, audio, video, and other attachments.
- `GENERATED`: generated or transformed outputs, including generated images, videos, documents, reports, and artifact payloads.

Compression:

- Use application-level compression for large text-like R2 payloads.
- Use `gzip` as the initial required storage compression format because it is natively available through standard Worker-compatible compression APIs.
- Do not implement Zstd in the Worker path now. Zstd would require an additional library or WASM path for application-level compression/decompression, which adds bundle, memory, operational, and local-development complexity.
- Use only `compression: gzip | none` in Studio Data. Do not include unused Zstd behavior in the implementation contract.
- Do not compress normal D1 metadata, transcript indexes, active projections, or small artifact records.
- Compress large generated documents, exported transcript segments, large tool outputs, large text artifacts, and large context snapshots before storing them in R2.
- Keep compression/decompression inside Studio Data or the owning service, not the frontend.

Encryption:

- Do not implement custom encryption/decryption in Studio Data by default.
- Rely on Cloudflare platform encryption for R2/D1 at rest, plus strict user-scoped access control and service-to-service identity.
- Add application-level encryption only later for a specific high-sensitivity feature that requires Studio-managed keys, per-user keys, or end-to-end encryption.
- If application-level encryption is introduced later, store encryption metadata on the resource record and keep key management outside ordinary object routing logic.

Studio Data should not become a media processor, artifact renderer, context engine, tool executor, or analytics store.

## Transcript Mechanism

Studio should use one canonical transcript style, not multiple unrelated transcript formats. It should be Claude-inspired in structure: append-oriented records, explicit event types, parent/turn links, and separate side payloads for large results. The difference is that Studio should formalize the sections up front instead of letting each event shape drift.

Canonical transcript layers:

1. D1 event index: small, queryable, append-only records with IDs, ordering, ownership, visibility, status, type, turn links, revision links, and references to side payloads.
2. D1 active projections: renderable/model/audit projections for the active branch, kept uncompressed for fast reads.
3. R2 transcript segments: immutable gzip-compressed JSONL or JSON segment payloads for older or large transcript ranges.
4. R2 side payloads: large tool results, connector outputs, generated files, artifacts, long documents, and context snapshots.
5. D1 segment manifest: maps event ranges and payload IDs to R2 objects, compression metadata, hashes, and ordering.

The transcript should be sectioned by event kind rather than stored as one visible chat stack. Sections are logical, not separate transcript systems:

- conversation section: user, assistant, planner, system-visible messages
- runtime section: run status, interruptions, retries, edits, branch markers
- tool section: tool calls, arguments, results, errors, execution metadata
- resource section: attachments, artifacts, generated outputs, connector results, web/image-generation results
- context section: memory references, context summaries, model projections, compaction/snapshot references
- audit section: internal-only lifecycle, routing, and diagnostic events

Active conversations:

- Recent active events and active projections stay in D1 uncompressed.
- The active/open segment can accumulate events without recompressing the full transcript.
- Large payloads are immediately written as separate R2 side payloads and referenced from the D1 event.
- Sealed segments are gzip-compressed and immutable.

Inactive or large conversations:

- Seal open segments after size, event-count, manual, or inactivity thresholds.
- Initial thresholds: seal after 200 events, approximately 1 MiB of accumulated uncompressed event content, or 24 hours of segment inactivity unless a caller provides a different inactivity threshold.
- Create periodic snapshots or context summaries after meaningful growth.
- Keep enough D1 index data to locate relevant ranges without reading every R2 object.
- Rebuild projections from D1 active events plus R2 segments only when needed.

Transcript integrity:

- Every event has a monotonically increasing `sequence` per conversation/branch.
- Every sealed segment stores `first_sequence`, `last_sequence`, `event_count`, `content_hash`, `compression`, `compressed_size_bytes`, and `uncompressed_size_bytes`.
- Revisions supersede prior logical messages without deleting the old revision.
- Tool results and artifact versions reference the event that created them.

## OpenCode Lessons Adopted

Studio should adopt the following ideas from OpenCode:

- event/projector-style transcript thinking
- context baseline or snapshot behavior for prompt caching
- tool materialization as a distinct step
- namespaced MCP tools
- simple portable SKILL.md skill format
- primary, planner, subagent, and hidden/system agent categories
- permission and availability filtering before tool exposure

Studio should not copy OpenCode's local coding-harness details into the cloud runtime.

## Runtime Flow

The initial cloud flow is:

1. The frontend sends a user message and attachment identifiers.
2. Studio Data persists the user event/revision and updates the active transcript projection.
3. The execution or planner runtime requests a context package from the Context Engine.
4. The Context Engine retrieves the canonical active transcript/projection from Studio Data.
5. The Context Engine retrieves memory, agent/model configuration, artifact metadata, attachment metadata, and internal context baseline state.
6. The Context Engine requests a curated default toolset and compact tool projection from the Tool Pool.
7. The Context Engine assembles the ordered runtime context package.
8. The runtime sends the model request with the default materialized tools.
9. If the model needs more tools, the runtime calls the Tool Pool directly.
10. The Tool Pool searches, filters, ranks, resolves, and materializes selected tool schemas.
11. The runtime adds newly materialized tools to the active execution state.
12. When the model calls a tool, the runtime sends that explicit call to the Tool Execution Worker.
13. Tool results are persisted back through Studio Data as transcript events and returned to the runtime.
14. The final assistant response is persisted, the active projection is updated, and the frontend receives the renderable projection/update.

## Current Implementation Status

Implemented or mostly scaffolded:

- Studio Data has conversations, uploads, artifacts, transcript events, revision-aware event fields, active transcript projections, model/renderable/projection/turn endpoints, and artifact version metadata.
- Context Engine builds context packages from Studio Data and requests default capability projections from Tool Pool.
- Tool Pool is a separate worker with default `discover_tools` and `resolve_tool`, registry inventory, connector inventory, discovery, and resolve endpoints.
- Tool Execution Worker exists as the on-demand selected-tool execution boundary.
- Execution, Planner, and Agent runtimes have Durable Object scaffolds, Context Engine handoff, Tool Pool discovery/resolve, active resolved-tool caching, Tool Execution dispatch, and transcript-event persistence.
- Registry, Skill Library, MCP Library, and Agent Library have basic system/user-scoped structures.
- Gateway provider routing exists.
- API worker has newer `/studio/*` route modules for runs, conversations, data, registry, gateway admin, and health.

Partial or incomplete:

- Studio Data now has the storage model, managed object metadata, gzip metadata, side payloads, active transcript projections, transcript segment sealing, canonical artifact roots/versions/events/permission decisions, inline artifact transcript event kinds, user-scoped ownership validation, static contract verification, and local Wrangler integration verification. It still needs compatibility cleanup around older `messages` and `transcript_records` paths plus production upgrade migrations for already-deployed databases.
- Context Engine is structurally correct but does not yet fully resolve attachment contents, artifact contents, memory retrieval, context budgeting, summarization, provider-neutral message parts, or durable baseline usage.
- Tool Pool is basic; ranking, permission/eligibility filtering, source refresh, conflict handling, version handling, and health/availability checks are incomplete.
- Tool Execution has several placeholder dispatch paths, especially connectors, native cloud tools, memory tools, and local relay.
- Runtimes do not yet run a real Gateway-backed model loop.
- API WebSocket forwarding is not fully wired, and runtime `/ws` still returns not implemented.
- The API README is stale compared with the actual `/studio/*` implementation.

Not ready:

- Artifact format and artifact rendering system.
- Full cloud request pipeline from frontend to model to tools to streamed response.
- Frontend integration with the new cloud transcript/context/runtime model.
- Cloud deployment, because new D1 bindings still need real Cloudflare IDs.
- Local runtime architecture and `/studio/local` or `/studio/bridge` API namespace.

Current priority:

Finish simpler independent foundations before touching Gateway, the real model loop, or end-to-end runtime flow. Studio Data should be reviewed and completed first because Context Engine, artifacts, frontend transcript loading, and runtime persistence depend on it.

## Next Phase Plan: Studio Data And Transcript Storage

This phase should be implemented in small steps, but all of it belongs to the current implementation path.

Step 1: Resource identity contract.

- Define stable ID prefixes and ownership rules for conversations, turns, events, message revisions, projections, attachments, artifacts, artifact versions, storage objects, transcript segments, tool calls, tool results, context snapshots, and generated outputs.
- Ensure every table and API response uses explicit IDs rather than relying on conversation IDs for child resources.
- Status: implemented for Studio Data conversations, attachments, artifacts, storage objects, transcript events, side payloads, projections, and transcript segments.

Step 2: Object metadata model.

- Add or normalize object metadata records for all R2 payloads.
- Track bucket, storage key, content type, logical resource type, owner user ID, conversation ID, size, hash, compression, and creation source.
- Use `compression: none | gzip` only.
- Status: implemented as `storage_objects`.

Step 3: Gzip helpers.

- Add Studio Data helpers for gzip compression and decompression of text-like R2 payloads.
- Keep binary uploads uncompressed unless explicitly marked as compressible.
- Store compressed and uncompressed byte counts.
- Status: implemented for managed R2 objects with `compression: none | gzip`.

Step 4: Transcript segment manifest.

- Add D1 tables for transcript segments.
- Track conversation, branch, first/last sequence, event count, R2 object reference, compression, byte counts, hash, sealed/open status, and timestamps.
- Status: implemented as `transcript_segments`.

Step 5: Append event API hardening.

- Make event append responsible for stable sequence assignment, revision status, active projection update, optional segment assignment, and idempotency.
- Keep the active projection uncompressed in D1.
- Status: implemented for sequence assignment, revision superseding, segment assignment, projection rebuilds, retry-safe segment accounting, and retry preservation of existing side payload references.

Step 6: Side payload API.

- Add APIs for writing and reading large side payloads, including large tool results, connector results, generated text artifacts, and large context snapshots.
- Transcript events should reference side payload IDs instead of embedding large content.
- Status: large event content is externalized to `transcript_side_payloads`, `/transcripts/payloads/:id` can retrieve it, and newly created side payloads are cleaned up if event append fails.

Step 7: Segment sealing.

- Add logic to seal and gzip transcript segments based on size, turn count, or inactivity.
- Do not recompress the complete conversation after every turn.
- Status: event-count, size, manual, and inactivity sealing endpoints are implemented.

Step 8: Retrieval APIs.

- Provide APIs for active projection, model projection, renderable projection, turn reconstruction, segment lookup, side payload lookup, and full transcript export.
- Context Engine should use active/model projection first and fetch segments or side payloads only when needed.
- Status: implemented, including full transcript export.

Step 9: Migration cleanup.

- Decide how `messages`, `transcript_records`, and `conversation_events` coexist during transition.
- Keep compatibility reads temporarily, but make `conversation_events` plus projections the canonical path.
- Status: current-schema migration added as `Backend/Cloud/data/migrations/0001_current_schema.sql`. Legacy compatibility tables still exist; a production upgrade migration from older deployed schemas remains separate from the fresh-schema path.

Step 10: Verification.

- Add tests or scripted checks for append ordering, revision superseding, projection rebuild, gzip round trip, segment sealing, side payload retrieval, and user isolation.
- Status: static contract verification and local Wrangler integration verification are implemented. The integration flow uses isolated temp D1/R2 state and covers conversation creation, user isolation, transcript event append, idempotent retry, large side payload externalization/retrieval, manual segment sealing, transcript export, and conversation deletion cleanup.

## Decisions Still Open

These are the remaining architecture decisions that should be settled before the first end-to-end cloud runtime test:

1. The migration strategy for existing conversations, `messages`, and legacy `transcript_records`.
2. The first minimal default tool set for the execution runtime and planner runtime.
3. The final name and behavior of the current expand tool now that discovery belongs to the Tool Pool.
4. The exact naming of capability tiers and discovery/materialization responses.
5. How strict provider-neutral message parts should be in the first version.
6. Which pieces must be implemented before the first end-to-end cloud runtime test.

## Remaining Implementation Tracker

This tracker is the source of truth for what remains before the first serious cloud end-to-end test. Work should move from independent foundations toward the interconnected runtime path.

Temporary implementation rule: while the system is not deployed, continue completing architecture, schemas, backend logic, integrations, frontend structures, and documentation that can be finished statically. Deployment, live runtime validation, end-to-end testing, and final verification are deferred to the final validation phases instead of blocking implementation progress.

Status labels:

- `done`: implemented and locally verified.
- `implementation-complete`: implementation is present, but final verification is intentionally deferred.
- `partial`: basic implementation exists, but important behavior is missing.
- `next`: recommended immediate phase.
- `pending`: not started or not ready to integrate.
- `blocked`: waiting on a decision or upstream dependency.

### Phase 1: Studio Data Foundation

Status: `done`

Scope:

- Resource IDs for conversations, attachments, artifacts, storage objects, transcript events, side payloads, projections, and transcript segments.
- R2 bucket routing for conversations, uploads, and generated content.
- `gzip | none` compression metadata and helpers.
- Managed object metadata, hash verification, and cleanup.
- User-scoped ownership checks across records and APIs.

Done when:

- Studio Data can store, retrieve, verify, and delete user-owned content without cross-user access.
- `npm run verify` passes in `Backend/Cloud/data`.

Current status:

- Implemented and verified.

### Phase 2: Canonical Transcript Storage

Status: `done`

Scope:

- `conversation_events` as canonical event spine.
- Active transcript projections for renderable/model/audit views.
- Large side payload externalization.
- Transcript segment manifest and gzip sealing.
- Full export endpoint.
- Retry/idempotency behavior for event append.

Done when:

- Context Engine can retrieve model projection from Studio Data.
- Frontend can later retrieve renderable projection.
- Large results do not require rewriting the whole transcript.

Current status:

- Implemented and verified.

Remaining cleanup:

- Decide production migration strategy for older deployed `messages` and `transcript_records`.
- Keep legacy compatibility until frontend/runtime fully moves to canonical events.

### Phase 3: Artifact Backend Foundation

Status: `done`

Scope:

- Canonical artifact root/version/event model.
- Artifact lifecycle states.
- Runtime-authored data separated from model-authored presentation data.
- Artifact permission decisions.
- Artifact payload/preview storage through managed objects.
- Inline artifact transcript event kinds.

Done when:

- Studio Data can create, update, version, permission-gate, retrieve, and delete artifacts.
- Transcript events can reference user-owned artifacts safely.
- Cross-user artifact references are rejected.

Current status:

- Implemented and verified in Studio Data.
- Frontend inline renderers are not implemented yet.

### Phase 4: Context Engine Resource Resolution

Status: `done`

Scope:

- Resolve artifact references from model transcript.
- Resolve attachment references.
- Include safe text-like payload snippets.
- Keep images/files/binary payloads as references.
- Redact sensitive runtime metadata.
- Emit provider-neutral `resolved_resources` section.

Done when:

- Context Engine returns artifact/attachment metadata and safe content in the context package.
- Data calls remain user-scoped.
- `npm run verify` passes in `Backend/Cloud/context-engine`.

Current status:

- Implemented and verified.

### Phase 5: Provider-Neutral Message Contract

Status: `done`

Scope:

- Define the runtime-facing message part contract for model requests.
- Represent text, image references, file references, artifact references, tool calls, tool results, summaries, and current user input.
- Define what the Context Engine returns versus what runtimes lower into provider-specific formats.
- Preserve prompt-cache ordering.

Tasks:

1. Add a provider-neutral message/content part type in the Context Engine and runtime contracts.
2. Convert `sendable.sections` into a predictable model-input structure without losing sections.
3. Decide first-version handling for images and files: reference-only versus inline fetch handles.
4. Update Execution, Planner, and Agent runtime contracts to understand the same message-part shape.
5. Add static verification that Context Engine and runtimes agree on the contract.

Done when:

- Runtimes can consume Context Engine output without interpreting arbitrary section blobs.
- Gateway lowering can be implemented against one stable internal format.

Current status:

- Implemented as `studio.model-input.v1` on `sendable.modelInput`.
- Context Engine now converts ordered sections into provider-neutral messages, resources, cache plan metadata, and materialized default tool schemas.
- Images and files are reference-only in the first contract version; text-like artifact and attachment payloads may be included when explicitly resolved and budget-capped.
- Execution Runtime, Planner Runtime, and Agent Runtime each carry local compatible contract copies.
- Static verification checks the Context Engine contract, projection builder, reference-only file/image policy, and runtime contract copies.

Remaining follow-up:

- Provider-specific Gateway lowering is intentionally handled in Phase 10.
- Runtime model-loop code still needs to actively consume `sendable.modelInput` instead of only accepting it in the contract.

### Phase 6: Tool Pool Hardening

Status: `done`

Scope:

- Discovery and resolution already exist at a basic level.
- Needs permission/eligibility filtering, ranking, conflict rules, version metadata, availability status, health checks, and source refresh behavior.

Tasks:

1. Define capability tier names and response shape.
2. Add user/agent/runtime eligibility filtering.
3. Add namespace and duplicate-conflict rules.
4. Add availability/health metadata.
5. Add source refresh strategy for Registry and Connectors.
6. Verify default tools stay minimal: `discover_tools` and `resolve_tool`.

Done when:

- Runtime can reliably discover and materialize only allowed tools for a user/task/agent.

Current status:

- Implemented the Tool Pool hardening baseline.
- Projection responses now include source health for Tool Pool, Registry, and Connectors.
- Capability summaries now include eligibility status, ineligible reasons, tier, and conflict metadata.
- Discovery and resolution filter out ineligible capabilities.
- Planner requests now exclude non-default write/destructive executable tools from discovery.
- Source inventory failures degrade safely instead of breaking the whole projection.
- Default tools remain minimal: `discover_tools` and `resolve_tool`.
- Added Tool Pool static verification with `npm run verify`.

Remaining follow-up:

- Fine-grained agent-specific allowlists should be applied when Agent Runtime permission enforcement is implemented.
- Real connector/native/MCP availability checks can become richer once those services expose stable health contracts.

### Phase 7: Tool Execution Dispatch Completion

Status: `done`

Scope:

- Tool Execution Worker exists.
- Dispatch paths still need stable contracts for connectors, native cloud tools, memory tools, MCP tools, skill tools, and agent tools.

Tasks:

1. Define one tool-call request/response envelope.
2. Add connector dispatch through Connectors Worker.
3. Add native cloud tool dispatch contracts.
4. Add memory dispatch contract.
5. Add MCP dispatch contract.
6. Add skill and agent tool dispatch contracts.
7. Persist tool-call and tool-result transcript events through Studio Data.
8. Return artifact updates when tools create/update artifacts.

Done when:

- A selected tool call can be executed on demand and its result can be persisted and returned to the runtime.

Current status:

- Implemented the stable `studio.tool-execution.request.v1` and `studio.tool-execution.result.v1` envelopes.
- Tool Execution accepts either a direct route or a materialized tool descriptor containing a route.
- Agent Runtime, Skill Library, remote MCP, service-bound Studio MCP, Connector, Native Cloud Tool, and Memory dispatch paths are wired.
- Connector, Native Cloud Tool, and Memory dispatch now use explicit service-binding contracts.
- Tool-call and tool-result transcript events are written to Studio Data when a conversation ID is present.
- Result envelopes can return artifact update references when downstream tool results include artifact metadata.
- Idempotent completed/failed jobs replay without re-execution; in-progress replay returns a retryable duplicate response.
- Added Tool Execution static verification with `npm run verify`.

Remaining follow-up:

- Downstream Connectors, Native Tools, and Memory workers must implement the exact execution endpoints Tool Execution now calls.
- Transcript event persistence is best-effort for this phase so a completed upstream tool is not retroactively marked failed by a transcript write issue.
- Permission-gated artifact creation before side effects belongs to Phase 8.

### Phase 8: Runtime Artifact And Permission Flow

Status: `done`

Scope:

- Runtimes must create/update artifacts during execution.
- Permission-gated operations must create inline artifacts before side effects.

Tasks:

1. Define runtime-to-Data artifact creation/update helper.
2. Define model-facing artifact proposal format.
3. Normalize model proposal into runtime-authored artifact records.
4. Create `awaiting_permission` artifacts for side-effectful actions.
5. Persist permission decisions.
6. Update artifacts to `running`, `completed`, `failed`, `partial`, `cancelled`, or `rejected`.
7. Emit matching transcript artifact events.

Done when:

- Permission requests and artifact lifecycle states appear as structured transcript events, not plain text.

Current status:

- Runtime sessions now have a local artifact/permission helper in Execution Runtime, Planner Runtime, and Agent Runtime.
- Tool execution requests include the `studio.tool-execution.request.v1` envelope and the materialized tool descriptor.
- Side-effectful tools are gated before dispatch when the tool policy requires approval, or when the effect is `write` or `destructive`.
- Gated tool calls create a user-visible artifact in Studio Data with `awaiting_permission` status and a durable permission request ID.
- The model-facing artifact proposal is advisory only through `__studioArtifactProposal`; the runtime chooses the canonical artifact family, type, status, runtime data, and placement.
- Runtime emits structured transcript events for `artifact_permission_requested`, `artifact_completed`, and `artifact_failed`.
- Tool results that include artifact references are reflected into runtime artifact transcript events.
- Added runtime artifact-flow verification across Execution, Planner, and Agent Runtime.

Remaining follow-up:

- Approval/resume UI and the endpoint that turns an approved permission artifact into actual continued execution belong with Phase 9 and the API/frontend flow.
- Downstream tools may create their own richer artifact records later; the runtime currently handles permission-gating artifacts and artifact refs returned by Tool Execution.

### Phase 9: Runtime Event And Streaming Model

Status: `done`

Scope:

- Runtime event persistence and frontend streaming/replay.
- Visible/internal event separation.

Tasks:

1. Define runtime event envelope.
2. Decide WebSocket versus SSE for cloud streaming.
3. Add API worker route for starting runs and streaming events.
4. Support reconnect/replay from Studio Data or runtime event source.
5. Persist visible assistant output, internal runtime events, tool calls, tool results, and artifact events.

Done when:

- Frontend can start a run and receive ordered events without trusting local optimistic state as canonical.

Current status:

- Runtime sessions now emit `studio.runtime.event.v1` events with sequence numbers, visibility, timestamps, run IDs, and payloads.
- Runtime Durable Objects keep ordered event history in DO storage.
- Runtime Durable Objects broadcast live events to connected WebSocket clients.
- Runtime Durable Objects expose replay through `GET /events?after=<sequence>` for reconnects and non-WebSocket clients.
- Execution, Planner, and Agent runtime route surfaces proxy both `/ws` and `/events`.
- Event visibility is separated into `renderable`, `model`, `internal`, and `audit`.
- Approval resolution now updates the related Studio Data artifact permission decision and emits approval runtime events.
- External tool/client action resolution endpoints now emit structured runtime events instead of returning a silent placeholder.
- Added verification for runtime event envelope, WebSocket streaming, replay, broadcast, approval resolution, and route-level replay support.

Remaining follow-up:

- Public API Worker routing for these runtime streams belongs to Phase 11.
- Turning an approved permission into automatic resumed tool execution still needs the real model/tool loop in Phase 10.

### Phase 10: Real Model Loop And Gateway Lowering

Status: `implementation-complete`

Scope:

- Execution, Planner, and Agent runtimes need real model calls through Gateway.
- Provider-neutral context must lower into OpenAI/Anthropic/OpenAI-compatible request formats.

Tasks:

1. Implement provider-neutral request builder.
2. Lower message parts and tool schemas into Gateway/provider format.
3. Run model call through Gateway.
4. Handle tool-call loop.
5. Send selected tool calls to Tool Execution.
6. Append tool results back into the model loop.
7. Persist final assistant response and transcript events.

Done when:

- A cloud run can perform a real model turn with tool discovery, tool execution, and final response persistence.

Current status:

- Added runtime-local `modelLoop.ts` to Execution Runtime, Planner Runtime, and Agent Runtime.
- The model loop consumes `sendable.modelInput` from the Context Engine.
- Provider-neutral message parts lower into Gateway chat messages.
- Runtime tools lower into OpenAI-style function tools for Gateway `/v1/chat/completions`.
- The loop calls Gateway, reads assistant text, reads returned `tool_calls`, and sends selected tools through the Runtime -> Tool Execution path.
- Tool results are appended back into the model loop as tool messages.
- `resolve_tool` refreshes the active runtime tool set.
- Permission-gated tool results stop the loop and preserve the best assistant output available so far.
- Final assistant output flows through each runtime's existing `finalize` hook.
- Runtime events are emitted for model call start/completion and loop stop conditions.

Deferred verification:

- Gateway build/type verification.
- Runtime build/type verification after the model-loop changes.
- Live model-call validation against actual provider behavior.
- End-to-end tool-loop validation with real Gateway, Tool Execution, Data, and Context Engine services.

### Phase 11: API Worker Cloud Flow

Status: `implementation-complete`

Scope:

- Public `api.example.com` request flow through API Worker.
- Cloud routes for frontend, runtimes, Gateway admin, streaming, and service identity forwarding.

Tasks:

1. Review existing API Worker endpoints.
2. Define cloud route namespace.
3. Add run-start endpoint.
4. Add streaming/reconnect endpoint.
5. Add service identity forwarding, including `X-User-ID`.
6. Add admin endpoint for Gateway-related administrative functionality.
7. Keep future local namespace separate, such as `/local` or `/bridge`, but do not implement local runtime yet.

Done when:

- Frontend has a stable cloud API contract for starting and observing cloud runs.

Current status:

- Added a new independently deployable `studio-api` worker under `Backend/Cloud/api`.
- Added public cloud route groups for Execution Runtime, Planner Runtime, Agent Runtime, Studio Data, Gateway models, and Gateway registry management.
- Added cloud run forwarding for start, state, control actions, tool execution, approval resolution, WebSocket streaming, and event replay.
- Added cloud Data forwarding for conversations, transcripts, uploads, artifacts, objects, and persisted plans.
- Added `/admin/gateway/*` forwarding to Gateway registry management.
- Added reserved `/local/*` and `/bridge/*` namespaces returning explicit `501` responses for the future local runtime.
- Added user identity forwarding through `X-User-ID` on all non-health routes.

Deferred verification:

- API Worker TypeScript build.
- Route compatibility checks against live service bindings.
- WebSocket forwarding validation through the public API route.
- Admin-token behavior validation against Gateway registry management.

### Phase 12: Frontend Canonical Transcript Integration

Status: `implementation-complete`

Scope:

- Frontend should load canonical renderable projection from Studio Data/API.
- Optimistic UI remains local-only until server state arrives.

Tasks:

1. Define frontend transcript item types matching renderable projection. `done`
2. Load active renderable projection for conversation open. `done`
3. Map user/assistant/tool/artifact events into chat items. `done`
4. Keep optimistic messages replaceable by canonical events. `done`
5. Support retry/edit/revision display rules. `implemented as canonical metadata; final UI controls deferred to artifact/transcript UI passes`

Current status:

- Added canonical transcript frontend contracts under `STUDIO/src/features/chat/canonical`.
- Added a cloud transcript API client for `/cloud/transcripts/renderable`.
- Added a mapper from renderable transcript projection events to the existing `ChatMessage` shape.
- Preserved canonical event, branch, revision, tool, attachment, and artifact identifiers in message metadata.
- Added a React loader hook for server-owned renderable projections.
- Wired cloud chat pages to prefer canonical server projection when available and fall back to existing local/optimistic messages otherwise.

Deferred verification:

- Frontend TypeScript build.
- Live API projection fetch through deployed API Worker.
- UI reload behavior against a real server-owned transcript.

Done when:

- Chat can render server-owned transcript state instead of relying only on older local conversation shapes.

### Phase 13: Inline Artifact Frontend

Status: `implementation-complete`

Scope:

- Inline artifact rendering is the primary artifact surface.
- Panel/workspace remains optional expanded view later.

Tasks:

1. Create artifact renderer registry keyed by family/type/status. `done`
2. Implement compact inline renderers for activity, research, generated media, connector record, connector action, file, and structured data. `done`
3. Add permission artifact UI. `done through the shared artifact envelope/actions`
4. Add loading, streaming, completed, failed, cancelled, rejected, partial, and empty states. `done`
5. Create temporary Artifact Catalog/Lab route inside Studio using the real app design system. `already present; expanded examples`
6. Keep right-side overview/workspace out of scope unless explicitly designed. `kept out of scope`

Current status:

- Canonical transcript artifact events render inline in assistant messages.
- Full artifact payloads use the existing artifact renderer.
- Artifact references without payloads render as compact inline fallback cards.
- Added artifact family/renderer registry for activity, research, generated media, connector records, connector actions, files, structured data, permissions, coding, and generic artifacts.
- Extended artifact status support to loading, streaming, completed, failed, cancelled, rejected, partial, empty, pending, success, and error.
- Expanded the Artifact Lab examples to cover the cloud artifact families.

Deferred verification:

- Frontend TypeScript build.
- Visual QA in browser.
- Live artifact rendering against backend-created transcript artifact events.

Done when:

- Renderable transcript artifact events become inline cards in chat.

### Phase 14: Connector Artifact Classification

Status: `implementation-complete`

Scope:

- Connectors should create semantic artifacts based on result shape, not connector mechanism.

Tasks:

1. Review curated Composio app actions. `done at static route/catalog level`
2. Classify actions into `connector_record`, `connector_action`, `file`, `structured_data`, `research`, or `activity`. `done`
3. Define connector result normalization. `done`
4. Redact sensitive connector metadata. `done`
5. Add representative Gmail, Calendar, Drive, Slack/Teams, GitHub/Linear/Jira, CRM, and file examples. `done through artifact examples and classifier rules`

Current status:

- Tool Execution connector dispatch now calls the Connectors worker's actual `/internal/composio/execute` route.
- Connector execution sends the expected `args` field instead of the stale `arguments` field.
- Connector outputs are redacted for token, credential, secret, authorization, cookie, and API-key shaped fields.
- Connector outputs now include a Studio artifact proposal describing the intended artifact family, title, summary, and fields.
- Runtimes now create completed artifacts from artifact proposals returned by Tool Execution, not only proposals embedded in the original tool-call arguments.
- The same completed-artifact behavior is present in Execution Runtime, Planner Runtime, and Agent Runtime.

Deferred verification:

- Connector worker build/type check.
- Tool Execution build/type check.
- Runtime build/type check after copied session implementation.
- Live connector execution against Composio.
- Artifact creation from real connector tool results.

Done when:

- Connector tool results can reliably produce appropriate artifact records or compact activity updates.

### Phase 15: Memory And Retrieval Integration

Status: `implementation-complete`

Scope:

- Memory retrieval currently exists conceptually/basic, but final flow needs integration with Context Engine and Tool Execution.

Tasks:

1. Define memory result shape. `done`
2. Decide which memory operations create visible artifacts. `done: memory retrieval is audit-traceable context, not a default visible artifact`
3. Add memory retrieval into Context Engine resource/context ordering. `done`
4. Add memory write/update/delete permission behavior if user-visible. `done through Tool Pool policy metadata; execution requires memory service`
5. Persist memory references in transcript where relevant. `done as best-effort audit memory_reference events`

Current status:

- Context Engine `UserContext` now has explicit `memoryReferences`.
- Memory retrieval parser accepts structured result arrays and text-wrapped memory responses.
- Sendable context now includes a dedicated dynamic `memory_references` section.
- Provider-neutral model input includes memory references separately from semi-stable profile/recent-memory summaries.
- Context Engine records injected memories as best-effort `memory_reference` transcript events with `audit` visibility.
- Tool Pool exposes discoverable `memory_recall`, `memory_write`, `memory_update`, and `memory_delete` tools.
- Memory write/update/delete are marked approval-requiring write/destructive operations.
- Memory tools route through Tool Execution's existing memory dispatch path.

Deferred verification:

- Context Engine build/type check.
- Tool Pool build/type check.
- Tool Execution build/type check against a real Memory service binding.
- Live memory recall/write/update/delete behavior.

Done when:

- Memory can be injected or called without becoming hidden untraceable context.

### Scenario QA Gaps: Uploads, Documents, Images, Connectors, Search

Status: `needs-triage`

Scenario used:

- User uploads a document and an image.
- User asks Studio to combine both sources and calculate how much John spent this month.
- Studio sends an email with the result.
- Studio generates a colored graph image from the document data.
- Studio searches the internet to evaluate whether Apple's stock is profitable based on the uploaded documents.

Result:

- The overall chain is coherent: API Worker -> Studio Data -> transcript -> Context Engine -> Tool Pool -> Runtime -> Gateway/tool calls -> Tool Execution -> Connectors/native tools -> artifacts/transcript -> frontend.
- User scoping is present across the main path through `X-User-ID`, user-owned Data records, user-owned connector connections, and user-scoped Tool Pool inventory.
- The scenario exposes several implementation gaps that should be resolved before cloud end-to-end testing.

Gaps:

1. Upload-to-transcript reference flow is not automatic.
   - Uploads are user-scoped and stored correctly.
   - Context Engine only discovers uploaded files/images from `attachment_reference` transcript events.
   - Current upload route creates an attachment record but does not append the transcript reference itself.
   - Decision needed: frontend appends `attachment_reference` events after upload, or Studio Data does it automatically when `conversationId` is present.

2. Uploaded image bytes are not actually passed to the model.
   - Context Engine produces `image_ref`.
   - Runtime lowering currently converts `image_ref` into a text placeholder.
   - This means the model cannot inspect the uploaded image content in the cloud flow.
   - Need provider-neutral image lowering into real Gateway/provider image message parts, or a preprocessing/OCR/vision extraction step.

3. PDF/document extraction is incomplete.
   - Text-like uploads can be read and inlined up to the configured limit.
   - Binary PDFs, `.docx`, scanned PDFs, and image-only documents are not extracted in the new cloud path.
   - Need a document-processing path that creates extracted text, page/image references, metadata, and transcript/resource references.

4. Connector write actions may not be permission-gated correctly.
   - Gmail/Outlook connectors exist through the curated Composio catalog.
   - Connector tools currently come from synced Composio actions.
   - Tool Pool connector inventory marks connector tools as read-like by default, so send-email style actions may not be gated before execution.
   - Need connector action classification for read/write/destructive policy based on slug, Composio metadata, or a curated override table.

5. Web search is documented and represented in artifact examples, but not exposed as a first-party Tool Pool/native tool.
   - The scenario can only search the web if a connected/search connector such as Firecrawl is active and synced.
   - Need a first-party cloud web-search/native-search tool if web search is a baseline Studio capability.

6. Graph/image generation is not exposed as a discoverable callable capability.
   - Artifact families support `generated_media`.
   - Gateway has image routes.
   - Tool Pool does not clearly expose a first-party graph/image-generation native tool that takes structured/document data and creates an image artifact.

7. Frontend send/stream path is not yet on the new cloud runtime API.
   - Canonical transcript read exists.
   - Inline artifact rendering exists.
   - Active desktop send flow still appears to use the older chat-agent WebSocket path.
   - Need frontend cloud-send integration with `/cloud/runs`, runtime event stream/replay, and canonical transcript refresh.

8. Tool transcript events may not share the original user turn ID.
   - Tool Execution persists `tool_call` and `tool_result` events.
   - Runtime also emits runtime/tool events.
   - Tool Execution falls back to `turnId = metadata.turnId ?? toolCallId`; Runtime does not currently pass `metadata.turnId`.
   - Need turn ID propagation so tool calls, tool results, artifacts, and assistant output reconstruct under the same user turn.

9. Native tool/service endpoint completeness still needs a static contract pass.
   - Tool Execution has native-cloud and memory dispatch shapes.
   - Some downstream services, especially Memory and Native Tools, are not fully present in this repo.
   - Need explicit service contracts for web search, image generation, document extraction, memory, and any stock/finance lookup.

10. Contract drift should be cleaned before verification.
    - Tool Pool now includes memory routes.
    - Context Engine/runtime copies were partially aligned, but all worker-local contracts should be rechecked together.
    - Need a static contract normalization pass before build/test.

Immediate discussion focus:

- PDF/document/image processing should be handled first because uploaded content is the first dependency in the simulated user flow.

### Phase 16: Cloud End-To-End Test

Status: `pending`

Scope:

- First real cloud-local dev verification across all workers.

Tasks:

1. Start API, Data, Context Engine, Tool Pool, Tool Execution, runtimes, Gateway, Connectors as needed.
2. Send a user message.
3. Build context.
4. Call model through Gateway.
5. Discover/resolve a tool.
6. Execute a tool.
7. Persist transcript/tool/artifact events.
8. Stream/render response.
9. Reload conversation and reconstruct transcript from canonical state.

Done when:

- The complete cloud request path works locally before any Cloudflare redeploy.

### Phase 17: Deployment Reset And Cloud Verification

Status: `pending`

Scope:

- Remove old Cloudflare deployment state and redeploy the new architecture from scratch.

Tasks:

1. Finalize fresh D1 migrations.
2. Provision R2 buckets and service bindings.
3. Configure secrets and environment variables.
4. Deploy workers in dependency order.
5. Run remote health checks.
6. Run remote integration checks.
7. Verify user isolation in deployed environment.

Done when:

- Cloud deployment runs the new architecture cleanly.

### Phase 18: Local Architecture Pass

Status: `pending`

Scope:

- Local is designed after cloud is stable.
- Local should reuse canonical contracts where appropriate, not Cloudflare worker internals.

Tasks:

1. Define `/local` or `/bridge` API namespace.
2. Define local storage adapters.
3. Define local MCP registration.
4. Define local file/terminal permissions.
5. Define local transcript extensions for coding events.
6. Define local artifact families for code changes, terminal sessions, diagnostics, repository state, and local files.

Done when:

- Local can be implemented without redesigning cloud artifacts/transcripts/context/tool contracts.
