export * from "@gateway/middleware/auth";

import { verifyBearerToken } from "@gateway/middleware/auth";
import type { Env } from "../../env";

/**
 * Extract and verify the authenticated user's ID from the request.
 *
 * Checks the Bearer JWT (or X-User-JWT header) against JWT_SECRET and returns
 * the `sub` claim. Returns null if the token is absent, invalid, expired, or
 * is a refresh token.
 *
 * Use this in route handlers that scope data to the requesting user — never
 * trust a client-supplied X-User-Id header as the source of truth.
 */
export async function extractUserId(request: Request, env: Env): Promise<string | null> {
  if (!env.JWT_SECRET) return null;
  const payload = await verifyBearerToken(request, env.JWT_SECRET, env.REVOKED_KV);
  return payload?.sub ?? null;
}
