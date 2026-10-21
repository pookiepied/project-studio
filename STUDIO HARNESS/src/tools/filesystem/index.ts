import type { CallGate } from "../gate.js";
import { FileAccessLog } from "./access-log.js";
import { createDeleteTool } from "./delete.js";
import { createEditTool } from "./edit.js";
import { createMoveTool } from "./move.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export { FileAccessLog } from "./access-log.js";
export { formatNumbered } from "./read.js";

export interface FilesystemToolOptions {
  /**
   * Whether the calling conversation's model accepts image input. See
   * `NativeToolRegistrationOptions` for the three states and what undefined
   * means.
   */
  readonly acceptsImages?: (conversationId: string) => boolean | undefined;
}

/**
 * The filesystem family: read, write, edit, delete, move.
 *
 * Registered together and sharing one access log, because the rule that a
 * file must be read before it is modified only holds if all of them agree on
 * what has been read. Registering them separately with separate logs would
 * leave the rule enforceable in principle and absent in practice.
 *
 * There is no `list` tool: `glob` covers it, and two ways to enumerate a
 * directory is one more permission surface than the capability needs. There
 * is no `mkdir` tool either, for the same kind of reason: `write` creates
 * every missing parent directory already, so the only thing a separate tool
 * buys is an empty directory, which almost nothing needs.
 */
export function registerFilesystemTools(
  gate: CallGate,
  log = new FileAccessLog(),
  options: FilesystemToolOptions = {},
): FileAccessLog {
  gate.register(createReadTool(log, options));
  gate.register(createWriteTool(log));
  gate.register(createEditTool(log));
  gate.register(createDeleteTool(log));
  gate.register(createMoveTool(log));
  return log;
}
