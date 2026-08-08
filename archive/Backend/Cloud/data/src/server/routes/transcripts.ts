import { Hono } from "hono";
import type { Env } from "../../system/env";
import { readOwnedArtifact, requireUserId } from "../identity";
import { deleteManagedObject, getManagedObject, putManagedObject } from "../../storage/objects";
import { sha256Hex } from "../../storage/hash";

type LegacyKind = "assistant_text" | "assistant_reasoning" | "tool_call" | "tool_result";
type ConversationEventKind =
  | "user_message"
  | "assistant_message"
  | "system_message"
  | "planner_message"
  | "tool_call"
  | "tool_result"
  | "connector_call"
  | "connector_result"
  | "web_search_result"
  | "image_generation_result"
  | "artifact_reference"
  | "artifact_created"
  | "artifact_updated"
  | "artifact_completed"
  | "artifact_failed"
  | "artifact_permission_requested"
  | "attachment_reference"
  | "memory_reference"
  | "context_reference"
  | "context_summary"
  | "runtime_event"
  | "status"
  | "interruption"
  | "retry"
  | "edit"
  | "branch_created";
type EventSource =
  | "frontend"
  | "execution-runtime"
  | "planner-runtime"
  | "agent-runtime"
  | "context-engine"
  | "tool-execution"
  | "tool-pool"
  | "connector"
  | "system";
type EventVisibility = "renderable" | "model" | "internal" | "audit" | "hidden";
type EventRole = "system" | "user" | "assistant" | "tool";
type EventStatus = "active" | "superseded" | "interrupted" | "failed" | "cancelled";
type ProjectionType = "renderable" | "model" | "audit";

interface LegacyRecordInput {
  id?: string;
  conversationId: string;
  turnId: string;
  runId: string;
  sequence: number;
  kind: LegacyKind;
  toolCallId?: string;
  toolName?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

interface ConversationEventInput {
  id?: string;
  conversationId: string;
  turnId?: string;
  branchId?: string;
  logicalId?: string;
  revisionId?: string;
  revisionNumber?: number;
  previousRevisionId?: string;
  replacesEventId?: string;
  status?: EventStatus;
  storageVersion?: number;
  projectionVersion?: number;
  runId?: string;
  sequence?: number;
  source: EventSource;
  kind: ConversationEventKind;
  visibility: EventVisibility;
  role?: EventRole;
  content?: string;
  summary?: string;
  toolCallId?: string;
  toolName?: string;
  artifactId?: string;
  attachmentId?: string;
  sidePayloadId?: string;
  segmentId?: string;
  metadata?: Record<string, unknown>;
}

interface StoredConversationEvent {
  id: string;
  conversationId: string;
  turnId: string | null;
  branchId: string;
  logicalId: string | null;
  revisionId: string | null;
  revisionNumber: number;
  previousRevisionId: string | null;
  replacesEventId: string | null;
  status: EventStatus;
  storageVersion: number;
  projectionVersion: number;
  runId: string | null;
  sequence: number;
  source: EventSource;
  kind: ConversationEventKind;
  visibility: EventVisibility;
  role: EventRole | null;
  content: string | null;
  summary: string | null;
  toolCallId: string | null;
  toolName: string | null;
  artifactId: string | null;
  attachmentId: string | null;
  sidePayloadId: string | null;
  segmentId: string | null;
  metadata: string;
  createdAt: string;
}

interface StoredProjection {
  id: string;
  conversationId: string;
  branchId: string;
  projectionType: ProjectionType;
  lastSequence: number;
  eventCount: number;
  payload: string;
  updatedAt: string;
}

interface SegmentRow {
  id: string;
  segmentIndex: number;
  eventCount: number;
  uncompressedSizeBytes: number | null;
  status: "open" | "sealed";
}

interface PreparedConversationEvent {
  event: ConversationEventInput;
  eventId: string;
  branchId: string;
  sequence: number;
  segmentId: string;
  contentBytes: number;
  isNew: boolean;
}

const INLINE_CONTENT_LIMIT_BYTES = 64 * 1024;
const SEGMENT_EVENT_LIMIT = 200;
const SEGMENT_UNCOMPRESSED_LIMIT_BYTES = 1024 * 1024;

export const transcriptsRoute = new Hono<{ Bindings: Env }>();

transcriptsRoute.post("/", async (c) => {
  const userId = requireUserId(c.req.raw);
  const body = await c.req.json<LegacyRecordInput | { records: LegacyRecordInput[] }>();
  const records = "records" in body ? body.records : [body];
  if (!records.length) return c.json({ records: [] }, 201);

  const statements = records.map((record) =>
    c.env.DATA_DB.prepare(
      `INSERT INTO transcript_records
       (id,user_id,conversation_id,turn_id,run_id,sequence,kind,tool_call_id,tool_name,content,metadata)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id,run_id,sequence) DO UPDATE SET
         kind=excluded.kind,
         tool_call_id=excluded.tool_call_id,
         tool_name=excluded.tool_name,
         content=excluded.content,
         metadata=excluded.metadata`,
    ).bind(
      record.id ?? `tr_${crypto.randomUUID()}`,
      userId,
      record.conversationId,
      record.turnId,
      record.runId,
      record.sequence,
      record.kind,
      record.toolCallId ?? null,
      record.toolName ?? null,
      record.content,
      JSON.stringify(record.metadata ?? {}),
    ),
  );
  await c.env.DATA_DB.batch(statements);
  return c.json({ records: records.length }, 201);
});

transcriptsRoute.get("/", async (c) => {
  const userId = requireUserId(c.req.raw);
  const conversationId = c.req.query("conversationId");
  const runId = c.req.query("runId");
  if (!conversationId && !runId) return c.json({ error: "conversationId_or_runId_required" }, 400);

  const query = runId
    ? c.env.DATA_DB.prepare("SELECT * FROM transcript_records WHERE user_id=? AND run_id=? ORDER BY sequence").bind(userId, runId)
    : c.env.DATA_DB.prepare("SELECT * FROM transcript_records WHERE user_id=? AND conversation_id=? ORDER BY created_at,sequence").bind(userId, conversationId);
  const rows = await query.all();
  return c.json({ records: rows.results ?? [] });
});

transcriptsRoute.post("/events", async (c) => {
  const userId = requireUserId(c.req.raw);
  const body = await c.req.json<ConversationEventInput | { events: ConversationEventInput[] }>();
  const events = "events" in body ? body.events : [body];
  if (!events.length) return c.json({ events: [] }, 201);

  const grouped = groupByConversation(events);
  const nextSequences = new Map<string, number>();
  for (const conversationId of grouped.keys()) {
    if (!await ownsConversation(c.env, userId, conversationId)) {
      return c.json({ error: "conversation_not_found", conversationId }, 404);
    }
    nextSequences.set(conversationId, await nextSequence(c.env, userId, conversationId));
  }

  const preparedEvents: PreparedConversationEvent[] = [];
  const createdSidePayloads: Array<{ payloadId: string; objectId: string; userId: string }> = [];
  try {
    for (const event of events) {
      if (event.artifactId) {
        const artifact = await readOwnedArtifact(c.env, userId, event.artifactId);
        if (!artifact) return c.json({ error: "artifact_not_found", artifactId: event.artifactId }, 404);
        if (artifact.conversationId && artifact.conversationId !== event.conversationId) {
          return c.json({ error: "artifact_conversation_mismatch", artifactId: event.artifactId }, 400);
        }
      }
      const sequence = event.sequence ?? nextSequences.get(event.conversationId) ?? 1;
      nextSequences.set(event.conversationId, sequence + 1);
      const eventId = event.id ?? `ce_${crypto.randomUUID()}`;
      const branchId = event.branchId ?? "main";
      const existing = await existingEventAtSequence(c.env, userId, event.conversationId, sequence);
      const segment = existing
        ? { id: existing.segmentId }
        : await ensureOpenSegment(c.env, userId, event.conversationId, branchId);
      const eventForStorage = existing && event.content
        ? { ...event, content: undefined }
        : event;
      const payload = await externalizeLargeContent(c.env, userId, { ...eventForStorage, id: eventId, branchId, sequence });
      if (payload.createdSidePayload) createdSidePayloads.push({ ...payload.createdSidePayload, userId });
      preparedEvents.push({
        event: payload.event,
        eventId,
        branchId,
        sequence,
        segmentId: segment.id,
        contentBytes: payload.contentBytes,
        isNew: !existing,
      });
    }

    const statements = preparedEvents.map(({ event, eventId, branchId, sequence, segmentId }) =>
      c.env.DATA_DB.prepare(
        `INSERT INTO conversation_events
         (id,user_id,conversation_id,turn_id,branch_id,logical_id,revision_id,revision_number,previous_revision_id,
          replaces_event_id,status,storage_version,projection_version,run_id,sequence,source,kind,visibility,role,content,summary,
          tool_call_id,tool_name,artifact_id,attachment_id,side_payload_id,segment_id,metadata)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(user_id,conversation_id,sequence) DO UPDATE SET
           turn_id=excluded.turn_id,
           branch_id=excluded.branch_id,
           logical_id=excluded.logical_id,
           revision_id=excluded.revision_id,
           revision_number=excluded.revision_number,
           previous_revision_id=excluded.previous_revision_id,
           replaces_event_id=excluded.replaces_event_id,
           status=excluded.status,
           storage_version=excluded.storage_version,
           projection_version=excluded.projection_version,
           run_id=excluded.run_id,
           source=excluded.source,
           kind=excluded.kind,
           visibility=excluded.visibility,
           role=excluded.role,
           content=COALESCE(excluded.content, conversation_events.content),
           summary=excluded.summary,
           tool_call_id=excluded.tool_call_id,
           tool_name=excluded.tool_name,
           artifact_id=excluded.artifact_id,
           attachment_id=excluded.attachment_id,
           side_payload_id=COALESCE(excluded.side_payload_id, conversation_events.side_payload_id),
           segment_id=conversation_events.segment_id,
           metadata=excluded.metadata`,
      ).bind(
        eventId,
        userId,
        event.conversationId,
        event.turnId ?? null,
        branchId,
        event.logicalId ?? eventId,
        event.revisionId ?? null,
        event.revisionNumber ?? 1,
        event.previousRevisionId ?? null,
        event.replacesEventId ?? null,
        event.status ?? "active",
        event.storageVersion ?? 1,
        event.projectionVersion ?? 1,
        event.runId ?? null,
        sequence,
        event.source,
        event.kind,
        event.visibility,
        event.role ?? roleFor(event.kind),
        event.content ?? null,
        event.summary ?? null,
        event.toolCallId ?? null,
        event.toolName ?? null,
        event.artifactId ?? null,
        event.attachmentId ?? null,
        event.sidePayloadId ?? null,
        segmentId,
        JSON.stringify(event.metadata ?? {}),
      ),
    );

    await c.env.DATA_DB.batch(statements);
    const newEvents = preparedEvents.filter((item) => item.isNew);
    await updateSegments(c.env, userId, newEvents);
    await supersedeReplacedEvents(c.env, userId, events);
    await rebuildActiveProjections(c.env, userId, [...grouped.keys()]);
    await sealEligibleSegments(c.env, userId, newEvents.map((item) => item.segmentId));
    await touchConversations(c.env, userId, [...grouped.keys()]);
    return c.json({ events: events.length, inserted: newEvents.length, updated: preparedEvents.length - newEvents.length }, 201);
  } catch (error) {
    for (const payload of createdSidePayloads) await cleanupSidePayload(c.env, payload.userId, payload.payloadId, payload.objectId);
    throw error;
  }
});

transcriptsRoute.get("/events", async (c) => {
  const userId = requireUserId(c.req.raw);
  const conversationId = c.req.query("conversationId");
  const runId = c.req.query("runId");
  const visibility = c.req.query("visibility");
  const limit = boundedLimit(c.req.query("limit"), 200);
  if (!conversationId && !runId) return c.json({ error: "conversationId_or_runId_required" }, 400);

  const filters = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (conversationId) {
    filters.push("conversation_id = ?");
    params.push(conversationId);
  }
  if (runId) {
    filters.push("run_id = ?");
    params.push(runId);
  }
  if (visibility) {
    filters.push("visibility = ?");
    params.push(visibility);
  }

  const rows = await c.env.DATA_DB.prepare(
    `SELECT id, conversation_id AS conversationId, turn_id AS turnId, branch_id AS branchId,
      logical_id AS logicalId, revision_id AS revisionId, revision_number AS revisionNumber,
      previous_revision_id AS previousRevisionId, replaces_event_id AS replacesEventId,
      status, storage_version AS storageVersion, projection_version AS projectionVersion,
      run_id AS runId, sequence, source, kind, visibility, role, content, summary, tool_call_id AS toolCallId,
      tool_name AS toolName, artifact_id AS artifactId, attachment_id AS attachmentId,
      side_payload_id AS sidePayloadId, segment_id AS segmentId,
      metadata, created_at AS createdAt
     FROM conversation_events
     WHERE ${filters.join(" AND ")}
     ORDER BY sequence ASC
     LIMIT ?`,
  ).bind(...params, limit).all<StoredConversationEvent>();
  return c.json({ events: decodeRows(rows.results ?? []) });
});

transcriptsRoute.get("/model", async (c) => {
  const userId = requireUserId(c.req.raw);
  const conversationId = c.req.query("conversationId");
  if (!conversationId) return c.json({ error: "conversationId_required" }, 400);

  const limit = boundedLimit(c.req.query("limit"), 80);
  const branchId = c.req.query("branchId") ?? "main";
  if (!await ownsConversation(c.env, userId, conversationId)) return c.json({ error: "not_found" }, 404);
  const projection = await readProjection(c.env, userId, conversationId, branchId, "model");
  const events = projection?.events.slice(-limit) ?? await activeEvents(c.env, userId, conversationId, branchId, ["model", "renderable"], limit);
  return c.json({ events, messages: modelMessages(events), toolResults: toolResultSummaries(events) });
});

transcriptsRoute.get("/renderable", async (c) => {
  const userId = requireUserId(c.req.raw);
  const conversationId = c.req.query("conversationId");
  if (!conversationId) return c.json({ error: "conversationId_required" }, 400);

  const limit = boundedLimit(c.req.query("limit"), 100);
  const branchId = c.req.query("branchId") ?? "main";
  if (!await ownsConversation(c.env, userId, conversationId)) return c.json({ error: "not_found" }, 404);
  const projection = await readProjection(c.env, userId, conversationId, branchId, "renderable");
  const events = projection?.events.slice(-limit) ?? await activeEvents(c.env, userId, conversationId, branchId, ["renderable"], limit);
  return c.json({ events });
});

transcriptsRoute.get("/projection", async (c) => {
  const userId = requireUserId(c.req.raw);
  const conversationId = c.req.query("conversationId");
  if (!conversationId) return c.json({ error: "conversationId_required" }, 400);
  const branchId = c.req.query("branchId") ?? "main";
  const projectionType = (c.req.query("type") ?? "renderable") as ProjectionType;
  if (!["renderable", "model", "audit"].includes(projectionType)) return c.json({ error: "invalid_projection_type" }, 400);
  if (!await ownsConversation(c.env, userId, conversationId)) return c.json({ error: "not_found" }, 404);
  const projection = await readProjection(c.env, userId, conversationId, branchId, projectionType);
  return projection ? c.json(projection) : c.json({ error: "not_found" }, 404);
});

transcriptsRoute.get("/turns", async (c) => {
  const userId = requireUserId(c.req.raw);
  const conversationId = c.req.query("conversationId");
  if (!conversationId) return c.json({ error: "conversationId_required" }, 400);
  const branchId = c.req.query("branchId") ?? "main";
  const limit = boundedLimit(c.req.query("limit"), 100);
  if (!await ownsConversation(c.env, userId, conversationId)) return c.json({ error: "not_found" }, 404);
  const events = await activeEvents(c.env, userId, conversationId, branchId, ["renderable", "model", "internal", "audit"], limit);
  const turns = groupTurns(events);
  return c.json({ conversationId, branchId, turns });
});

transcriptsRoute.get("/export", async (c) => {
  const userId = requireUserId(c.req.raw);
  const conversationId = c.req.query("conversationId");
  if (!conversationId) return c.json({ error: "conversationId_required" }, 400);
  const branchId = c.req.query("branchId") ?? "main";
  const includePayloads = c.req.query("includePayloads") === "true";
  if (!await ownsConversation(c.env, userId, conversationId)) return c.json({ error: "not_found" }, 404);

  const conversation = await c.env.DATA_DB.prepare(
    `SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
     FROM conversations WHERE id = ? AND user_id = ?`,
  ).bind(conversationId, userId).first();
  const events = await eventsForConversation(c.env, userId, conversationId, branchId);
  const projections = await c.env.DATA_DB.prepare(
    `SELECT projection_type AS projectionType, last_sequence AS lastSequence,
      event_count AS eventCount, updated_at AS updatedAt
     FROM active_transcript_projections
     WHERE user_id = ? AND conversation_id = ? AND branch_id = ?
     ORDER BY projection_type ASC`,
  ).bind(userId, conversationId, branchId).all();
  const segments = await c.env.DATA_DB.prepare(
    `SELECT id, segment_index AS segmentIndex, status, first_sequence AS firstSequence,
      last_sequence AS lastSequence, event_count AS eventCount, object_id AS objectId,
      compression, compressed_size_bytes AS compressedSizeBytes,
      uncompressed_size_bytes AS uncompressedSizeBytes, content_hash AS contentHash,
      seal_reason AS sealReason, opened_at AS openedAt, sealed_at AS sealedAt,
      created_at AS createdAt, updated_at AS updatedAt
     FROM transcript_segments
     WHERE user_id = ? AND conversation_id = ? AND branch_id = ?
     ORDER BY segment_index ASC`,
  ).bind(userId, conversationId, branchId).all();
  const sidePayloads = await sidePayloadExportRows(c.env, userId, conversationId, branchId, includePayloads);
  const storageObjects = await c.env.DATA_DB.prepare(
    `SELECT id, bucket, storage_key AS storageKey, resource_type AS resourceType,
      resource_id AS resourceId, content_type AS contentType, compression,
      size_bytes AS sizeBytes, compressed_size_bytes AS compressedSizeBytes,
      uncompressed_size_bytes AS uncompressedSizeBytes, content_hash AS contentHash,
      metadata, created_at AS createdAt
     FROM storage_objects
     WHERE user_id = ? AND conversation_id = ?
     ORDER BY created_at ASC`,
  ).bind(userId, conversationId).all();

  return c.json({
    format: "studio.transcript.export.v1",
    exportedAt: new Date().toISOString(),
    userId,
    conversation,
    branchId,
    events,
    projections: projections.results ?? [],
    segments: segments.results ?? [],
    sidePayloads,
    storageObjects: (storageObjects.results ?? []).map((row) => ({
      ...row,
      metadata: parseMetadata(String((row as { metadata?: string }).metadata ?? "{}")),
    })),
  });
});

transcriptsRoute.get("/payloads/:id", async (c) => {
  const userId = requireUserId(c.req.raw);
  const payload = await c.env.DATA_DB.prepare(
    `SELECT p.id, p.payload_kind AS payloadKind, p.summary, p.object_id AS objectId,
      o.content_type AS contentType
     FROM transcript_side_payloads p
     JOIN storage_objects o ON o.id = p.object_id AND o.user_id = p.user_id
     WHERE p.id = ? AND p.user_id = ?`,
  ).bind(c.req.param("id"), userId).first<{ id: string; payloadKind: string; summary: string | null; objectId: string; contentType: string }>();
  if (!payload) return c.json({ error: "not_found" }, 404);
  const object = await getManagedObject(c.env, userId, payload.objectId);
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": payload.contentType,
      "X-Studio-Payload-ID": payload.id,
      "X-Studio-Payload-Kind": payload.payloadKind,
    },
  });
});

transcriptsRoute.get("/segments", async (c) => {
  const userId = requireUserId(c.req.raw);
  const conversationId = c.req.query("conversationId");
  if (!conversationId) return c.json({ error: "conversationId_required" }, 400);
  const branchId = c.req.query("branchId") ?? "main";
  if (!await ownsConversation(c.env, userId, conversationId)) return c.json({ error: "not_found" }, 404);
  const rows = await c.env.DATA_DB.prepare(
    `SELECT id, segment_index AS segmentIndex, status, first_sequence AS firstSequence,
      last_sequence AS lastSequence, event_count AS eventCount, object_id AS objectId,
      compression, compressed_size_bytes AS compressedSizeBytes,
      uncompressed_size_bytes AS uncompressedSizeBytes, content_hash AS contentHash,
      seal_reason AS sealReason, opened_at AS openedAt, sealed_at AS sealedAt, updated_at AS updatedAt
     FROM transcript_segments
     WHERE user_id = ? AND conversation_id = ? AND branch_id = ?
     ORDER BY segment_index ASC`,
  ).bind(userId, conversationId, branchId).all();
  return c.json({ segments: rows.results ?? [] });
});

transcriptsRoute.post("/segments/seal", async (c) => {
  const userId = requireUserId(c.req.raw);
  const body = await c.req.json<{ conversationId: string; branchId?: string; segmentId?: string; reason?: string }>();
  if (!await ownsConversation(c.env, userId, body.conversationId)) return c.json({ error: "not_found" }, 404);
  const sealed = body.segmentId
    ? await sealSegment(c.env, userId, body.segmentId, body.reason ?? "manual")
    : await sealOpenSegmentsForConversation(c.env, userId, body.conversationId, body.branchId ?? "main", body.reason ?? "manual");
  return c.json({ sealed });
});

transcriptsRoute.post("/segments/seal-inactive", async (c) => {
  const userId = requireUserId(c.req.raw);
  const body = await c.req.json<{ inactiveMinutes?: number; conversationId?: string; branchId?: string }>().catch((): { inactiveMinutes?: number; conversationId?: string; branchId?: string } => ({}));
  const inactiveMinutes = Math.max(1, Math.min(Math.floor(body.inactiveMinutes ?? 24 * 60), 30 * 24 * 60));
  const cutoff = new Date(Date.now() - inactiveMinutes * 60_000).toISOString();
  const filters = ["user_id = ?", "status = 'open'", "updated_at < ?"];
  const params: unknown[] = [userId, cutoff];
  if (body.conversationId) {
    filters.push("conversation_id = ?");
    params.push(body.conversationId);
  }
  if (body.branchId) {
    filters.push("branch_id = ?");
    params.push(body.branchId);
  }
  const rows = await c.env.DATA_DB.prepare(
    `SELECT id FROM transcript_segments WHERE ${filters.join(" AND ")}`,
  ).bind(...params).all<{ id: string }>();
  let sealed = 0;
  for (const row of rows.results ?? []) sealed += await sealSegment(c.env, userId, row.id, "inactive");
  return c.json({ sealed, inactiveMinutes, cutoff });
});

transcriptsRoute.get("/segments/:id", async (c) => {
  const userId = requireUserId(c.req.raw);
  const segment = await c.env.DATA_DB.prepare(
    `SELECT id, object_id AS objectId, compression
     FROM transcript_segments
     WHERE id = ? AND user_id = ? AND status = 'sealed'`,
  ).bind(c.req.param("id"), userId).first<{ id: string; objectId: string | null; compression: string }>();
  if (!segment?.objectId) return c.json({ error: "not_found" }, 404);
  const object = await getManagedObject(c.env, userId, segment.objectId);
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Studio-Segment-ID": segment.id,
    },
  });
});

function modelMessages(events: ReturnType<typeof decodeRows>): Array<{ role: EventRole; content: string; createdAt: string }> {
  return events.flatMap((event) => {
    if (!event.role || !event.content) return [];
    if (!["system_message", "user_message", "assistant_message", "tool_result"].includes(event.kind)) return [];
    return [{ role: event.role, content: event.content, createdAt: event.createdAt }];
  });
}

function toolResultSummaries(events: ReturnType<typeof decodeRows>): Array<{ toolName: string; summary: string }> {
  return events.flatMap((event) => {
    if (event.kind !== "tool_result" || !event.toolName) return [];
    return [{ toolName: event.toolName, summary: event.summary ?? event.content ?? "" }];
  }).filter((item) => item.summary);
}

function groupTurns(events: ReturnType<typeof decodeRows>) {
  const turns = new Map<string, { turnId: string; firstSequence: number; lastSequence: number; status: string; events: ReturnType<typeof decodeRows> }>();
  for (const event of events) {
    const turnId = event.turnId ?? `sequence:${event.sequence}`;
    const current = turns.get(turnId) ?? {
      turnId,
      firstSequence: event.sequence,
      lastSequence: event.sequence,
      status: "active",
      events: [] as ReturnType<typeof decodeRows>,
    };
    current.firstSequence = Math.min(current.firstSequence, event.sequence);
    current.lastSequence = Math.max(current.lastSequence, event.sequence);
    current.events.push(event);
    if (event.kind === "interruption") current.status = "interrupted";
    if (event.kind === "assistant_message" || event.kind === "planner_message") current.status = "completed";
    turns.set(turnId, current);
  }
  return [...turns.values()].sort((a, b) => a.firstSequence - b.firstSequence);
}

function decodeRows(rows: StoredConversationEvent[]) {
  return rows.map((row) => ({
    ...row,
    metadata: parseMetadata(row.metadata),
  }));
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function groupByConversation(events: ConversationEventInput[]): Map<string, ConversationEventInput[]> {
  const grouped = new Map<string, ConversationEventInput[]>();
  for (const event of events) {
    const list = grouped.get(event.conversationId) ?? [];
    list.push(event);
    grouped.set(event.conversationId, list);
  }
  return grouped;
}

async function ownsConversation(env: Env, userId: string, conversationId: string): Promise<boolean> {
  const row = await env.DATA_DB.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
    .bind(conversationId, userId)
    .first();
  return Boolean(row);
}

async function nextSequence(env: Env, userId: string, conversationId: string): Promise<number> {
  const row = await env.DATA_DB.prepare(
    "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM conversation_events WHERE user_id = ? AND conversation_id = ?",
  ).bind(userId, conversationId).first<{ next: number }>();
  return row?.next ?? 1;
}

async function existingEventAtSequence(
  env: Env,
  userId: string,
  conversationId: string,
  sequence: number,
): Promise<{ id: string; segmentId: string } | null> {
  const row = await env.DATA_DB.prepare(
    `SELECT id, segment_id AS segmentId
     FROM conversation_events
     WHERE user_id = ? AND conversation_id = ? AND sequence = ?`,
  ).bind(userId, conversationId, sequence).first<{ id: string; segmentId: string | null }>();
  return row ? { id: row.id, segmentId: row.segmentId ?? "" } : null;
}

async function touchConversations(env: Env, userId: string, conversationIds: string[]): Promise<void> {
  const now = new Date().toISOString();
  await env.DATA_DB.batch(conversationIds.map((conversationId) =>
    env.DATA_DB.prepare("UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(now, conversationId, userId),
  ));
}

function boundedLimit(input: string | undefined, fallback: number): number {
  const parsed = Number(input ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), 500));
}

function roleFor(kind: ConversationEventKind): EventRole | null {
  switch (kind) {
    case "user_message":
      return "user";
    case "assistant_message":
    case "planner_message":
      return "assistant";
    case "system_message":
      return "system";
    case "tool_result":
      return "tool";
    default:
      return null;
  }
}

async function supersedeReplacedEvents(env: Env, userId: string, events: ConversationEventInput[]): Promise<void> {
  const replacements = events.filter((event) => event.replacesEventId || event.previousRevisionId);
  if (!replacements.length) return;
  await env.DATA_DB.batch(replacements.map((event) => env.DATA_DB.prepare(
    `UPDATE conversation_events
     SET status = 'superseded'
     WHERE user_id = ? AND conversation_id = ? AND id = ?`,
  ).bind(userId, event.conversationId, event.replacesEventId ?? event.previousRevisionId)));
}

async function externalizeLargeContent(
  env: Env,
  userId: string,
  event: ConversationEventInput & { id: string; branchId: string; sequence: number },
): Promise<{ event: ConversationEventInput; contentBytes: number; createdSidePayload?: { payloadId: string; objectId: string } }> {
  const content = event.content ?? "";
  const contentBytes = new TextEncoder().encode(content).byteLength;
  if (!content || contentBytes <= INLINE_CONTENT_LIMIT_BYTES || event.sidePayloadId) {
    return { event, contentBytes };
  }

  const payloadId = `pay_${crypto.randomUUID()}`;
  const object = await putManagedObject(env, {
    userId,
    conversationId: event.conversationId,
    bucket: "conversations",
    resourceType: "side-payload",
    resourceId: payloadId,
    contentType: "text/plain; charset=utf-8",
    body: content,
    compress: "auto",
    metadata: {
      eventId: event.id,
      eventKind: event.kind,
      turnId: event.turnId,
      sequence: event.sequence,
    },
  });

  await env.DATA_DB.prepare(
    `INSERT INTO transcript_side_payloads
      (id,user_id,conversation_id,branch_id,event_id,object_id,payload_kind,summary)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).bind(
    payloadId,
    userId,
    event.conversationId,
    event.branchId,
    event.id,
    object.id,
    event.kind,
    event.summary ?? content.slice(0, 2_000),
  ).run();

  return {
    event: {
      ...event,
      content: nullContentFor(event),
      sidePayloadId: payloadId,
      metadata: {
        ...(event.metadata ?? {}),
        sidePayloadId: payloadId,
        objectId: object.id,
        originalContentBytes: contentBytes,
        compression: object.compression,
      },
    },
    contentBytes,
    createdSidePayload: { payloadId, objectId: object.id },
  };
}

async function cleanupSidePayload(env: Env, userId: string, payloadId: string, objectId: string): Promise<void> {
  await env.DATA_DB.prepare("DELETE FROM transcript_side_payloads WHERE id = ? AND user_id = ?")
    .bind(payloadId, userId)
    .run();
  await deleteManagedObject(env, userId, objectId);
}

function nullContentFor(event: ConversationEventInput): string | undefined {
  if (event.kind === "tool_result" || event.kind === "connector_result") return undefined;
  return event.summary ? undefined : `[Large ${event.kind} stored as side payload]`;
}

async function ensureOpenSegment(env: Env, userId: string, conversationId: string, branchId: string): Promise<SegmentRow> {
  const current = await env.DATA_DB.prepare(
    `SELECT id, segment_index AS segmentIndex, event_count AS eventCount,
      uncompressed_size_bytes AS uncompressedSizeBytes, status
     FROM transcript_segments
     WHERE user_id = ? AND conversation_id = ? AND branch_id = ? AND status = 'open'
     ORDER BY segment_index DESC LIMIT 1`,
  ).bind(userId, conversationId, branchId).first<SegmentRow>();
  if (current) return current;

  const max = await env.DATA_DB.prepare(
    `SELECT COALESCE(MAX(segment_index), 0) + 1 AS next
     FROM transcript_segments WHERE user_id = ? AND conversation_id = ? AND branch_id = ?`,
  ).bind(userId, conversationId, branchId).first<{ next: number }>();
  const id = `seg_${crypto.randomUUID()}`;
  const index = max?.next ?? 1;
  await env.DATA_DB.prepare(
    `INSERT INTO transcript_segments
      (id,user_id,conversation_id,branch_id,segment_index,status)
     VALUES(?,?,?,?,?,'open')`,
  ).bind(id, userId, conversationId, branchId, index).run();
  return { id, segmentIndex: index, eventCount: 0, uncompressedSizeBytes: 0, status: "open" };
}

async function updateSegments(
  env: Env,
  userId: string,
  preparedEvents: Array<{ event: ConversationEventInput; sequence: number; segmentId: string; contentBytes: number }>,
): Promise<void> {
  if (!preparedEvents.length) return;
  const bySegment = new Map<string, Array<{ sequence: number; contentBytes: number }>>();
  for (const item of preparedEvents) {
    const list = bySegment.get(item.segmentId) ?? [];
    list.push({ sequence: item.sequence, contentBytes: item.contentBytes });
    bySegment.set(item.segmentId, list);
  }
  const now = new Date().toISOString();
  await env.DATA_DB.batch([...bySegment.entries()].map(([segmentId, items]) => {
    const first = Math.min(...items.map((item) => item.sequence));
    const last = Math.max(...items.map((item) => item.sequence));
    const bytes = items.reduce((sum, item) => sum + item.contentBytes, 0);
    return env.DATA_DB.prepare(
      `UPDATE transcript_segments
       SET event_count = event_count + ?,
         first_sequence = COALESCE(first_sequence, ?),
         last_sequence = MAX(COALESCE(last_sequence, 0), ?),
         uncompressed_size_bytes = COALESCE(uncompressed_size_bytes, 0) + ?,
         updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).bind(items.length, first, last, bytes, now, segmentId, userId);
  }));
}

async function sealEligibleSegments(env: Env, userId: string, segmentIds: string[]): Promise<void> {
  for (const segmentId of [...new Set(segmentIds)]) {
    const segment = await env.DATA_DB.prepare(
      `SELECT id, event_count AS eventCount, uncompressed_size_bytes AS uncompressedSizeBytes, status
       FROM transcript_segments WHERE id = ? AND user_id = ?`,
    ).bind(segmentId, userId).first<SegmentRow>();
    if (!segment || segment.status !== "open") continue;
    const bytes = segment.uncompressedSizeBytes ?? 0;
    if (segment.eventCount >= SEGMENT_EVENT_LIMIT || bytes >= SEGMENT_UNCOMPRESSED_LIMIT_BYTES) {
      await sealSegment(env, userId, segmentId, segment.eventCount >= SEGMENT_EVENT_LIMIT ? "event_limit" : "size_limit");
    }
  }
}

async function sealOpenSegmentsForConversation(env: Env, userId: string, conversationId: string, branchId: string, reason: string): Promise<number> {
  const rows = await env.DATA_DB.prepare(
    `SELECT id FROM transcript_segments
     WHERE user_id = ? AND conversation_id = ? AND branch_id = ? AND status = 'open'`,
  ).bind(userId, conversationId, branchId).all<{ id: string }>();
  let sealed = 0;
  for (const row of rows.results ?? []) {
    sealed += await sealSegment(env, userId, row.id, reason);
  }
  return sealed;
}

async function sealSegment(env: Env, userId: string, segmentId: string, reason: string): Promise<number> {
  const segment = await env.DATA_DB.prepare(
    `SELECT id, conversation_id AS conversationId, branch_id AS branchId, segment_index AS segmentIndex,
      first_sequence AS firstSequence, last_sequence AS lastSequence, status
     FROM transcript_segments
     WHERE id = ? AND user_id = ?`,
  ).bind(segmentId, userId).first<{ id: string; conversationId: string; branchId: string; segmentIndex: number; firstSequence: number | null; lastSequence: number | null; status: "open" | "sealed" }>();
  if (!segment || segment.status === "sealed" || segment.firstSequence === null || segment.lastSequence === null) return 0;

  const events = await eventsForSegment(env, userId, segmentId);
  const payload = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  const object = await putManagedObject(env, {
    userId,
    conversationId: segment.conversationId,
    bucket: "conversations",
    resourceType: "transcript-segment",
    resourceId: segmentId,
    contentType: "application/x-ndjson; charset=utf-8",
    body: payload,
    compress: true,
    metadata: {
      branchId: segment.branchId,
      segmentIndex: segment.segmentIndex,
      firstSequence: segment.firstSequence,
      lastSequence: segment.lastSequence,
    },
  });
  const contentHash = `sha256:${await sha256Hex(payload)}`;
  await env.DATA_DB.prepare(
    `UPDATE transcript_segments
     SET status = 'sealed', object_id = ?, compression = ?, compressed_size_bytes = ?,
       uncompressed_size_bytes = ?, content_hash = ?, seal_reason = ?, sealed_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).bind(
    object.id,
    object.compression,
    object.compressedSizeBytes,
    object.uncompressedSizeBytes,
    contentHash,
    reason,
    new Date().toISOString(),
    new Date().toISOString(),
    segmentId,
    userId,
  ).run();
  return 1;
}

async function eventsForSegment(env: Env, userId: string, segmentId: string): Promise<ReturnType<typeof decodeRows>> {
  const rows = await env.DATA_DB.prepare(
    `SELECT id, conversation_id AS conversationId, turn_id AS turnId, branch_id AS branchId,
      logical_id AS logicalId, revision_id AS revisionId, revision_number AS revisionNumber,
      previous_revision_id AS previousRevisionId, replaces_event_id AS replacesEventId,
      status, storage_version AS storageVersion, projection_version AS projectionVersion,
      run_id AS runId, sequence, source, kind, visibility, role, content, summary,
      tool_call_id AS toolCallId, tool_name AS toolName, artifact_id AS artifactId,
      attachment_id AS attachmentId, side_payload_id AS sidePayloadId, segment_id AS segmentId,
      metadata, created_at AS createdAt
     FROM conversation_events
     WHERE user_id = ? AND segment_id = ?
     ORDER BY sequence ASC`,
  ).bind(userId, segmentId).all<StoredConversationEvent>();
  return decodeRows(rows.results ?? []);
}

async function eventsForConversation(
  env: Env,
  userId: string,
  conversationId: string,
  branchId: string,
): Promise<ReturnType<typeof decodeRows>> {
  const rows = await env.DATA_DB.prepare(
    `SELECT id, conversation_id AS conversationId, turn_id AS turnId, branch_id AS branchId,
      logical_id AS logicalId, revision_id AS revisionId, revision_number AS revisionNumber,
      previous_revision_id AS previousRevisionId, replaces_event_id AS replacesEventId,
      status, storage_version AS storageVersion, projection_version AS projectionVersion,
      run_id AS runId, sequence, source, kind, visibility, role, content, summary,
      tool_call_id AS toolCallId, tool_name AS toolName, artifact_id AS artifactId,
      attachment_id AS attachmentId, side_payload_id AS sidePayloadId, segment_id AS segmentId,
      metadata, created_at AS createdAt
     FROM conversation_events
     WHERE user_id = ? AND conversation_id = ? AND branch_id = ?
     ORDER BY sequence ASC`,
  ).bind(userId, conversationId, branchId).all<StoredConversationEvent>();
  return decodeRows(rows.results ?? []);
}

async function sidePayloadExportRows(
  env: Env,
  userId: string,
  conversationId: string,
  branchId: string,
  includePayloads: boolean,
): Promise<Array<Record<string, unknown>>> {
  const rows = await env.DATA_DB.prepare(
    `SELECT p.id, p.event_id AS eventId, p.object_id AS objectId, p.payload_kind AS payloadKind,
      p.summary, p.created_at AS createdAt, o.content_type AS contentType,
      o.compression, o.size_bytes AS sizeBytes, o.compressed_size_bytes AS compressedSizeBytes,
      o.uncompressed_size_bytes AS uncompressedSizeBytes, o.content_hash AS contentHash
     FROM transcript_side_payloads p
     JOIN storage_objects o ON o.id = p.object_id AND o.user_id = p.user_id
     WHERE p.user_id = ? AND p.conversation_id = ? AND p.branch_id = ?
     ORDER BY p.created_at ASC`,
  ).bind(userId, conversationId, branchId).all<{
    id: string;
    eventId: string | null;
    objectId: string;
    payloadKind: string;
    summary: string | null;
    createdAt: string;
    contentType: string;
    compression: string;
    sizeBytes: number;
    compressedSizeBytes: number | null;
    uncompressedSizeBytes: number | null;
    contentHash: string | null;
  }>();
  if (!includePayloads) return rows.results ?? [];

  const exported = [];
  for (const row of rows.results ?? []) {
    const object = await getManagedObject(env, userId, row.objectId);
    exported.push({
      ...row,
      content: object ? await new Response(object.body).text() : null,
    });
  }
  return exported;
}

async function rebuildActiveProjections(env: Env, userId: string, conversationIds: string[]): Promise<void> {
  for (const conversationId of conversationIds) {
    const branchIds = await env.DATA_DB.prepare(
      `SELECT DISTINCT branch_id AS branchId
       FROM conversation_events
       WHERE user_id = ? AND conversation_id = ?`,
    ).bind(userId, conversationId).all<{ branchId: string }>();
    for (const row of branchIds.results ?? [{ branchId: "main" }]) {
      await Promise.all([
        writeProjection(env, userId, conversationId, row.branchId, "renderable", ["renderable"]),
        writeProjection(env, userId, conversationId, row.branchId, "model", ["model", "renderable"]),
        writeProjection(env, userId, conversationId, row.branchId, "audit", ["renderable", "model", "internal", "audit"]),
      ]);
    }
  }
}

async function writeProjection(
  env: Env,
  userId: string,
  conversationId: string,
  branchId: string,
  projectionType: ProjectionType,
  visibilities: EventVisibility[],
): Promise<void> {
  const events = await activeEvents(env, userId, conversationId, branchId, visibilities, 500);
  const now = new Date().toISOString();
  const id = `tp_${conversationId}_${branchId}_${projectionType}`;
  const lastSequence = events.at(-1)?.sequence ?? 0;
  const payload = JSON.stringify({
    format: `studio.transcript.${projectionType}.v1`,
    conversationId,
    branchId,
    projectionType,
    events,
    updatedAt: now,
  });
  await env.DATA_DB.prepare(
    `INSERT INTO active_transcript_projections
      (id,user_id,conversation_id,branch_id,projection_type,last_sequence,event_count,payload,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id,conversation_id,branch_id,projection_type) DO UPDATE SET
       last_sequence=excluded.last_sequence,
       event_count=excluded.event_count,
       payload=excluded.payload,
       updated_at=excluded.updated_at`,
  ).bind(id, userId, conversationId, branchId, projectionType, lastSequence, events.length, payload, now, now).run();
}

async function readProjection(env: Env, userId: string, conversationId: string, branchId: string, projectionType: ProjectionType) {
  const row = await env.DATA_DB.prepare(
    `SELECT id, conversation_id AS conversationId, branch_id AS branchId, projection_type AS projectionType,
      last_sequence AS lastSequence, event_count AS eventCount, payload, updated_at AS updatedAt
     FROM active_transcript_projections
     WHERE user_id = ? AND conversation_id = ? AND branch_id = ? AND projection_type = ?`,
  ).bind(userId, conversationId, branchId, projectionType).first<StoredProjection>();
  if (!row) return null;
  const payload = JSON.parse(row.payload) as { events?: ReturnType<typeof decodeRows> };
  return { ...row, events: payload.events ?? [] };
}

async function activeEvents(
  env: Env,
  userId: string,
  conversationId: string,
  branchId: string,
  visibilities: EventVisibility[],
  limit: number,
): Promise<ReturnType<typeof decodeRows>> {
  const placeholders = visibilities.map(() => "?").join(",");
  const rows = await env.DATA_DB.prepare(
    `SELECT id, conversation_id AS conversationId, turn_id AS turnId, branch_id AS branchId,
      logical_id AS logicalId, revision_id AS revisionId, revision_number AS revisionNumber,
      previous_revision_id AS previousRevisionId, replaces_event_id AS replacesEventId,
      status, storage_version AS storageVersion, projection_version AS projectionVersion,
      run_id AS runId, sequence, source, kind, visibility, role, content, summary,
      tool_call_id AS toolCallId, tool_name AS toolName, artifact_id AS artifactId,
      attachment_id AS attachmentId, side_payload_id AS sidePayloadId, segment_id AS segmentId,
      metadata, created_at AS createdAt
     FROM conversation_events
     WHERE user_id = ? AND conversation_id = ? AND branch_id = ? AND status = 'active'
       AND visibility IN (${placeholders})
     ORDER BY sequence DESC
     LIMIT ?`,
  ).bind(userId, conversationId, branchId, ...visibilities, limit).all<StoredConversationEvent>();
  return decodeRows(rows.results ?? []).reverse();
}
