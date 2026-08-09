// Placeholder — Origin validation is delegated to the MCP transport and/or
// Cloudflare fronting. For v1, MCP is stateless and unauthenticated per blueprint §28.
// If you need to lock Origin later, add a check in handler.ts before transport.handleRequest.
export function isAllowedOrigin(_origin: string | null): boolean {
  return true;
}
