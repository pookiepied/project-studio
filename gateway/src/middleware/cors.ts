import { CORS_CONFIG } from "../config/cors";

function resolveOrigin(request: Request): string {
  const origin = request.headers.get("Origin") ?? "";
  return (CORS_CONFIG.allowedOrigins as readonly string[]).includes(origin) ? origin : "";
}

export function handleCORS(request: Request): Response | null {
  if (request.method === "OPTIONS") {
    const origin = resolveOrigin(request);
    return new Response(null, {
      status: 204,
      headers: {
        ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
        "Access-Control-Allow-Methods": CORS_CONFIG.allowedMethods.join(", "),
        "Access-Control-Allow-Headers": CORS_CONFIG.allowedHeaders.join(", "),
        "Access-Control-Max-Age": CORS_CONFIG.maxAge.toString(),
        "Vary": "Origin",
      },
    });
  }
  return null;
}

export function addCORSHeaders(response: Response, request?: Request): Response {
  const origin = request ? resolveOrigin(request) : "";
  const headers = new Headers(response.headers);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", CORS_CONFIG.allowedMethods.join(", "));
  headers.set("Access-Control-Allow-Headers", CORS_CONFIG.allowedHeaders.join(", "));
  headers.set("Vary", "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
