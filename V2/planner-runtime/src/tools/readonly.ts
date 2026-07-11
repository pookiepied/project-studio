/**
 * Read-only tool policy: the planner may inspect (read files, list, search,
 * limited research) but never mutate. Every tool exposed to the planning loop
 * must pass this gate — write/execute/destructive capabilities are stripped
 * regardless of what the context package offers.
 */

export function isReadOnlyTool(_toolName: string): boolean {
  throw new Error("not_implemented");
}

export function filterToReadOnly(toolNames: string[]): string[] {
  return toolNames.filter(isReadOnlyTool);
}
