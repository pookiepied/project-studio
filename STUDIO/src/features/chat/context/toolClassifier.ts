/**
 * Tool display classification and generated-image helpers.
 *
 * Pure functions — no React dependencies. Importable anywhere.
 */

import type { ToolDisplayClass } from "./types";
import { SILENT_TOOLS, CAPSULE_NATIVE_TOOLS } from "./constants";

/**
 * Classify how a tool call should be rendered in the chat UI.
 *
 *   "silent"  — no card shown (background/meta tools)
 *   "capsule" — compact pill card
 *   "stream"  — expandable streaming card (Studio Harness, file ops, etc.)
 */
export function classifyToolDisplay(
  tool: string,
  server?: string
): ToolDisplayClass {
  if (server === "studio-harness" || server === "computer-use") return "stream";
  if (SILENT_TOOLS.has(tool)) return "silent";
  if (tool.startsWith("mcp_") || tool.includes("__")) return "capsule";
  if (CAPSULE_NATIVE_TOOLS.has(tool)) return "capsule";
  return "stream";
}

// ---------------------------------------------------------------------------
// Generated image cleanup
// ---------------------------------------------------------------------------

const GENERATED_IMAGE_RE =
  /\/adapters\/openai\/v1\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

export function extractGeneratedImageIds(text: string): string[] {
  const ids: string[] = [];
  const re = new RegExp(GENERATED_IMAGE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) ids.push(m[1]);
  return ids;
}

export function deleteRemoteImages(
  imageIds: string[],
  apiBase: string
): void {
  for (const id of imageIds) {
    fetch(`${apiBase}/adapters/openai/v1/images/${id}`, {
      method: "DELETE",
    }).catch(() => {});
  }
}
