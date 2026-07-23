import { toGatewayError } from "./normalizeError";

export function toErrorResponse(error: unknown, requestId?: string): Response {
  const gatewayError = toGatewayError(error);
  return Response.json(
    {
      error: {
        code: gatewayError.code,
        message: gatewayError.message,
        ...(gatewayError.details === undefined ? {} : { details: gatewayError.details }),
        ...(requestId ? { request_id: requestId } : {})
      }
    },
    {
      status: gatewayError.status,
      headers: requestId ? { "x-request-id": requestId } : undefined
    }
  );
}
