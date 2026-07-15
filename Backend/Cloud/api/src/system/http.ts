export function userIdFrom(request: Request): string | null {
  return request.headers.get("x-user-id") ?? request.headers.get("X-User-ID");
}

export function requireUserId(request: Request): string {
  const userId = userIdFrom(request);
  if (!userId) throw new ApiError("unauthorized", "X-User-ID is required.", 401);
  return userId;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 500, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: { code: error.code, message: error.message, details: error.details } }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: { code: "internal_error", message } }, { status: 500 });
}

export function withUserHeader(request: Request, userId: string): Headers {
  const headers = new Headers(request.headers);
  headers.set("x-user-id", userId);
  headers.set("X-User-ID", userId);
  return headers;
}
