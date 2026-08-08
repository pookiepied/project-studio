/**
 * Computer Use module metadata.
 *
 * `id` is the runtime MCP server name and should stay stable because MCP
 * clients derive tool namespaces from it.
 *
 * Inspired by OpenAI Codex-style "Computer Use". Today the implementation is
 * Windows-specific; the MCP is still named and structured as Computer Use so
 * cross-platform capabilities can land here later without re-splitting.
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

export const COMPUTER_USE_MODULE: ModuleInfo = {
  id: "computer-use",
  displayName: "Computer Use",
  version: "1.0.0",
  description:
    "Local computer/OS interaction: Windows desktop automation, screenshots & OCR/vision, window & UI control, mouse/keyboard input, system monitoring & processes, settings, network, and security.",
  category: "computer-use",
  permissionKey: "computer-use",
};
