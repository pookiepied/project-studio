export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "not_implemented"
  | "internal_error";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError("bad_request", message, 400, details);
export const unauthorized = (message = "Missing x-user-id header.") => new AppError("unauthorized", message, 401);
export const forbidden = (message = "This resource is not available to the current user.") => new AppError("forbidden", message, 403);
export const notFound = (message = "Resource not found.") => new AppError("not_found", message, 404);
export const conflict = (message: string, details?: unknown) => new AppError("conflict", message, 409, details);
export const notImplemented = (message: string) => new AppError("not_implemented", message, 501);
