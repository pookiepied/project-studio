import { apiManager } from "@/core/network/apiManager";
import { createHeaders } from "@/utils/api";

export interface KbDocument {
  id:         string;
  name:       string;
  size:       number;
  mimeType:   string;
  chunkCount: number;
  truncated:  boolean;
  createdAt:  number;
}

export interface MemoryFact {
  key:        string;
  content:    string;
  tags:       string[];
  category:   string;
  importance: number;
  updatedAt:  string;
}

async function getBase(): Promise<string> {
  const endpoints = await apiManager.getEndpoints();
  return endpoints.models.replace(/\/models$/, "");
}

function withUserId(headers: Record<string, string>, userId: string): Record<string, string> {
  return { ...headers, "X-User-Id": userId };
}

// ---------------------------------------------------------------------------
// Knowledge Base
// ---------------------------------------------------------------------------

export async function listKbDocs(userId: string): Promise<{ docs: KbDocument[]; totalBytes: number; count: number }> {
  const base    = await getBase();
  const headers = withUserId(await createHeaders(false) as Record<string, string>, userId);
  const res     = await fetch(`${base}/kb`, { headers });
  if (!res.ok) throw new Error(`KB list failed (${res.status})`);
  return res.json();
}

export async function indexKbDocument(
  text: string, fileName: string, size: number, mimeType: string, userId: string
): Promise<KbDocument> {
  const base    = await getBase();
  const headers = withUserId(await createHeaders() as Record<string, string>, userId);
  const res     = await fetch(`${base}/kb/index`, {
    method: "POST",
    headers,
    body:   JSON.stringify({ text, fileName, size, mimeType }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg);
  }
  const data = await res.json() as { docId: string; chunkCount: number; truncated: boolean };
  return {
    id:         data.docId,
    name:       fileName,
    size,
    mimeType,
    chunkCount: data.chunkCount,
    truncated:  data.truncated,
    createdAt:  Date.now(),
  };
}

export async function deleteKbDoc(docId: string, userId: string): Promise<void> {
  const base    = await getBase();
  const headers = withUserId(await createHeaders(false) as Record<string, string>, userId);
  const res     = await fetch(`${base}/kb/${encodeURIComponent(docId)}`, { method: "DELETE", headers });
  if (res.status !== 204 && !res.ok) throw new Error(`KB delete failed (${res.status})`);
}

// ---------------------------------------------------------------------------
// Memory facts (proxy to /user/memories)
// ---------------------------------------------------------------------------

export async function listMemoryFacts(
  userId: string, limit = 50
): Promise<{ memories: MemoryFact[]; total: number }> {
  const base    = await getBase();
  const headers = withUserId(await createHeaders(false) as Record<string, string>, userId);
  const res     = await fetch(`${base}/user/memories?limit=${limit}`, { headers });
  if (!res.ok) throw new Error(`Memories fetch failed (${res.status})`);
  return res.json();
}

export async function deleteMemoryFact(factId: string, userId: string): Promise<void> {
  const base    = await getBase();
  const headers = withUserId(await createHeaders(false) as Record<string, string>, userId);
  const res     = await fetch(
    `${base}/user/memories/${encodeURIComponent(factId)}?type=fact`,
    { method: "DELETE", headers }
  );
  if (res.status !== 204 && res.status !== 200 && !res.ok) {
    throw new Error(`Memory delete failed (${res.status})`);
  }
}
