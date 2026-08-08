import type { CallGate } from "../gate.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";

export { GLOB_DESCRIPTOR, createGlobTool } from "./glob.js";
export { GREP_DESCRIPTOR, createGrepTool, formatCounts, formatMatches } from "./grep.js";
export {
  DEFAULT_EXCLUDES,
  buildFilesArgs,
  buildSearchArgs,
  parseMatches,
  toRelative,
} from "./ripgrep.js";

/**
 * The search family: glob and grep.
 *
 * Separate from `filesystem/` because they depend on different things — these
 * two need the vendor resolver and a child process, and a missing ripgrep is a
 * failure that cannot happen to `read`. Families that break for different
 * reasons belong apart.
 */
export function registerSearchTools(gate: CallGate): void {
  gate.register(createGlobTool());
  gate.register(createGrepTool());
}
