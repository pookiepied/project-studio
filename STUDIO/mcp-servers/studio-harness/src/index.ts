/**
 * Studio Harness MCP server entry point.
 *
 * Coding/project-harness capabilities: filesystem reads, code search &
 * intelligence, git inspection, shell/PowerShell, REPL, and LSP.
 */
import { createMcpServer } from "./server.js";
import { STUDIO_HARNESS_MODULE } from "./module-info.js";
import { harnessLogger } from "./logging.js";
import { formatHarnessError } from "./errors.js";

createMcpServer(STUDIO_HARNESS_MODULE.id, {
  logger: harnessLogger,
  formatError: formatHarnessError,
}).catch((err: unknown) => {
  process.stderr.write(
    `[fatal][studio-harness] failed to start: ${
      err instanceof Error ? err.stack ?? err.message : String(err)
    }\n`
  );
  process.exit(1);
});
