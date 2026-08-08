/**
 * Computer Use MCP server entry point.
 *
 * Local computer/OS interaction capabilities — Windows desktop automation,
 * screenshots & OCR/vision, window & UI control, mouse/keyboard input, system
 * monitoring & processes, settings, network, and security.
 */
import { createMcpServer } from "./server.js";
import { COMPUTER_USE_MODULE } from "./module-info.js";
import { computerUseLogger } from "./logging.js";
import { formatComputerUseError } from "./errors.js";

createMcpServer(COMPUTER_USE_MODULE.id, {
  logger: computerUseLogger,
  formatError: formatComputerUseError,
}).catch((err: unknown) => {
  process.stderr.write(
    `[fatal][computer-use] failed to start: ${
      err instanceof Error ? err.stack ?? err.message : String(err)
    }\n`
  );
  process.exit(1);
});
