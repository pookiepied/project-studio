/// <reference types="@cloudflare/workers-types" />

import type { Env } from "../env";

/**
 * Blackboard dispatch — resolves the conversation scope from the request body
 * and forwards the operation to the matching BlackboardDO instance.
 *
 * The DO is addressed by idFromName(scope), so the same conversationId always
 * maps to the same blackboard, whether the caller is the main agent (chat, via
 * the AGENTS service binding) or a sub-agent (this worker, directly).
 *
 * Routes (POST):
 *   /blackboard/write  { scope, key, value }
 *   /blackboard/read   { scope, key? }
 */
export async function handleBlackboard(
  pathname: string,
  request: Request,
  env: Env,
): Promise<Response> {
  let body: { scope?: string; [k: string]: unknown };
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const scope = typeof body.scope === "string" ? body.scope.trim() : "";
  if (!scope) return json({ error: "scope is required" }, 400);

  const op = pathname.endsWith("/write") ? "write"
           : pathname.endsWith("/read")  ? "read"
           : null;
  if (!op) return json({ error: "Unknown blackboard operation" }, 404);

  const id   = env.BLACKBOARD.idFromName(scope);
  const stub = env.BLACKBOARD.get(id);

  // Forward to the DO with the scope stripped (the DO instance is already scoped).
  return stub.fetch(
    new Request(`https://blackboard/blackboard/${op}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    }),
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
