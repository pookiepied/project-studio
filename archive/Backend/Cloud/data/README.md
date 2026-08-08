# Studio Data

The authoritative management layer for user-owned content: conversations, uploaded
documents/images/videos/audio, generated media, artifacts, and their associations.

## Storage split

- **R2 (`CONVERSATIONS`)** — cloud conversation transcripts and durable exports
- **R2 (`UPLOADS`)** — user-provided documents, images, videos, audio, and files
- **R2 (`GENERATED`)** — generated/edited images, videos, documents, and artifact files
- **D1 (`DATA_DB`)** — structured, queryable metadata: conversations, messages,
  execution-event references, tool-call records, attachment/artifact records

Object-storage buckets are never used as the database for conversation metadata.

## Responsibilities

- Upload/download with signed access and content-type validation
- Ownership and access control on every record
- User-scoped parent validation for conversations, uploads, artifacts, plans,
  transcript events, side payloads, and managed objects
- Conversation, attachment, and artifact associations
- Retention, deletion, versioning where required, lifecycle management

## Transcript model

Studio Data separates conversation storage into explicit projections:

- `messages` remains the simple renderable compatibility table.
- `conversation_events` is the durable transcript spine for frontend messages,
  model-visible history, runtime events, tool calls/results, context references,
  attachment references, and artifact references.
- `conversation_events` is revision-aware. Edits and regenerations supersede
  prior revisions internally while the cloud UI can remain linear.
- `active_transcript_projections` stores persisted renderable/model/audit
  projections rebuilt from active conversation events.
- `transcript_segments` stores the manifest for open and sealed transcript
  segments. Sealed segments are gzip-compressed in R2.
- `transcript_side_payloads` stores references to large event payloads, such as
  large tool results, connector results, or generated text outputs.
- `artifact_roots`, `artifact_versions`, `artifact_events`, and
  `artifact_permission_decisions` store the canonical artifact envelope,
  lifecycle, inline placement metadata, runtime/model-authored data split,
  permission decisions, and version history.
- `storage_objects` is the generic object metadata table for R2 payloads across
  uploads, artifact payloads/previews, transcript segments, and side payloads.
- `GET /transcripts/renderable` returns the user-visible transcript projection.
- `GET /transcripts/model` returns the model-context projection consumed by the
  Context Engine.
- `GET /transcripts/events` returns runtime/audit events for debugging and later
  observability surfaces.
- `GET /transcripts/projection` returns a persisted active projection directly.
- `GET /transcripts/turns` returns active events grouped by turn.
- `GET /transcripts/export` returns the durable conversation transcript export:
  conversation metadata, ordered events, projection metadata, segment manifest,
  side payload metadata, and managed object metadata. Use
  `includePayloads=true` only when the caller needs inline side-payload content.
- `GET /transcripts/segments` lists segment manifests.
- `POST /transcripts/segments/seal` seals a specific open segment or current
  conversation branch.
- `POST /transcripts/segments/seal-inactive` seals open segments that have not
  changed for a configured threshold; the default is 24 hours.
- `GET /transcripts/segments/:id` returns a sealed segment payload.
- `GET /transcripts/payloads/:id` returns a large side payload.
- `GET /objects/:id` returns a managed R2 object by ID.
- `GET /objects/:id/metadata` returns the managed object's metadata.
- `DELETE /conversations/:id` removes the conversation and all Studio Data-owned
  child metadata and managed R2 objects for that conversation.

## Migrations

- `schema.sql` is the current complete D1 schema.
- `migrations/0001_current_schema.sql` mirrors the current schema for fresh local
  and cloud database setup while this worker is still under active development.

Artifacts and attachments are referenced from transcript events by identifier.
Their binary contents stay in R2 and are resolved by the owning service when the
Context Engine or frontend needs them.

## Artifact model

Artifacts are first-class user-scoped backend entities. The chat transcript
stores structured artifact references/events so the frontend can render inline
artifact cards at the exact point where the artifact occurred. A future panel or
workspace may expand the same artifact record, but it is not a separate artifact
system.

- `artifact_roots` represents the stable logical artifact.
- `artifact_versions` represents each concrete artifact revision/payload.
- `artifact_events` records lightweight lifecycle/progress updates.
- `artifact_permission_decisions` records user decisions for permission-gated
  artifact operations.
- Model-authored fields live in `model_presentation`.
- Runtime-authored trusted fields live in `runtime_data`.
- Large payloads and previews live in R2 through `storage_objects`.
- Supported lifecycle states include `planned`, `proposed`,
  `awaiting_permission`, `running`, `streaming`, `waiting_for_input`,
  `completed`, `failed`, `cancelled`, `rejected`, `partial`, and `superseded`.

Primary artifact routes:

- `GET /artifacts`
- `POST /artifacts`
- `GET /artifacts/:id`
- `PATCH /artifacts/:id`
- `POST /artifacts/:id/events`
- `POST /artifacts/:id/permissions`
- `GET /artifacts/:id/content`
- `DELETE /artifacts/:id`

The frontend may keep optimistic transcript state for responsiveness, but Studio
Data is authoritative. Runtimes and Context Engine identify the conversation and
read the canonical active projection from Studio Data rather than trusting a
client-submitted transcript.

## Compression

Studio Data uses only `none` and `gzip` as storage compression modes.

- D1 metadata, active projections, and small event records remain uncompressed.
- User uploads are stored uncompressed by default because many uploads are binary
  or already compressed.
- Text-like generated artifacts may be gzip-compressed automatically.
- Large transcript event content is moved into a side payload and gzip-compressed
  when appropriate.
- Sealed transcript segments are written to R2 as gzip-managed objects.

The complete transcript is never decompressed and recompressed after every turn.
Open segments remain indexed in D1; sealed segments are immutable R2 payloads.

## Verification

- `npm run build` type-checks the worker.
- `npm run verify:transcripts` checks the static transcript/storage contract.
- `npm run verify:integration` starts a local Wrangler worker with isolated temp
  D1/R2 state and verifies conversation creation, event append, large side
  payloads, segment sealing, transcript export, deletion cleanup, user
  isolation, and idempotent transcript retry behavior.
- `npm run verify` runs all of the above.

## Must NOT

- Process media itself (specialized services do that; Data stays the management layer)
- Hold execution state (ExecutionSession DO's job) or capability metadata (Registry's job)
- Hold Context Engine baseline/snapshot state (Context Engine-owned storage)

## Structure

```
src/
  index.ts        Worker entry
  server/         HTTP surface: conversations, uploads, artifacts, transcripts
  storage/        managed R2 objects, gzip helpers, and hashing
  system/         Env bindings
schema.sql        D1 schema
```
