import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../../system/env";
import { deleteManagedObject, getManagedObject, putManagedObject } from "../../storage/objects";
import { readOwnedArtifact, requireOwnedConversation, requireUserId } from "../identity";

type ArtifactFamily =
  | "activity"
  | "research"
  | "generated_media"
  | "connector_record"
  | "connector_action"
  | "file"
  | "structured_data";
type ArtifactStatus =
  | "planned"
  | "proposed"
  | "awaiting_permission"
  | "running"
  | "streaming"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "cancelled"
  | "rejected"
  | "partial"
  | "superseded";
type ArtifactVisibility = "user_visible" | "internal" | "debug";
type ArtifactEventType =
  | "created"
  | "updated"
  | "progress"
  | "permission_requested"
  | "permission_decided"
  | "completed"
  | "failed"
  | "cancelled"
  | "rejected"
  | "superseded";
type PermissionDecision = "approved" | "rejected" | "cancelled" | "expired";

interface ArtifactWriteBody {
  artifactId?: string;
  conversationId?: string;
  turnId?: string;
  messageId?: string;
  executionId?: string;
  toolCallId?: string;
  permissionRequestId?: string;
  family?: ArtifactFamily;
  type?: string;
  schemaVersion?: number;
  rendererVersion?: number;
  status?: ArtifactStatus;
  visibility?: ArtifactVisibility;
  title?: string;
  summary?: string;
  modelPresentation?: Record<string, unknown>;
  runtimeData?: Record<string, unknown>;
  payload?: unknown;
  payloadContentType?: string;
  preview?: unknown;
  previewContentType?: string;
  payloadRef?: Record<string, unknown>;
  previewRef?: Record<string, unknown>;
  placement?: Record<string, unknown>;
  previousArtifactId?: string;
  createdByEventId?: string;
  updatedByEventId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

interface ArtifactUpdateBody extends Partial<ArtifactWriteBody> {
  createVersion?: boolean;
}

interface ArtifactEventBody {
  artifactVersionId?: string;
  conversationId?: string;
  eventType: ArtifactEventType;
  status?: ArtifactStatus;
  title?: string;
  summary?: string;
  modelPresentation?: Record<string, unknown>;
  runtimeData?: Record<string, unknown>;
  transcriptEventId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

interface PermissionDecisionBody {
  conversationId?: string;
  toolCallId?: string;
  permissionRequestId: string;
  decision: PermissionDecision;
  decidedBy?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

interface ArtifactRootRow {
  id: string;
  conversationId: string | null;
  turnId: string | null;
  messageId: string | null;
  executionId: string | null;
  toolCallId: string | null;
  permissionRequestId: string | null;
  family: ArtifactFamily;
  type: string;
  schemaVersion: number;
  rendererVersion: number;
  currentVersionId: string | null;
  currentVersion: number;
  status: ArtifactStatus;
  visibility: ArtifactVisibility;
  title: string;
  summary: string | null;
  createdByEventId: string | null;
  updatedByEventId: string | null;
  metadata: string;
  completedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ArtifactVersionRow {
  id: string;
  artifactId: string;
  conversationId: string | null;
  version: number;
  status: ArtifactStatus;
  title: string;
  summary: string | null;
  modelPresentation: string;
  runtimeData: string;
  payloadObjectId: string | null;
  previewObjectId: string | null;
  payloadRef: string;
  previewRef: string;
  placement: string;
  previousVersionId: string | null;
  createdByEventId: string | null;
  updatedByEventId: string | null;
  idempotencyKey: string | null;
  metadata: string;
  completedAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

const families = new Set<ArtifactFamily>(["activity", "research", "generated_media", "connector_record", "connector_action", "file", "structured_data"]);
const statuses = new Set<ArtifactStatus>(["planned", "proposed", "awaiting_permission", "running", "streaming", "waiting_for_input", "completed", "failed", "cancelled", "rejected", "partial", "superseded"]);
const visibilities = new Set<ArtifactVisibility>(["user_visible", "internal", "debug"]);
const eventTypes = new Set<ArtifactEventType>(["created", "updated", "progress", "permission_requested", "permission_decided", "completed", "failed", "cancelled", "rejected", "superseded"]);
const permissionDecisions = new Set<PermissionDecision>(["approved", "rejected", "cancelled", "expired"]);

export const artifactsRoute = new Hono<{ Bindings: Env }>();

artifactsRoute.get("/", async (c) => {
  const userId = requireUserId(c.req.raw);
  const conversationId = c.req.query("conversationId");
  const family = c.req.query("family");
  const limit = boundedLimit(c.req.query("limit"), 100);
  const filters = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (conversationId) {
    if (!await ownsConversation(c.env, userId, conversationId)) return c.json({ error: "not_found" }, 404);
    filters.push("conversation_id = ?");
    params.push(conversationId);
  }
  if (family) {
    if (!families.has(family as ArtifactFamily)) return c.json({ error: "invalid_family" }, 400);
    filters.push("family = ?");
    params.push(family);
  }
  const rows = await c.env.DATA_DB.prepare(
    `SELECT id, conversation_id AS conversationId, turn_id AS turnId, message_id AS messageId,
      execution_id AS executionId, tool_call_id AS toolCallId,
      permission_request_id AS permissionRequestId, family, type,
      schema_version AS schemaVersion, renderer_version AS rendererVersion,
      current_version_id AS currentVersionId, current_version AS currentVersion,
      status, visibility, title, summary, created_by_event_id AS createdByEventId,
      updated_by_event_id AS updatedByEventId, metadata, completed_at AS completedAt,
      failed_at AS failedAt, created_at AS createdAt, updated_at AS updatedAt
     FROM artifact_roots
     WHERE ${filters.join(" AND ")}
     ORDER BY updated_at DESC
     LIMIT ?`,
  ).bind(...params, limit).all<ArtifactRootRow>();
  return c.json({ artifacts: (rows.results ?? []).map(decodeRoot) });
});

artifactsRoute.post("/", async (c) => {
  const userId = requireUserId(c.req.raw);
  if (!isJsonRequest(c.req.raw)) return createLegacyArtifact(c, userId);
  const body = await c.req.json<ArtifactWriteBody>();
  const result = await createArtifact(c.env, userId, body);
  return c.json(result, 201);
});

artifactsRoute.get("/:id", async (c) => {
  const userId = requireUserId(c.req.raw);
  const artifact = await readArtifact(c.env, userId, c.req.param("id"));
  if (!artifact) return c.json({ error: "not_found" }, 404);
  return c.json(artifact);
});

artifactsRoute.patch("/:id", async (c) => {
  const userId = requireUserId(c.req.raw);
  const artifact = await readOwnedArtifact(c.env, userId, c.req.param("id"));
  if (!artifact) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<ArtifactUpdateBody>();
  const updated = await updateArtifact(c.env, userId, c.req.param("id"), artifact, body);
  return c.json(updated);
});

artifactsRoute.post("/:id/events", async (c) => {
  const userId = requireUserId(c.req.raw);
  const artifact = await readOwnedArtifact(c.env, userId, c.req.param("id"));
  if (!artifact) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<ArtifactEventBody>();
  if (!eventTypes.has(body.eventType)) return c.json({ error: "invalid_event_type" }, 400);
  if (body.status && !statuses.has(body.status)) return c.json({ error: "invalid_status" }, 400);
  const conversationId = await resolveArtifactConversation(c.env, userId, artifact.conversationId, body.conversationId);
  const sequence = await nextArtifactEventSequence(c.env, userId, c.req.param("id"));
  const eventId = `arte_${crypto.randomUUID()}`;
  await c.env.DATA_DB.prepare(
    `INSERT INTO artifact_events
      (id,user_id,artifact_id,artifact_version_id,conversation_id,sequence,event_type,status,title,summary,
       model_presentation,runtime_data,transcript_event_id,idempotency_key,metadata)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id,artifact_id,idempotency_key) DO UPDATE SET
       status=excluded.status,
       title=excluded.title,
       summary=excluded.summary,
       model_presentation=excluded.model_presentation,
       runtime_data=excluded.runtime_data,
       transcript_event_id=excluded.transcript_event_id,
       metadata=excluded.metadata`,
  ).bind(
    eventId,
    userId,
    c.req.param("id"),
    body.artifactVersionId ?? artifact.currentVersionId,
    conversationId,
    sequence,
    body.eventType,
    body.status ?? null,
    body.title ?? null,
    body.summary ?? null,
    stringifyObject(body.modelPresentation),
    stringifyObject(body.runtimeData),
    body.transcriptEventId ?? null,
    body.idempotencyKey ?? null,
    stringifyObject(body.metadata),
  ).run();
  if (body.status || body.title || body.summary) {
    await updateArtifactRootSnapshot(c.env, userId, c.req.param("id"), {
      status: body.status,
      title: body.title,
      summary: body.summary,
      updatedByEventId: body.transcriptEventId,
    });
  }
  return c.json({ id: eventId, artifactId: c.req.param("id"), sequence, eventType: body.eventType }, 201);
});

artifactsRoute.post("/:id/permissions", async (c) => {
  const userId = requireUserId(c.req.raw);
  const artifact = await readOwnedArtifact(c.env, userId, c.req.param("id"));
  if (!artifact) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<PermissionDecisionBody>();
  if (!permissionDecisions.has(body.decision)) return c.json({ error: "invalid_decision" }, 400);
  const conversationId = await resolveArtifactConversation(c.env, userId, artifact.conversationId, body.conversationId);
  const id = `apd_${crypto.randomUUID()}`;
  await c.env.DATA_DB.prepare(
    `INSERT INTO artifact_permission_decisions
      (id,user_id,artifact_id,conversation_id,tool_call_id,permission_request_id,decision,decided_by,reason,metadata)
     VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id,permission_request_id) DO UPDATE SET
       decision=excluded.decision,
       decided_by=excluded.decided_by,
       reason=excluded.reason,
       metadata=excluded.metadata`,
  ).bind(
    id,
    userId,
    c.req.param("id"),
    conversationId,
    body.toolCallId ?? null,
    body.permissionRequestId,
    body.decision,
    body.decidedBy ?? "user",
    body.reason ?? null,
    stringifyObject(body.metadata),
  ).run();
  const status: ArtifactStatus = body.decision === "approved" ? "running" : body.decision === "rejected" ? "rejected" : body.decision === "cancelled" ? "cancelled" : "failed";
  await updateArtifactRootSnapshot(c.env, userId, c.req.param("id"), { status });
  return c.json({ id, artifactId: c.req.param("id"), permissionRequestId: body.permissionRequestId, decision: body.decision, status }, 201);
});

artifactsRoute.get("/:id/content", async (c) => {
  const userId = requireUserId(c.req.raw);
  const version = await c.env.DATA_DB.prepare(
    `SELECT v.payload_object_id AS payloadObjectId, r.title
     FROM artifact_versions v
     JOIN artifact_roots r ON r.id = v.artifact_id AND r.user_id = v.user_id
     WHERE v.artifact_id = ? AND v.user_id = ? AND v.id = r.current_version_id`,
  ).bind(c.req.param("id"), userId).first<{ payloadObjectId: string | null; title: string }>();
  if (!version?.payloadObjectId) return c.json({ error: "not_found" }, 404);
  const object = await getManagedObject(c.env, userId, version.payloadObjectId);
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": object.record.contentType,
      "Content-Disposition": `inline; filename="${version.title.replace(/"/g, "")}"`,
    },
  });
});

artifactsRoute.delete("/:id", async (c) => {
  const userId = requireUserId(c.req.raw);
  const artifact = await readOwnedArtifact(c.env, userId, c.req.param("id"));
  if (!artifact) return c.json({ error: "not_found" }, 404);
  const objectRows = await c.env.DATA_DB.prepare(
    `SELECT payload_object_id AS objectId FROM artifact_versions WHERE user_id = ? AND artifact_id = ? AND payload_object_id IS NOT NULL
     UNION
     SELECT preview_object_id AS objectId FROM artifact_versions WHERE user_id = ? AND artifact_id = ? AND preview_object_id IS NOT NULL`,
  ).bind(userId, c.req.param("id"), userId, c.req.param("id")).all<{ objectId: string }>();
  for (const row of objectRows.results ?? []) await deleteManagedObject(c.env, userId, row.objectId);
  await c.env.DATA_DB.prepare("DELETE FROM artifact_permission_decisions WHERE artifact_id = ? AND user_id = ?").bind(c.req.param("id"), userId).run();
  await c.env.DATA_DB.prepare("DELETE FROM artifact_events WHERE artifact_id = ? AND user_id = ?").bind(c.req.param("id"), userId).run();
  await c.env.DATA_DB.prepare("DELETE FROM artifact_versions WHERE artifact_id = ? AND user_id = ?").bind(c.req.param("id"), userId).run();
  await c.env.DATA_DB.prepare("DELETE FROM artifact_roots WHERE id = ? AND user_id = ?").bind(c.req.param("id"), userId).run();
  return c.json({ deleted: true });
});

async function createArtifact(env: Env, userId: string, body: ArtifactWriteBody) {
  const family = normalizeFamily(body.family);
  const type = requiredString(body.type, "type");
  const title = requiredString(body.title, "title");
  const status = normalizeStatus(body.status ?? "planned");
  const visibility = normalizeVisibility(body.visibility ?? "user_visible");
  const conversationId = await requireOwnedConversation(env, userId, body.conversationId);
  const previousArtifact = body.previousArtifactId ? await readOwnedArtifact(env, userId, body.previousArtifactId) : null;
  if (body.previousArtifactId && !previousArtifact) throw new Error("previous_artifact_not_found");
  const artifactId = body.artifactId ?? `art_${crypto.randomUUID()}`;
  const versionId = `artv_${crypto.randomUUID()}`;
  const artifactConversationId = conversationId ?? previousArtifact?.conversationId ?? null;
  const payloadObjectId = await maybeStorePayload(env, userId, artifactConversationId, artifactId, "artifact_payload", body.payload, body.payloadContentType);
  const previewObjectId = await maybeStorePayload(env, userId, artifactConversationId, artifactId, "artifact_preview", body.preview, body.previewContentType);
  const now = new Date().toISOString();

  await env.DATA_DB.prepare(
    `INSERT INTO artifact_roots
      (id,user_id,conversation_id,turn_id,message_id,execution_id,tool_call_id,permission_request_id,
       family,type,schema_version,renderer_version,current_version_id,current_version,status,visibility,title,summary,
       created_by_event_id,updated_by_event_id,metadata,completed_at,failed_at,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    artifactId,
    userId,
    artifactConversationId,
    body.turnId ?? null,
    body.messageId ?? null,
    body.executionId ?? null,
    body.toolCallId ?? null,
    body.permissionRequestId ?? null,
    family,
    type,
    integerOrDefault(body.schemaVersion, 1),
    integerOrDefault(body.rendererVersion, 1),
    versionId,
    1,
    status,
    visibility,
    title,
    body.summary ?? null,
    body.createdByEventId ?? null,
    body.updatedByEventId ?? body.createdByEventId ?? null,
    stringifyObject(body.metadata),
    status === "completed" ? now : null,
    status === "failed" ? now : null,
    now,
    now,
  ).run();

  await insertVersion(env, userId, {
    id: versionId,
    artifactId,
    conversationId: artifactConversationId,
    version: 1,
    status,
    title,
    summary: body.summary,
    modelPresentation: body.modelPresentation,
    runtimeData: body.runtimeData,
    payloadObjectId,
    previewObjectId,
    payloadRef: body.payloadRef,
    previewRef: body.previewRef,
    placement: body.placement,
    previousVersionId: previousArtifact?.currentVersionId ?? null,
    createdByEventId: body.createdByEventId,
    updatedByEventId: body.updatedByEventId ?? body.createdByEventId,
    idempotencyKey: body.idempotencyKey,
    metadata: body.metadata,
    completedAt: status === "completed" ? now : null,
    failedAt: status === "failed" ? now : null,
  });
  await insertArtifactEvent(env, userId, artifactId, versionId, artifactConversationId, "created", status, title, body.summary, body.createdByEventId);
  return await readArtifact(env, userId, artifactId);
}

async function updateArtifact(
  env: Env,
  userId: string,
  artifactId: string,
  current: { conversationId: string | null; currentVersion: number; currentVersionId: string | null },
  body: ArtifactUpdateBody,
) {
  const status = body.status ? normalizeStatus(body.status) : undefined;
  const title = body.title;
  const summary = body.summary;
  const conversationId = await resolveArtifactConversation(env, userId, current.conversationId, body.conversationId);
  const createVersion = body.createVersion !== false && (
    body.payload !== undefined ||
    body.preview !== undefined ||
    body.modelPresentation !== undefined ||
    body.runtimeData !== undefined ||
    body.payloadRef !== undefined ||
    body.previewRef !== undefined ||
    body.placement !== undefined ||
    body.metadata !== undefined ||
    body.title !== undefined ||
    body.summary !== undefined
  );
  if (createVersion) {
    const previous = await readVersion(env, userId, current.currentVersionId);
    if (!previous) throw new Error("artifact_version_not_found");
    const versionId = `artv_${crypto.randomUUID()}`;
    const version = current.currentVersion + 1;
    const payloadObjectId = body.payload !== undefined
      ? await maybeStorePayload(env, userId, conversationId, artifactId, "artifact_payload", body.payload, body.payloadContentType)
      : previous.payloadObjectId;
    const previewObjectId = body.preview !== undefined
      ? await maybeStorePayload(env, userId, conversationId, artifactId, "artifact_preview", body.preview, body.previewContentType)
      : previous.previewObjectId;
    await insertVersion(env, userId, {
      id: versionId,
      artifactId,
      conversationId,
      version,
      status: status ?? previous.status,
      title: title ?? previous.title,
      summary: summary ?? previous.summary ?? undefined,
      modelPresentation: body.modelPresentation ?? parseObject(previous.modelPresentation),
      runtimeData: body.runtimeData ?? parseObject(previous.runtimeData),
      payloadObjectId,
      previewObjectId,
      payloadRef: body.payloadRef ?? parseObject(previous.payloadRef),
      previewRef: body.previewRef ?? parseObject(previous.previewRef),
      placement: body.placement ?? parseObject(previous.placement),
      previousVersionId: previous.id,
      createdByEventId: body.createdByEventId ?? previous.createdByEventId ?? undefined,
      updatedByEventId: body.updatedByEventId ?? previous.updatedByEventId ?? undefined,
      idempotencyKey: body.idempotencyKey,
      metadata: body.metadata ?? parseObject(previous.metadata),
      completedAt: (status ?? previous.status) === "completed" ? new Date().toISOString() : previous.completedAt,
      failedAt: (status ?? previous.status) === "failed" ? new Date().toISOString() : previous.failedAt,
    });
    await env.DATA_DB.prepare(
      `UPDATE artifact_roots
       SET current_version_id = ?, current_version = ?, status = ?, title = ?, summary = ?,
         updated_by_event_id = ?, completed_at = ?, failed_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).bind(
      versionId,
      version,
      status ?? previous.status,
      title ?? previous.title,
      summary ?? previous.summary,
      body.updatedByEventId ?? previous.updatedByEventId,
      (status ?? previous.status) === "completed" ? new Date().toISOString() : null,
      (status ?? previous.status) === "failed" ? new Date().toISOString() : null,
      new Date().toISOString(),
      artifactId,
      userId,
    ).run();
    await insertArtifactEvent(env, userId, artifactId, versionId, conversationId, eventTypeForStatus(status) ?? "updated", status, title, summary, body.updatedByEventId);
  } else {
    await updateArtifactRootSnapshot(env, userId, artifactId, { status, title, summary, updatedByEventId: body.updatedByEventId });
    await insertArtifactEvent(env, userId, artifactId, current.currentVersionId, conversationId, eventTypeForStatus(status) ?? "updated", status, title, summary, body.updatedByEventId);
  }
  return await readArtifact(env, userId, artifactId);
}

async function createLegacyArtifact(c: Context<{ Bindings: Env }>, userId: string) {
  const name = c.req.header("X-Artifact-Name") ?? `artifact-${Date.now()}`;
  const kind = c.req.header("X-Artifact-Kind") ?? "file";
  const conversationId = await requireOwnedConversation(c.env, userId, c.req.header("X-Conversation-ID"));
  const body = await c.req.raw.arrayBuffer();
  return c.json(await createArtifact(c.env, userId, {
    conversationId: conversationId ?? undefined,
    family: "file",
    type: kind,
    title: name,
    status: "completed",
    payload: body,
    payloadContentType: c.req.header("Content-Type") ?? "application/octet-stream",
    previousArtifactId: c.req.header("X-Previous-Artifact-ID") ?? undefined,
    createdByEventId: c.req.header("X-Created-By-Event-ID") ?? undefined,
    metadata: readMetadata(c.req.header("X-Artifact-Metadata") ?? null),
  }), 201);
}

async function readArtifact(env: Env, userId: string, artifactId: string) {
  const root = await env.DATA_DB.prepare(
    `SELECT id, conversation_id AS conversationId, turn_id AS turnId, message_id AS messageId,
      execution_id AS executionId, tool_call_id AS toolCallId,
      permission_request_id AS permissionRequestId, family, type,
      schema_version AS schemaVersion, renderer_version AS rendererVersion,
      current_version_id AS currentVersionId, current_version AS currentVersion,
      status, visibility, title, summary, created_by_event_id AS createdByEventId,
      updated_by_event_id AS updatedByEventId, metadata, completed_at AS completedAt,
      failed_at AS failedAt, created_at AS createdAt, updated_at AS updatedAt
     FROM artifact_roots WHERE id = ? AND user_id = ?`,
  ).bind(artifactId, userId).first<ArtifactRootRow>();
  if (!root) return null;
  const version = root.currentVersionId ? await readVersion(env, userId, root.currentVersionId) : null;
  const events = await env.DATA_DB.prepare(
    `SELECT id, artifact_version_id AS artifactVersionId, conversation_id AS conversationId,
      sequence, event_type AS eventType, status, title, summary, model_presentation AS modelPresentation,
      runtime_data AS runtimeData, transcript_event_id AS transcriptEventId, metadata, created_at AS createdAt
     FROM artifact_events
     WHERE artifact_id = ? AND user_id = ?
     ORDER BY sequence ASC
     LIMIT 100`,
  ).bind(artifactId, userId).all();
  return {
    ...decodeRoot(root),
    current: version ? decodeVersion(version) : null,
    events: (events.results ?? []).map((event) => decodeGeneric(event as Record<string, unknown>)),
  };
}

async function insertVersion(env: Env, userId: string, input: {
  id: string;
  artifactId: string;
  conversationId: string | null;
  version: number;
  status: ArtifactStatus;
  title: string;
  summary?: string | null;
  modelPresentation?: Record<string, unknown>;
  runtimeData?: Record<string, unknown>;
  payloadObjectId?: string | null;
  previewObjectId?: string | null;
  payloadRef?: Record<string, unknown>;
  previewRef?: Record<string, unknown>;
  placement?: Record<string, unknown>;
  previousVersionId?: string | null;
  createdByEventId?: string | null;
  updatedByEventId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
  completedAt?: string | null;
  failedAt?: string | null;
}) {
  await env.DATA_DB.prepare(
    `INSERT INTO artifact_versions
      (id,user_id,artifact_id,conversation_id,version,status,title,summary,model_presentation,runtime_data,
       payload_object_id,preview_object_id,payload_ref,preview_ref,placement,previous_version_id,
       created_by_event_id,updated_by_event_id,idempotency_key,metadata,completed_at,failed_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    input.id,
    userId,
    input.artifactId,
    input.conversationId,
    input.version,
    input.status,
    input.title,
    input.summary ?? null,
    stringifyObject(input.modelPresentation),
    stringifyObject(input.runtimeData),
    input.payloadObjectId ?? null,
    input.previewObjectId ?? null,
    stringifyObject(input.payloadRef),
    stringifyObject(input.previewRef),
    stringifyObject(input.placement),
    input.previousVersionId ?? null,
    input.createdByEventId ?? null,
    input.updatedByEventId ?? null,
    input.idempotencyKey ?? null,
    stringifyObject(input.metadata),
    input.completedAt ?? null,
    input.failedAt ?? null,
  ).run();
}

async function insertArtifactEvent(
  env: Env,
  userId: string,
  artifactId: string,
  artifactVersionId: string | null,
  conversationId: string | null,
  eventType: ArtifactEventType,
  status?: ArtifactStatus,
  title?: string,
  summary?: string | null,
  transcriptEventId?: string,
) {
  await env.DATA_DB.prepare(
    `INSERT INTO artifact_events
      (id,user_id,artifact_id,artifact_version_id,conversation_id,sequence,event_type,status,title,summary,transcript_event_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    `arte_${crypto.randomUUID()}`,
    userId,
    artifactId,
    artifactVersionId,
    conversationId,
    await nextArtifactEventSequence(env, userId, artifactId),
    eventType,
    status ?? null,
    title ?? null,
    summary ?? null,
    transcriptEventId ?? null,
  ).run();
}

async function maybeStorePayload(
  env: Env,
  userId: string,
  conversationId: string | null,
  artifactId: string,
  resourceType: "artifact_payload" | "artifact_preview",
  payload: unknown,
  contentType?: string,
): Promise<string | null> {
  if (payload === undefined || payload === null) return null;
  const normalizedContentType = contentType ?? (typeof payload === "string" ? "text/plain; charset=utf-8" : payload instanceof ArrayBuffer ? "application/octet-stream" : "application/json; charset=utf-8");
  const body = payload instanceof ArrayBuffer ? payload : typeof payload === "string" ? payload : JSON.stringify(payload);
  const object = await putManagedObject(env, {
    userId,
    conversationId,
    bucket: "generated",
    resourceType,
    resourceId: artifactId,
    contentType: normalizedContentType,
    body,
    compress: "auto",
    metadata: { artifactId, resourceType },
  });
  return object.id;
}

async function readVersion(env: Env, userId: string, versionId: string | null | undefined): Promise<ArtifactVersionRow | null> {
  if (!versionId) return null;
  const row = await env.DATA_DB.prepare(
    `SELECT id, artifact_id AS artifactId, conversation_id AS conversationId, version, status, title, summary,
      model_presentation AS modelPresentation, runtime_data AS runtimeData,
      payload_object_id AS payloadObjectId, preview_object_id AS previewObjectId,
      payload_ref AS payloadRef, preview_ref AS previewRef, placement,
      previous_version_id AS previousVersionId, created_by_event_id AS createdByEventId,
      updated_by_event_id AS updatedByEventId, idempotency_key AS idempotencyKey,
      metadata, completed_at AS completedAt, failed_at AS failedAt, created_at AS createdAt
     FROM artifact_versions WHERE id = ? AND user_id = ?`,
  ).bind(versionId, userId).first<ArtifactVersionRow>();
  return row ?? null;
}

async function updateArtifactRootSnapshot(env: Env, userId: string, artifactId: string, input: { status?: ArtifactStatus; title?: string; summary?: string | null; updatedByEventId?: string }) {
  const assignments = ["updated_at = ?"];
  const params: unknown[] = [new Date().toISOString()];
  if (input.status) {
    assignments.push("status = ?");
    params.push(input.status);
    if (input.status === "completed") {
      assignments.push("completed_at = ?");
      params.push(new Date().toISOString());
    }
    if (input.status === "failed") {
      assignments.push("failed_at = ?");
      params.push(new Date().toISOString());
    }
  }
  if (input.title) {
    assignments.push("title = ?");
    params.push(input.title);
  }
  if (input.summary !== undefined) {
    assignments.push("summary = ?");
    params.push(input.summary);
  }
  if (input.updatedByEventId) {
    assignments.push("updated_by_event_id = ?");
    params.push(input.updatedByEventId);
  }
  await env.DATA_DB.prepare(`UPDATE artifact_roots SET ${assignments.join(", ")} WHERE id = ? AND user_id = ?`)
    .bind(...params, artifactId, userId)
    .run();
}

async function resolveArtifactConversation(env: Env, userId: string, currentConversationId: string | null, requestedConversationId?: string): Promise<string | null> {
  const conversationId = await requireOwnedConversation(env, userId, requestedConversationId);
  if (conversationId && currentConversationId && conversationId !== currentConversationId) throw new Error("artifact_conversation_mismatch");
  return conversationId ?? currentConversationId;
}

async function ownsConversation(env: Env, userId: string, conversationId: string): Promise<boolean> {
  const row = await env.DATA_DB.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
    .bind(conversationId, userId)
    .first();
  return Boolean(row);
}

async function nextArtifactEventSequence(env: Env, userId: string, artifactId: string): Promise<number> {
  const row = await env.DATA_DB.prepare(
    "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM artifact_events WHERE user_id = ? AND artifact_id = ?",
  ).bind(userId, artifactId).first<{ next: number }>();
  return row?.next ?? 1;
}

function decodeRoot(row: ArtifactRootRow) {
  return {
    ...row,
    metadata: parseObject(row.metadata),
  };
}

function decodeVersion(row: ArtifactVersionRow) {
  return {
    ...row,
    modelPresentation: parseObject(row.modelPresentation),
    runtimeData: parseObject(row.runtimeData),
    payloadRef: parseObject(row.payloadRef),
    previewRef: parseObject(row.previewRef),
    placement: parseObject(row.placement),
    metadata: parseObject(row.metadata),
  };
}

function decodeGeneric(row: Record<string, unknown>) {
  return {
    ...row,
    modelPresentation: parseObject(String(row.modelPresentation ?? "{}")),
    runtimeData: parseObject(String(row.runtimeData ?? "{}")),
    metadata: parseObject(String(row.metadata ?? "{}")),
  };
}

function normalizeFamily(value: ArtifactFamily | undefined): ArtifactFamily {
  if (!value || !families.has(value)) throw new Error("invalid_artifact_family");
  return value;
}

function normalizeStatus(value: ArtifactStatus): ArtifactStatus {
  if (!statuses.has(value)) throw new Error("invalid_artifact_status");
  return value;
}

function normalizeVisibility(value: ArtifactVisibility): ArtifactVisibility {
  if (!visibilities.has(value)) throw new Error("invalid_artifact_visibility");
  return value;
}

function requiredString(value: string | undefined, field: string): string {
  if (!value || !value.trim()) throw new Error(`${field}_required`);
  return value.trim();
}

function stringifyObject(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  return parseObject(value);
}

function integerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function boundedLimit(input: string | undefined, fallback: number): number {
  const parsed = Number(input ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), 500));
}

function isJsonRequest(request: Request): boolean {
  return (request.headers.get("Content-Type") ?? "").toLowerCase().includes("application/json");
}

function eventTypeForStatus(status: ArtifactStatus | undefined): ArtifactEventType | null {
  if (!status) return null;
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "rejected") return "rejected";
  if (status === "superseded") return "superseded";
  return "updated";
}
