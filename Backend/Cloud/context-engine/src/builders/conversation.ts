import type { ConversationContext, ResolvedContextResource } from "../contracts";
import type { Env } from "../system/env";

/**
 * Conversation layer: current message, relevant history, prior tool results,
 * and attachments. Pulls relevant slices from Studio Data, never the full raw
 * history.
 */
export async function buildConversationContext(
  env: Env,
  userId: string,
  conversationId: string | undefined,
  task: string,
): Promise<ConversationContext> {
  if (!conversationId) return emptyConversation(task);

  const transcript = await readModelTranscript(env, userId, conversationId);
  if (transcript) {
    return {
      currentMessage: task,
      relevantHistory: transcript.messages.slice(-80),
      priorToolResults: transcript.toolResults.slice(-20),
      attachments: transcript.attachments,
      contextReferences: transcript.contextReferences,
      resolvedResources: transcript.resolvedResources,
    };
  }

  return readLegacyMessages(env, userId, conversationId, task);
}

async function readModelTranscript(env: Env, userId: string, conversationId: string): Promise<{
  messages: ConversationContext["relevantHistory"];
  toolResults: ConversationContext["priorToolResults"];
  attachments: ConversationContext["attachments"];
  contextReferences: ConversationContext["contextReferences"];
  resolvedResources: ConversationContext["resolvedResources"];
} | null> {
  const response = await env.DATA.fetch(`http://data/transcripts/model?conversationId=${encodeURIComponent(conversationId)}&limit=80`, { headers: { "x-user-id": userId } });
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) throw new Error(`Data transcript lookup failed (${response.status}).`);
  const body = await response.json<{
    messages?: Array<Record<string, unknown>>;
    toolResults?: Array<Record<string, unknown>>;
    events?: Array<Record<string, unknown>>;
  }>();
  if (!body.messages?.length && !body.toolResults?.length && !body.events?.length) return null;
  const messages = (body.messages ?? []).flatMap((row) => {
    const role = readRole(row.role);
    const content = typeof row.content === "string" ? row.content.slice(0, 32_000) : "";
    return role && content
      ? [{ role, content, createdAt: String(row.createdAt ?? row.created_at ?? new Date(0).toISOString()) }]
      : [];
  });
  const toolResults = (body.toolResults ?? []).flatMap((row) => {
    return typeof row.toolName === "string" && typeof row.summary === "string"
      ? [{ toolName: row.toolName, summary: row.summary.slice(0, 8_000) }]
      : [];
  });
  const events = body.events ?? [];
  const attachments = uniqueById(events.flatMap((row) => row.kind === "attachment_reference" && typeof row.attachmentId === "string"
    ? [{
      attachmentId: row.attachmentId,
      contentType: String((row.metadata as Record<string, unknown> | undefined)?.contentType ?? "application/octet-stream"),
      name: String((row.metadata as Record<string, unknown> | undefined)?.name ?? row.attachmentId),
    }]
    : []), (item) => item.attachmentId);
  const contextReferences = events.flatMap((row) => {
    const kind = readReferenceKind(row.kind);
    const id = typeof row.artifactId === "string" ? row.artifactId : typeof row.attachmentId === "string" ? row.attachmentId : typeof row.id === "string" ? row.id : "";
    const summary = typeof row.summary === "string" ? row.summary : typeof row.content === "string" ? row.content : "";
    return kind && id
      ? [{ id, kind, summary: summary.slice(0, 4_000) }]
      : [];
  });
  const resolvedResources = await resolveResources(env, userId, events, attachments);
  return { messages, toolResults, attachments, contextReferences, resolvedResources };
}

async function readLegacyMessages(env: Env, userId: string, conversationId: string, task: string): Promise<ConversationContext> {
  const response = await env.DATA.fetch(`http://data/conversations/${encodeURIComponent(conversationId)}/messages`, { headers: { "x-user-id": userId } });
  if (response.status === 404) return emptyConversation(task);
  if (!response.ok) throw new Error(`Data conversation lookup failed (${response.status}).`);
  const body = await response.json<{ items?: Array<Record<string, unknown>>; messages?: Array<Record<string, unknown>> }>();
  const rows = (body.items ?? body.messages ?? []).slice(-100);
  const relevantHistory = rows.flatMap((row) => {
    const role = row.role;
    const content = typeof row.content === "string" ? row.content.slice(0, 32_000) : "";
    return (role === "user" || role === "assistant" || role === "system") && content
      ? [{ role: role as "user" | "assistant" | "system", content, createdAt: String(row.createdAt ?? row.created_at ?? new Date(0).toISOString()) }]
      : [];
  });
  const priorToolResults = rows.flatMap((row) => Array.isArray(row.toolResults) ? row.toolResults.flatMap((value) => {
    const item = value as Record<string, unknown>;
    return typeof item.toolName === "string" && typeof item.summary === "string" ? [{ toolName: item.toolName, summary: item.summary }] : [];
  }) : []);
  const attachments = rows.flatMap((row) => Array.isArray(row.attachments) ? row.attachments.flatMap((value) => {
    const item = value as Record<string, unknown>;
    return typeof item.attachmentId === "string" ? [{ attachmentId: item.attachmentId, contentType: String(item.contentType ?? "application/octet-stream"), name: String(item.name ?? item.attachmentId) }] : [];
  }) : []);
  return { currentMessage: task, relevantHistory, priorToolResults, attachments, contextReferences: [], resolvedResources: [] };
}

function emptyConversation(task: string): ConversationContext {
  return { currentMessage: task, relevantHistory: [], priorToolResults: [], attachments: [], contextReferences: [], resolvedResources: [] };
}

function readRole(value: unknown): "system" | "user" | "assistant" | "tool" | null {
  return value === "system" || value === "user" || value === "assistant" || value === "tool" ? value : null;
}

function readReferenceKind(value: unknown): ConversationContext["contextReferences"][number]["kind"] | null {
  return value === "artifact_reference" ||
    value === "artifact_created" ||
    value === "artifact_updated" ||
    value === "artifact_completed" ||
    value === "artifact_failed" ||
    value === "artifact_permission_requested" ||
    value === "attachment_reference" ||
    value === "context_reference"
    ? value
    : null;
}

async function resolveResources(
  env: Env,
  userId: string,
  events: Array<Record<string, unknown>>,
  attachments: ConversationContext["attachments"],
): Promise<ResolvedContextResource[]> {
  const artifactRefs = uniqueById(events.flatMap((event) => {
    const kind = readReferenceKind(event.kind);
    if (!kind?.startsWith("artifact_")) return [];
    return typeof event.artifactId === "string"
      ? [{ artifactId: event.artifactId, sourceEventId: String(event.id ?? ""), summary: typeof event.summary === "string" ? event.summary : "" }]
      : [];
  }), (item) => item.artifactId);
  const [artifactResources, attachmentResources] = await Promise.all([
    Promise.all(artifactRefs.slice(-30).map((ref) => resolveArtifact(env, userId, ref.artifactId, ref.sourceEventId, ref.summary))),
    Promise.all(attachments.slice(-30).map((attachment) => resolveAttachment(env, userId, attachment))),
  ]);
  return [...artifactResources, ...attachmentResources].filter((item): item is ResolvedContextResource => Boolean(item));
}

async function resolveArtifact(
  env: Env,
  userId: string,
  artifactId: string,
  sourceEventId?: string,
  eventSummary?: string,
): Promise<ResolvedContextResource | null> {
  const response = await env.DATA.fetch(`http://data/artifacts/${encodeURIComponent(artifactId)}`, {
    headers: { "x-user-id": userId },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Data artifact lookup failed (${response.status}).`);
  const artifact = await response.json<Record<string, unknown>>();
  const current = readRecord(artifact.current);
  const contentType = readString(current?.payloadRef, "contentType") ?? readString(current?.runtimeData, "contentType");
  const hasPayload = typeof current?.payloadObjectId === "string";
  const summary = readString(artifact, "summary") ?? readString(current, "summary") ?? eventSummary;
  const resource: ResolvedContextResource = {
    id: artifactId,
    kind: "artifact",
    sourceEventId,
    conversationId: readString(artifact, "conversationId") ?? undefined,
    title: readString(artifact, "title") ?? artifactId,
    summary: summary || undefined,
    contentType,
    status: readString(artifact, "status") ?? undefined,
    family: readString(artifact, "family") ?? undefined,
    type: readString(artifact, "type") ?? undefined,
    inlineMode: inlineModeFor(contentType, readString(artifact, "family")),
    modelVisibility: shouldIncludeArtifact(readString(artifact, "visibility"), contentType, hasPayload) ? "include" : "reference_only",
    metadata: {
      schemaVersion: artifact.schemaVersion,
      rendererVersion: artifact.rendererVersion,
      currentVersionId: artifact.currentVersionId,
      currentVersion: artifact.currentVersion,
      placement: readRecord(current?.placement) ?? {},
      modelPresentation: readRecord(current?.modelPresentation) ?? {},
      runtimeData: safeRuntimeData(readRecord(current?.runtimeData)),
    },
  };
  if (resource.modelVisibility === "include") {
    resource.content = await readTextResource(env, userId, `http://data/artifacts/${encodeURIComponent(artifactId)}/content`);
    if (resource.content?.contentType) resource.contentType = resource.content.contentType;
    if (!resource.content) resource.modelVisibility = "reference_only";
  }
  return resource;
}

async function resolveAttachment(
  env: Env,
  userId: string,
  attachment: ConversationContext["attachments"][number],
): Promise<ResolvedContextResource | null> {
  const resource: ResolvedContextResource = {
    id: attachment.attachmentId,
    kind: "attachment",
    title: attachment.name,
    contentType: attachment.contentType,
    inlineMode: inlineModeFor(attachment.contentType),
    modelVisibility: isTextLike(attachment.contentType) ? "include" : isImageLike(attachment.contentType) ? "reference_only" : "reference_only",
    metadata: { name: attachment.name },
  };
  if (resource.modelVisibility === "include") {
    resource.content = await readTextResource(env, userId, `http://data/uploads/${encodeURIComponent(attachment.attachmentId)}`);
  }
  return resource;
}

async function readTextResource(env: Env, userId: string, url: string): Promise<ResolvedContextResource["content"] | undefined> {
  const response = await env.DATA.fetch(url, { headers: { "x-user-id": userId } });
  if (!response.ok) return undefined;
  const contentType = response.headers.get("Content-Type") ?? "application/octet-stream";
  if (!isTextLike(contentType)) return undefined;
  const text = await response.text();
  const limit = 24_000;
  return { format: "text", text: text.slice(0, limit), truncated: text.length > limit, contentType };
}

function inlineModeFor(contentType?: string, family?: string): ResolvedContextResource["inlineMode"] {
  if (family === "activity") return "summary";
  if (!contentType) return "reference";
  if (isTextLike(contentType)) return "text";
  if (isImageLike(contentType)) return "image";
  return "file";
}

function shouldIncludeArtifact(visibility: string | undefined, contentType: string | undefined, hasPayload: boolean): boolean {
  return visibility !== "internal" && visibility !== "debug" && (Boolean(contentType && isTextLike(contentType)) || hasPayload);
}

function isTextLike(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return normalized.startsWith("text/") || normalized.includes("json") || normalized.includes("markdown") || normalized.includes("xml") || normalized.includes("csv");
}

function isImageLike(contentType: string): boolean {
  return contentType.toLowerCase().startsWith("image/");
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(record: unknown, key: string): string | undefined {
  const object = readRecord(record);
  const value = object?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function safeRuntimeData(input: Record<string, unknown> | null): Record<string, unknown> {
  if (!input) return {};
  const redacted = { ...input };
  for (const key of Object.keys(redacted)) {
    const normalized = key.toLowerCase();
    if (normalized.includes("token") || normalized.includes("secret") || normalized.includes("credential") || normalized.includes("key")) {
      redacted[key] = "[redacted]";
    }
  }
  return redacted;
}

function uniqueById<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) seen.set(keyOf(item), item);
  return [...seen.values()];
}
