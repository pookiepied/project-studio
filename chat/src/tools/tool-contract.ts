/**
 * tool-contract — centralized timeout constants for the AI Worker's cloud tool layer.
 *
 * Single source of truth for every timeout governing an outbound HTTP call
 * from a cloud-side tool. All HTTP-calling tool implementations must import
 * from here rather than hardcoding millisecond values.
 *
 * Note: Composio timeouts live in mcp/hub/src/tools/composio/composioExecutor.ts —
 * Composio execution runs entirely in the hub worker.
 */

// ---------------------------------------------------------------------------
// Remote MCP timeouts
// ---------------------------------------------------------------------------

/**
 * Maximum time to wait for the initial HTTP probe response when calling a
 * remote (HTTP) MCP server via the Streamable HTTP transport.
 *
 * This covers the initial POST to the endpoint that probes for transport type.
 * Already hardcoded in RemoteMCPTool — exported here for documentation and
 * future consolidation.
 */
export const REMOTE_MCP_CONNECT_TIMEOUT_MS = 30_000;

/**
 * Maximum time to establish the SSE session and receive the endpoint event
 * when falling back to the legacy SSE transport.
 *
 * Already hardcoded in RemoteMCPTool — exported here for documentation.
 */
export const REMOTE_MCP_SSE_TIMEOUT_MS = 15_000;

/**
 * Maximum silence between consecutive SSE chunks while reading a result
 * from a remote MCP server. If no chunk arrives within this window the
 * stream is considered stalled and an error is thrown.
 *
 * Already hardcoded in RemoteMCPTool — exported here for documentation.
 */
export const REMOTE_MCP_SSE_CHUNK_TIMEOUT_MS = 30_000;
