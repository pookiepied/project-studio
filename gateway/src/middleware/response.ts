import { addCORSHeaders } from "./cors";

export function createErrorResponse(message: string, status: number, type: string, request?: Request): Response {
  const response = new Response(
    JSON.stringify({ error: { message, type } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
  return addCORSHeaders(response, request);
}
