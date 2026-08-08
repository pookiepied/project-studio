/**
 * Studio Harness module metadata.
 *
 * `id` is the runtime MCP server name and should stay stable because MCP
 * clients derive tool namespaces from it.
 */
export interface ModuleInfo {
  /** Runtime MCP server name. */
  id: string;
  /** User-facing display name. */
  displayName: string;
  version: string;
  description: string;
  category: string;
  /** Host permission key fragment. */
  permissionKey: string;
}

export const STUDIO_HARNESS_MODULE: ModuleInfo = {
  id: "studio-harness",
  displayName: "Studio Harness",
  version: "1.0.0",
  description:
    "Local coding/project harness: filesystem reads and edits, code search & intelligence, git inspection, shell/PowerShell, REPL, and LSP.",
  category: "harness",
  permissionKey: "studio-harness",
};
