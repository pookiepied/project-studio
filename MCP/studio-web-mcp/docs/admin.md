# Admin — not implemented in v1

Per request, admin surface is omitted. Only endpoints:

- `GET /health` — liveness
- `POST /mcp` — MCP Streamable HTTP

Future admin (if needed) can be added as `GET /admin` behind Cloudflare Access.
