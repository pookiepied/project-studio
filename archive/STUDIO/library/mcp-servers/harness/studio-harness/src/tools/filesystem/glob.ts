import { glob } from "glob";
import { TOOL_TIMEOUTS } from "../tool-contract.js";

// Excluded by default — matching these produces noise and can make a broad
// pattern (e.g. "**/*") take a very long time. Pass include_ignored: true to
// search them anyway.
const DEFAULT_IGNORE = ["**/node_modules/**", "**/.git/**"];

export async function globFiles(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const pattern = args.pattern as string;
  const searchPath = (args.path as string) || process.cwd();

  if (!pattern) return { error: "pattern is required" };

  const ignore = args.include_ignored === true ? [] : DEFAULT_IGNORE;
  // Enforce the contract's time ceiling: abort a runaway traversal instead of
  // hanging the session. glob (v11) cancels its walk when the signal aborts.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUTS.LOCAL_PROCESS);

  let files: string[];
  try {
    files = await glob(pattern, {
      cwd: searchPath,
      absolute: true,
      dot: false,
      ignore,
      signal: controller.signal,
    });
  } catch (e: any) {
    if (controller.signal.aborted) {
      return {
        error:
          `Glob timed out after ${TOOL_TIMEOUTS.LOCAL_PROCESS / 1000}s. ` +
          `Narrow the pattern or point it at a subdirectory.`,
      };
    }
    return {
      error: `Glob failed: ${e.message}. Check that the pattern is valid and the path exists.`,
    };
  } finally {
    clearTimeout(timer);
  }

  files.sort((a, b) => a.localeCompare(b));

  return { files, count: files.length };
}
