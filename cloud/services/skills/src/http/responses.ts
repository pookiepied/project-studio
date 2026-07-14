/**
 * JSON response helper + tiny auth guard shared by all internal REST routes.
 */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function validateAuth(request: Request, env: { SKILLS_AUTH_SECRET?: string }): boolean {
  if (!env.SKILLS_AUTH_SECRET) return true; // dev / internal-only: auth disabled
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return token === env.SKILLS_AUTH_SECRET;
}

/**
 * Reads a string field off a parsed JSON body with a safe default.
 */
export function str(body: Record<string, unknown>, key: string, fallback = ""): string {
  const v = body[key];
  return typeof v === "string" ? v : fallback;
}
