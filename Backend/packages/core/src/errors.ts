export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const unauthorized = () => new HttpError(401, "unauthorized");
export const forbidden = () => new HttpError(403, "forbidden");
export const badRequest = (why = "bad_request") => new HttpError(400, why);

/**
 * Missing and not-yours are the same answer on purpose: a 403 confirms the
 * resource exists, which is a free enumeration oracle. See ADR-0001 §IDOR.
 */
export const notFound = () => new HttpError(404, "not_found");

/**
 * Turns anything thrown into a response. Unrecognised errors become a bare 500
 * — the message and stack go to the log, never to the client.
 */
export function toResponse(err: unknown, requestId: string): Response {
  if (err instanceof HttpError) {
    return json({ error: err.code, request_id: requestId }, err.status);
  }
  console.error(
    JSON.stringify({
      evt: "unhandled_error",
      request_id: requestId,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
  return json({ error: "internal_error", request_id: requestId }, 500);
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
