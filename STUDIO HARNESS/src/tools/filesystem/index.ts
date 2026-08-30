import type { CallGate } from "../gate.js";
import { FileAccessLog } from "./access-log.js";
import { createEditTool } from "./edit.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export { FileAccessLog } from "./access-log.js";
export { EDIT_DESCRIPTOR, createEditTool } from "./edit.js";
export { READ_DESCRIPTOR, createReadTool, formatNumbered } from "./read.js";
export { WRITE_DESCRIPTOR, createWriteTool } from "./write.js";

export interface FilesystemToolOptions {
  /**
   * Whether the calling conversation's model accepts image input. See
   * `NativeToolRegistrationOptions` for the three states and what undefined
   * means.
   */
  readonly acceptsImages?: (conversationId: string) => boolean | undefined;
}

/**
 * The filesystem family: read, write, edit.
 *
 * Registered together and sharing one access log, because the rule that a file
 * must be read before it is modified only holds if all three agree on what has
 * been read. Registering them separately with separate logs would leave the
 * rule enforceable in principle and absent in practice.
 *
 * There is no `list` tool: `glob` covers it, and two ways to enumerate a
 * directory is one more permission surface than the capability needs.
 */
export function registerFilesystemTools(
  gate: CallGate,
  log = new FileAccessLog(),
  options: FilesystemToolOptions = {},
): FileAccessLog {
  gate.register(createReadTool(log, options));
  gate.register(createWriteTool(log));
  gate.register(createEditTool(log));
  return log;
}
