import { Env } from "../env";

// Validates the Bearer token on incoming MCP requests.
//
// If MCP_API_KEY is not set the server runs without auth — intended for
// local development or self-trusted deployments. In production always set
// MCP_API_KEY and store the same value as config.authToken in the AI
// worker's D1 mcp_servers row for this server.
export function validateAuth(request: Request, env: Env): Response | null {
  if (request.method === "OPTIONS") return null;

  if (!env.MCP_API_KEY) return null;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Unauthorized", message: "Bearer token required." }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": 'Bearer realm="youtube-transcript-mcp"',
        },
      }
    );
  }

  const token = authHeader.slice(7).trim();
  if (token !== env.MCP_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Unauthorized", message: "Invalid API key." }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": 'Bearer realm="youtube-transcript-mcp"',
        },
      }
    );
  }

  return null;
}
