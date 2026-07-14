import { forbidden, invalidRequest } from "../errors";

export function requireUserId(request: Request): string {
  const userId = request.headers.get("x-user-id") ?? request.headers.get("X-User-ID");
  if (!userId) throw invalidRequest("x-user-id header is required.");
  return userId;
}

export function assertSameUser(headerUserId: string, bodyUserId: string): void {
  if (headerUserId !== bodyUserId) throw forbidden("Request user does not match authenticated user.");
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidRequest("Request body must be an object.");
  return value as Record<string, unknown>;
}

export function jsonHeaders(userId: string): HeadersInit {
  return { "content-type": "application/json", "x-user-id": userId };
}
