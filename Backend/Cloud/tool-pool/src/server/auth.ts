import type { ToolPoolScope } from "../contracts";

export function requireUserId(request: Request): string {
  const userId = request.headers.get("X-User-ID") ?? request.headers.get("x-user-id");
  if (!userId) throw new Error("X-User-ID required");
  return userId;
}

export function assertScopeUser(request: Request, body: Pick<ToolPoolScope, "userId">): void {
  const userId = requireUserId(request);
  if (body.userId !== userId) throw new Error("forbidden");
}

