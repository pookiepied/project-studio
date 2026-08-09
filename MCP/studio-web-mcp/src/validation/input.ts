import { StudioError } from "../errors/error.js";
import { ErrorCodes } from "../errors/codes.js";

export function validateSearchQuery(q: string): string {
  if (!q || typeof q !== "string" || q.trim().length === 0) throw new StudioError(ErrorCodes.INVALID_QUERY, "query is required", 400);
  if (q.length > 500) throw new StudioError(ErrorCodes.INVALID_QUERY, "query too long (max 500)", 400);
  return q.trim();
}
