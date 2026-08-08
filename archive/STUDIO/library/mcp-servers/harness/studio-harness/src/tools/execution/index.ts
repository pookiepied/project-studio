/**
 * Execution tools — export boundary.
 *
 * Primitive one-shot code execution: bash, powershell, and repl. Each runner
 * manages its own timeout + {error} contract internally (see run_process.ts),
 * so they are re-exported directly rather than through wrapTool.
 *
 * Stateful/background process management is intentionally NOT a primitive — it
 * belongs to a higher orchestration layer, not layer 1.
 */
export { executeBash } from "./bash.js";
export { executePowerShell } from "./powershell.js";
export { runRepl } from "./repl.js";
