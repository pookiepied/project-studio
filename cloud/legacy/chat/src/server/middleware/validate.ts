/**
 * Request body validation helpers for route handlers.
 *
 * Each function returns a Response on failure or null on success.
 * Pattern:
 *   const err = requireFields(body, ["model", "messages"]); if (err) return err;
 */
import { addCORSHeaders } from "@gateway/middleware/cors";

function badRequest(message: string): Response {
  return addCORSHeaders(
    new Response(
      JSON.stringify({ error: { message, type: "invalid_request_error" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
  );
}

/**
 * Parse the request body as JSON.
 * Returns [body, null] on success or [null, errorResponse] on failure.
 */
export async function parseJsonBody<T extends Record<string, unknown>>(
  request: Request
): Promise<[T, null] | [null, Response]> {
  try {
    const body = await request.json() as T;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return [null, badRequest("Request body must be a JSON object.")];
    }
    return [body, null];
  } catch {
    return [null, badRequest("Invalid JSON body.")];
  }
}

/**
 * Assert that required fields exist and are non-null/non-empty.
 */
export function requireFields(
  body: Record<string, unknown>,
  fields: string[]
): Response | null {
  for (const field of fields) {
    const val = body[field];
    if (val === undefined || val === null || val === "") {
      return badRequest(`Missing required field: ${field}.`);
    }
  }
  return null;
}

/**
 * Assert that a field is a non-empty array.
 */
export function requireArray(
  body: Record<string, unknown>,
  field: string
): Response | null {
  const val = body[field];
  if (!Array.isArray(val) || val.length === 0) {
    return badRequest(`"${field}" must be a non-empty array.`);
  }
  return null;
}
