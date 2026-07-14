import type { Env } from "../../env";
import { extractUserId } from "../middleware/auth";

export async function handleListMemories(request: Request, env: Env): Promise<Response> {
  const userId = await extractUserId(request, env);
  if (!userId || !env.MEMORY) return Response.json({ memories: [], total: 0 });

  const url    = new URL(request.url);
  const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);

  const res = await env.MEMORY.fetch(
    new Request(
      `http://memory/facts?user_id=${encodeURIComponent(userId)}&limit=${limit}`,
      env.MEMORY_AUTH_SECRET
        ? { headers: { Authorization: `Bearer ${env.MEMORY_AUTH_SECRET}` } }
        : undefined,
    )
  );
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
}

export async function handleDeleteMemory(
  memoryId: string,
  request:  Request,
  env:      Env,
): Promise<Response> {
  const userId = await extractUserId(request, env);
  const type   = new URL(request.url).searchParams.get("type") ?? "fact";
  if (!userId || !memoryId || !env.MEMORY) return Response.json({ deleted: false });

  const res = await env.MEMORY.fetch(
    new Request(
      `http://memory/facts/${encodeURIComponent(memoryId)}?user_id=${encodeURIComponent(userId)}&type=${type}`,
      {
        method:  "DELETE",
        headers: env.MEMORY_AUTH_SECRET ? { Authorization: `Bearer ${env.MEMORY_AUTH_SECRET}` } : {},
      }
    )
  );
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
}
