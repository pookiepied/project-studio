/**
 * Tool display classification.
 *
 * Pure functions — no React dependencies, no transport. Shared by cloud run
 * events and Studio CLI session events so both render through one display
 * model. Importable anywhere.
 */

import type { ToolDisplayClass } from "@/types/tools";

const SILENT_TOOLS = new Set([
  "think",
  "expand_tools",
  "skip_question",
  "claude_code",
  "skill_read",
  "current_time",
  "sleep",
]);

const CAPSULE_NATIVE_TOOLS = new Set([
  "web_search",
  "web_fetch",
  "http_request",
  "memory_read",
  "memory_write",
  "memory_update",
  "memory_delete",
  "memory_list",
  "image_generate",
  "video_generate",
  "rag",
  "task_write",
  "spawn_agent",
  "ask_user_question",
]);

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
