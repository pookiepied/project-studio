# Studio Memory: proposed architecture and delivery plan

Status: proposal for discussion; no runtime changes implemented.
Prepared 2026-10-16 against main at 3e6fe0ba.

## 1. Product direction

Studio should carry useful continuity across conversations without asking the
model to search for every basic fact. Build a first-party memory domain in the
harness, exposed through Personalization, conversation context, and a built-in
`studio-memory` MCP. Connect it directly to Library through shared retrieval,
entities, and source references.

There is one authoritative memory service. The settings UI, background organizer,
prompt builder, and MCP call that service. The MCP process owns no separate
database. Library continues to own files; memory owns claims and relationships.

Three memory layers have different lifecycles:

| Layer | Contains | Default delivery |
| --- | --- | --- |
| Standing profile | Name, reply preferences, small amount of stable standing context | Small cached block in new conversations |
| Recent context | Dated topics, ongoing activities, tentative plans, unresolved work | Bounded cached timeline in new conversations |
| Durable knowledge | Explicitly remembered facts, project decisions, preferences, supported relationships | Retrieved by meaning and relationship when needed |

The standing profile is a curated projection of durable knowledge, not a second
independent truth. Not every durable record belongs in every prompt. Recent
context can expire from automatic delivery without becoming durable memory.

Examples:

- “My name is Sam” can update the standing profile automatically.
- “I would love to visit New Zealand” becomes a dated recent interest, not a
  booked trip or permanent preference.
- “Remember that New Zealand is my first choice for our honeymoon” creates a
  durable, scoped preference with the original source.
- “Our company uses this logo” links the organization and the kept Library item.

## 2. Verified integration points

- `src/extend/mcp/builtin.ts` registers Studio Browser, Computer, and
  Customization as system-provenance stdio servers, with normal selection,
  supervision, discovery, and kernel dispatch. Add Memory through this path.
- `src/customization/server.ts` and `management.ts` demonstrate an MCP relay to
  harness routes. Reuse their transport/authentication pattern, not separate
  persistence inside an MCP worker.
- `src/library/store.ts` owns Library records and managed files. Current search
  covers title, description, subject, tags, and filename; file contents are not
  indexed. The subject is user supplied, not inferred identity.
- `src/storage/database.ts` provides application-owned SQLite through
  `StudioDatabase`; migrations and domain table ownership already have a home.
- The canonical transcript belongs to Flue. `src/conversations/store.ts` is an
  existence/settings index, not a second transcript. Memory should be a derived
  projection with source references, never another transcript authority.
- `src/conversations/titling.ts` reacts to completed `submission_settled`
  observations. It is a lifecycle precedent; memory additionally needs durable
  jobs and replay checkpoints rather than the titler's in-memory capture.
- `src/library/describer.ts` and `src/application/text-improver.ts` show structured
  model work outside the main chat. Reuse dispatch conventions, but keep the
  memory organizer bounded and without general tools.
- `src/agents/studio.ts` assembles the static prompt, changing environment, and
  capability inventory. `src/context/system-prompt.ts` currently explicitly says
  the model carries no cross-conversation memory; revise that when memory ships.
- Frontend `features/settings/panes/placeholders.ts` has a Personalization
  placeholder. Library already has its own pane, contracts, and client.

Paths in this section are relative to `STUDIO HARNESS/`, except the frontend path,
which is relative to `STUDIO/src/`.

## 3. Domain and storage

Keep canonical records in Studio's existing application SQLite database. Separate
repositories own their tables and collaborate through service ports. Proposed
logical records (exact SQL belongs in the implementation ADR):

| Record | Responsibility |
| --- | --- |
| Memory | Atomic claim, kind, scope, status, importance, revision, timestamps |
| Evidence | Source conversation/submission/message or Library item and location; evidence type |
| Entity | Stable identity for a person, organization, project, place, or topic; aliases |
| Relation | Typed, directed connection with evidence, validity interval, and status |
| Episode | Dated summary of a conversation topic/activity; checkpoint and retention |
| Cluster | Named collection/topic with explicit or suggested membership |
| Search unit | Derived searchable memory, episode, Library metadata, or document chunk |
| Embedding | Search-unit revision, vector, model identity, dimensions, content hash |
| Snapshot | Versioned, bounded context prepared for a conversation |
| Job/checkpoint | Durable extraction/indexing work with idempotency and retry state |
| Change record | Who changed a record, operation, revision, and minimal provenance |

Claims need both when Studio learned them and when they apply. “Moved from Dhaka
to Auckland in June” should supersede the current residence while retaining the
historical fact. A model confidence estimate is metadata, not a truth guarantee.

Use explicit global-personal, project, and conversation scopes. Derive effective
scope from authenticated harness context. The model cannot select another user's
identity or grant itself access to another project. A project fact does not become
personal standing context merely because the user mentioned it.

Global personal facts may apply inside projects when enabled; facts from another
project remain excluded. Ambiguous automatic facts stay narrow. Every relation
traversal, source expansion, and ranking operation respects the same scope.

## 4. Automatic memory lifecycle

1. After an eligible main conversation submission completes, enqueue a durable
   memory job keyed by conversation and source revision/checkpoint.
2. Read only the new canonical transcript segment and relevant existing records
   through a transcript adapter. Verify Flue's supported read/replay seam before
   implementing this adapter; do not reach into Flue's database.
3. Ask the configured organizer model for schema-validated proposals: episodes,
   supported durable claims, entities, relations, corrections, and evidence IDs.
4. A deterministic service validates source references, scope, permissions,
   bounds, duplication, and conflicting revisions. It commits accepted changes
   and schedules derived indexes/profile/timeline updates.
5. Advance the checkpoint only after durable processing. Restart and event replay
   cannot duplicate a memory or lose the need to process a completed segment.

Coalesce bursts of turns; do not call an organizer for every token or tool event.
Run after completed exchanges, with bounded input, timeout, retries, concurrency,
and daily cost limits. Failed/aborted turns do not trigger the initial version.
Exclude organizer jobs themselves to prevent recursive extraction. Explicit user
memory commands can take effect immediately through tools.

Default organizer model: the configured default chat model. Offer “use this
conversation's model” as a policy, capturing the model at job creation. A model
switch must not silently move an already queued job to a different provider.
Unavailable or unsupported models leave pending work visible and chat usable.

Automatic acceptance rules:

- Direct user statements can support basic profile facts and stable preferences.
- Hypotheticals, quoted text, fiction, tentative interests, and assistant guesses
  are not asserted as durable user facts.
- Repetition can increase relevance but cannot convert uncertainty into certainty.
- Library content supports “this document says X,” not automatically “the user
  believes X.” Keeping a document does not endorse every statement inside it.
- Existing user edits outrank stale organizer proposals; explicit corrections
  supersede older claims. Unsupported conflicts remain unresolved.
- User-requested forgetting prevents replay of the same evidence from recreating
  the record. New contradictory evidence requires a fresh decision.

Recent context initially uses a configurable 30-day delivery window and a bounded
number of episodes. This is a proposed default to evaluate, not a proven optimum.
Expiry from the prompt and deletion from storage are separate policies. Users can
pin or promote a recent item; automatic promotion requires supported durability.

## 5. New-conversation context and caching

At the first admitted message, capture a versioned context snapshot containing:

- A compact core profile, including explicit reply preferences.
- Recent global context and recent context for this project.
- Optional relevant durable/project context selected using the first message.
- Source IDs, dates, uncertainty, and a statement that the block is fallible
  remembered context subordinate to the user's current corrections.

An empty draft does not need a model call. Read precomputed projections and
indexes; never wait for a fresh summarizer merely to begin a conversation.
If first-message semantic retrieval misses a short time budget, use the prepared
profile/timeline and allow deeper retrieval through tools.

Proposed initial total budget: about 1,500 tokens, with a hard total cap and
priority order of explicit core facts, active project context, then recent
episodes. Tune against evaluations. Overflow durable facts remain retrievable.

Build this snapshot once and reuse its exact text on subsequent model requests.
The model still receives context on those requests; “once” means one assembly and
retrieval, not that a provider magically retains an omitted system message.
Provider prompt caching is an optimization with provider-specific behavior, not
the application's memory store or a cost guarantee.

Preserve the static instruction prefix. Put the stable memory block alongside
the stable capability block, before the per-turn changing environment where the
runtime permits. Check Flue/provider ordering before promising cache gains.
Persist snapshot identity so restart and compaction retain the same context.

Normal background discoveries affect new conversations. Explicit edits,
corrections, forgetting, scope changes, and disabling memory invalidate affected
snapshots before the next model request. Do not silently keep injecting a deleted
fact for cache stability. Already transmitted text cannot be recalled; avoid
claiming deletion removes the model's knowledge from an existing chat transcript.

Prompt guidance should encourage retrieval when prior context matters, distinguish
recent from confirmed facts, and avoid mentioning unrelated memories in replies.
There is no reason to force a memory search on every turn.

## 6. Meaning-based retrieval and the Library connection

Use one retrieval service with selectable sources: memories, episodes, and
Library. Existing `library_search` can delegate with a Library-only filter while
preserving its tool contract. Memory recall can return mixed results and typed
references. Both directions expose related records and source links.

Retrieval pipeline:

1. Resolve authorized scope, temporal constraints, and source/kind filters.
2. Retrieve semantic candidates from embeddings and exact candidates through
   SQLite FTS5/BM25. Names and filenames still need precise matching.
3. Fuse ranked candidates, initially with reciprocal rank fusion.
4. Resolve entities from candidates/query context and expand a small number of
   supported relation hops. Bound node count and scope at every step.
5. Rank for relevance, evidence quality, current validity, and appropriate
   recency; deduplicate by source. Optional reranking must have a measured benefit.
6. Return concise evidence, source references, dates, and why the item matched.
   Permit no-match and ambiguous results rather than always filling the quota.

For “my town,” semantic matching can retrieve a statement about where the user
lives; a supported `user --lives_in--> place` relation anchors the result. A
linked home document or photo can then appear as related Library material. A
bare “town” may have several meanings: conversation context and evidence decide,
not an unconditional town/home equivalence.

Library integration is bidirectional through IDs:

- A memory detail opens its source document, image, or chat location.
- A Library item shows related entities, memories, and conversations.
- Library metadata changes trigger reindexing. Removed items lose searchable
  chunks and links; a memory backed only by that item loses that evidence and is
  withdrawn if unsupported. Independent user-stated evidence can remain.
- Library bytes remain in Library. Recall returns approved Library handles/paths;
  existing read/image tools perform actual file use under existing permissions.
- Merely linking an upload does not copy it into Library; existing Keep behavior
  remains the explicit act that preserves a file.

Index Library metadata first, then text extraction/chunking with page or section
locations for supported documents. Existing read-time extraction is a useful
adapter source, not evidence that a durable content index already exists.
Images use trusted metadata/descriptions initially; no face recognition or
identity guesses. Unsupported formats remain metadata-searchable.

Persist typed relations in SQLite; a graph is a data model, not a requirement for
a separate graph database. Start with bounded traversal and editable topic
clusters. More advanced automatic clustering/community summaries can follow
measured retrieval needs. Similarity-derived links remain suggestions unless
there is evidence for a factual relation.

Embedding generation is a separate capability from chat generation. Introduce
an `EmbeddingPort` and explicitly choose a multilingual local model or configured
remote embedding provider. Verify English/Bangla and mixed-language retrieval.
Cache vectors by content hash and embedding model/version; never compare vectors
from different embedding spaces. Model changes require a rebuild and atomic index
switch, with the previous index usable during rebuilding.

Recommended initial storage: vectors in SQLite plus exact similarity in a worker,
behind a replaceable index port. Benchmark expected Library chunk counts before
shipping. Evaluate sqlite-vec for larger collections, but first verify Windows
packaging and `node:sqlite` extension loading in Studio's shipped runtime. Do not
assume platform support proves compatibility with this application. Avoid adding
a required external vector service before measurements justify it.

If embedding generation is unavailable, expose lexical/relationship fallback as
degraded retrieval; do not silently present it as full semantic search.

## 7. Native MCP tools and service boundaries

Register `studio-memory` through `registerBuiltInServers` and build `memory.mjs`.
Use the existing stdio wrapper, conversation metadata, supervisor, discovery,
and management-client authentication conventions. The harness derives access
context; arbitrary tool arguments never select an identity or bypass admission.

Proposed tool surface:

| Tool | Purpose |
| --- | --- |
| `studio_memory_recall` | Natural-language retrieval across allowed memory, timeline, and Library |
| `studio_memory_read` | Full record, evidence, current status, and related records |
| `studio_memory_create` | Explicit fact or preference with scope and evidence |
| `studio_memory_update` | Correct/supersede a record using an expected revision |
| `studio_memory_forget` | Remove a memory from use and prevent recreation from the same evidence |
| `studio_memory_link` | Add an evidenced typed relation between permitted records/entities |
| `studio_memory_unlink` | Remove or correct a relation |
| `studio_memory_cluster_create` | Create a named topic/group |
| `studio_memory_cluster_update` | Rename or change permitted membership |
| `studio_memory_cluster_delete` | Delete the grouping without deleting its members |

A dedicated graph-inspection tool is optional if `read` cannot clearly return a
bounded neighborhood. Avoid generic arbitrary graph/SQL mutation tools.

The same domain validators apply to MCP, UI, and organizer writes. MCP writes go
through Studio's normal kernel approval behavior. Automatic writes are authorized
by explicit memory settings and a narrow background policy; system provenance
alone is never that authorization. Disabling effective memory for a conversation
must also disable automatic injection/capture, not merely hide its tools.

## 8. Personalization and user control

Personalization should expose:

- Use saved memory; learn new memories automatically; use recent conversation
  context; temporary conversation override; project-specific behavior.
- Standing profile: directly editable core facts and reply preferences.
- Recent context: dated episodes with source, dismiss, pin, and remember actions.
- Saved memories: search, edit, scope, evidence, related Library items, forget.
- Topics: simple editable groups; graph view can follow if useful.
- Maintenance: organizer model policy, embedding configuration, pending/failed
  indexing state, retention settings, export, and reset.

Keep “use existing” and “learn new” independent: a user may want continuity while
pausing learning. Temporary conversations bypass injection, retrieval, extraction,
and indexing. Read authorization applies to linked Library evidence too.

Expose lightweight “Memory updated” activity for meaningful changes, with a way
to inspect/edit. Do not require a modal to save every basic preference when
automatic learning is enabled.

Deleting a conversation should remove its derived episodes/evidence and withdraw
unsupported automatically learned facts. Explicitly kept memories and Library
files may survive, with clear product copy and detached/minimal provenance.
Finalize these rules before implementation rather than hiding them in a cascade.

Forgetting must invalidate search units, vectors, relations, clusters/summaries,
profile/timeline projections, snapshots, and pending proposals that depend on the
forgotten evidence. Keep only minimal suppression metadata, not forgotten text in
an audit log. Reset and backup/restore need documented semantics; a restored old
backup is not a guarantee that previously forgotten data remains forgotten.

## 9. Implementation sequence and acceptance gates

1. **Architecture and seams.** Resolve scope/retention semantics; prove canonical
   transcript delta reads and completion replay; prove prompt ordering/snapshot
   restoration; select embedding model through a small bilingual benchmark.
2. **Domain foundation.** Migrations, memory/evidence/entities/relations, scoped
   service, revision checks, explicit CRUD, forgetting, and durable jobs.
3. **Retrieval and Library.** Shared semantic + lexical retrieval, metadata
   indexing, typed links and traversal, then document chunks. Test both directions.
4. **Native MCP.** First-party server and bundle, relay routes, discovery,
   approval behavior, effective settings, and clear tool result contracts.
5. **Automatic continuity.** Structured organizer, incremental checkpoints,
   promotion/conflict rules, profile/timeline projections, first-turn snapshot,
   compaction/restart behavior, and bounded background execution.
6. **Personalization and polish.** Real pane, Library related context, source
   navigation, temporary mode, activity visibility, export/reset, and maintenance.

Each slice should be reviewable with targeted tests; repository checks run for
the implementation. The complete first release includes semantic search,
Library links, automatic recent/profile context, and user correction/forgetting.
Graph visualization and sophisticated cluster generation can ship later.

Evaluation cases must cover:

- Profile continuity in a new chat with no tool call for a basic known fact.
- New Zealand interest stays tentative/recent; no invented booking or promotion.
- Paraphrases and English/Bangla queries find the intended memory.
- Town/home query resolves an evidenced residence and related Library item;
  ambiguous or absent evidence does not produce a fabricated personal answer.
- Exact filenames/names remain retrievable alongside semantic matches.
- Conflicting current/historical residence and explicit corrections resolve well.
- Separate project facts, inaccessible sources, and temporary chats stay isolated.
- Forgetting during an in-flight organizer job does not recreate the memory.
- Duplicate completion delivery, retries, restart, and partial index failure are safe.
- Resume/compaction preserves context; edits/disable invalidate snapshots.
- Deleting Library sources or conversations updates dependent retrieval/projections.
- Malicious instructions in documents cannot become standing instructions or facts.

Measure recall@k/MRR on labeled examples, false durable promotions, stale-fact
answers, scope leakage, prompt size, retrieval p50/p95, organizer backlog, and
tokens/cost per completed exchange. Establish release thresholds using the first
prototype rather than claiming unmeasured accuracy or latency guarantees.

## 10. Research used and unresolved choices

- [SQLite FTS5](https://www.sqlite.org/fts5.html): built-in full-text retrieval and
  BM25 ranking. Check availability in the shipped runtime.
- [Qdrant hybrid queries](https://qdrant.tech/documentation/search/hybrid-queries/):
  semantic/exact retrieval and rank fusion as a reference design; this proposal
  does not require deploying Qdrant.
- [Microsoft GraphRAG local search](https://microsoft.github.io/graphrag/query/local_search/):
  a reference for combining semantic entity matching, relations, and source text.
  Studio can implement a smaller bounded retrieval system.
- [sqlite-vec](https://github.com/asg017/sqlite-vec): possible local vector index;
  application/runtime compatibility remains an implementation spike.

Product choices still open: default recent-context retention, how much personal
context enters project chats, the embedding model/local-versus-remote default,
and whether an existing history import is offered. Recommend enabling capture for
new eligible exchanges first and making retrospective import explicit, bounded,
and resumable. No history backfill or runtime migration is performed by this plan.
