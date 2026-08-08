import { addCORSHeaders } from "@gateway/middleware/cors";
import { logger } from "../../logger";

export function handleError(error: unknown): Response {
  logger.error("Request error", error);

  const response = new Response(
    JSON.stringify({
      error: {
        message: "Something went wrong. Please try again.",
        type: "internal_error",
      },
    }),
    {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }
  );

  return addCORSHeaders(response);
}
