import type { MemoryReference, UserContext } from "../contracts";
import type { Env } from "../system/env";

/**
 * User layer: preferences, relevant long-term memories, workspace configuration,
 * and permission settings.
 */
export async function buildUserContext(
  env: Env,
  userId: string,
  task: string,
): Promise<UserContext> {
  const response = await env.MCP.fetch("http://mcp/internal/native/execute", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({
      serviceId: "memory",
      toolName: "memory_recall",
      toolArgs: { user_id: userId, query: task, limit: 5 },
    }),
  });
  if (!response.ok) throw new Error(`Memory lookup failed (${response.status}).`);
  const payload = await response.json<Record<string, unknown>>();
  const parsed = extractMemoryPayload(payload);
  return {
    preferences: parsed.preferences,
    relevantMemories: parsed.references.map((item) => item.content),
    memoryReferences: parsed.references,
    recentMemory: parsed.references.map((item) => item.summary ?? item.content),
    userProfile: parsed.preferences,
    permissions: [],
  };
}

function extractMemoryPayload(payload: Record<string, unknown>): {
  preferences: Record<string, string>;
  references: MemoryReference[];
} {
  const result = asRecord(payload.result) ?? payload;
  const direct = parseStructuredMemory(result);
  if (direct) return direct;

  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((item) => asRecord(item)?.text)
    .find((value): value is string => typeof value === "string");

  if (!text) return { preferences: {}, references: [] };

  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    return parseStructuredMemory(data) ?? {
      preferences: {},
      references: [memoryReference("mem_text_0", text, "long_term_memory")],
    };
  } catch {
    return {
      preferences: {},
      references: [memoryReference("mem_text_0", text.slice(0, 8_000), "long_term_memory")],
    };
  }
}

function parseStructuredMemory(data: Record<string, unknown>): {
  preferences: Record<string, string>;
  references: MemoryReference[];
} | null {
  const profile = asRecord(data.profile) ?? asRecord(data.userProfile) ?? {};
  const preferenceValues =
    arrayOfUnknown(profile.preference) ??
    arrayOfUnknown(profile.preferences) ??
    arrayOfUnknown(data.preferences) ??
    [];
  const preferences = Object.fromEntries(
    preferenceValues
      .map((value, index) => [String(index), memoryText(value)])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  const relevant = arrayOfUnknown(data.relevant) ?? arrayOfUnknown(data.memories) ?? arrayOfUnknown(data.results) ?? [];
  const references = relevant
    .map((value, index) => parseMemoryReference(value, index))
    .filter((value): value is MemoryReference => Boolean(value));

  if (Object.keys(preferences).length === 0 && references.length === 0) return null;
  return { preferences, references };
}

function parseMemoryReference(value: unknown, index: number): MemoryReference | null {
  const text = memoryText(value);
  if (!text) return null;
  const record = asRecord(value);
  const id =
    typeof record?.id === "string" ? record.id :
    typeof record?.memoryId === "string" ? record.memoryId :
    `mem_${index}`;
  const category = memoryCategory(record?.category);
  return {
    id,
    category,
    content: text,
    summary: typeof record?.summary === "string" ? record.summary : text.slice(0, 240),
    score: typeof record?.score === "number" ? record.score : undefined,
    source: typeof record?.source === "string" ? record.source : "memory",
    updatedAt: typeof record?.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

function memoryReference(id: string, content: string, category: MemoryReference["category"]): MemoryReference {
  return {
    id,
    category,
    content,
    summary: content.slice(0, 240),
    source: "memory",
  };
}

function memoryText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  if (!record) return "";
  for (const key of ["content", "text", "memory", "value", "summary"]) {
    const field = record[key];
    if (typeof field === "string" && field.trim()) return field.trim();
  }
  return "";
}

function memoryCategory(value: unknown): MemoryReference["category"] {
  if (
    value === "recent_memory" ||
    value === "user_profile" ||
    value === "long_term_memory" ||
    value === "task_memory"
  ) {
    return value;
  }
  return "long_term_memory";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayOfUnknown(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}
