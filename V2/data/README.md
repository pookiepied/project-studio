# Studio Data

The authoritative management layer for user-owned content: conversations, uploaded
documents/images/videos/audio, generated media, artifacts, and their associations.

## Storage split (ARCHITECTURE.md §21–§22)

- **R2 (`CONVERSATIONS`)** — cloud conversation transcripts and durable exports
- **R2 (`UPLOADS`)** — user-provided documents, images, videos, audio, and files
- **R2 (`GENERATED`)** — generated/edited images, videos, documents, and artifact files
- **D1 (`DATA_DB`)** — structured, queryable metadata: conversations, messages,
  execution-event references, tool-call records, attachment/artifact records

Object-storage buckets are never used as the database for conversation metadata.

## Responsibilities

- Upload/download with signed access and content-type validation
- Ownership and access control on every record
- Conversation, attachment, and artifact associations
- Retention, deletion, versioning where required, lifecycle management

## Transcript status

The first execution-runtime handoff stores only the stable basics: conversation metadata,
the user request, and the final assistant output. The richer transcript/archive format
is intentionally still open. Later versions can add event-log exports, tool-call records,
artifacts, reasoning summaries, and checkpoint references without changing the API/Data
ownership boundary.

## Must NOT

- Process media itself (specialized services do that; Data stays the management layer)
- Hold execution state (ExecutionSession DO's job) or capability metadata (Registry's job)

## Structure

```
src/
  index.ts        Worker entry
  server/         HTTP surface: conversations, uploads, artifacts
  storage/        objects.ts (R2 content) and metadata.ts (D1 records)
  system/         Env bindings
schema.sql        D1 schema
```
