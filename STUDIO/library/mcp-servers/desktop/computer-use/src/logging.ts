/**
 * Computer Use namespaced logger.
 *
 * Writes to stderr only — MCP speaks JSON-RPC over stdout, so logging must
 * never touch stdout or the protocol corrupts.
 */
import type { McpLogger } from "./server.js";
import { createNamespacedLogger } from "./server.js";

export const computerUseLogger: McpLogger = createNamespacedLogger("computer-use");
