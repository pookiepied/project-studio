import type { Context } from "hono";
export function requireUser(c: Context): string | Response {
  const userId = c.req.header("x-user-id");
  return userId || c.json({ error: "unauthorized" }, 401);
}
