/**
 * DSML tool-call parser.
 *
 * Some models (accessed via Ollama, Fireworks, or similar providers) emit
 * tool calls as inline DSML/XML markup rather than structured tool_use API
 * blocks. The Cloudflare DO backend doesn't parse this format — it streams
 * the raw text as regular content, so the markup appears verbatim in the chat.
 *
 * This module:
 *   1. Detects DSML blocks in a completed text response (`hasDSML`)
 *   2. Parses them into `LocalToolCall` objects (`parseDSML`)
 *   3. Strips complete and partial blocks from the live stream display (`stripDSMLForStreaming`)
 *
 * Example input:
 *   Let me read that file for you.
 *   <｜｜DSML｜｜tool_calls>
 *     <｜｜DSML｜｜invoke name="read_file">
 *       <｜｜DSML｜｜parameter name="path" string="true">src/App.tsx</｜｜DSML｜｜parameter>
 *     </｜｜DSML｜｜invoke>
 *   </｜｜DSML｜｜tool_calls>
 *
 * Both ASCII `||` and fullwidth `｜｜` (U+FF5C) delimiters are matched.
 */

import type { LocalToolCall } from "../services/ai/types";

// ── Regex building blocks ──────────────────────────────────────────────────

/** Matches one or two ASCII or fullwidth vertical-bar characters. */
const V = `[|｜]{1,2}`;
/** Matches the DSML namespace delimiter  ||DSML||  or  ｜｜DSML｜｜  */
const NS = `${V}DSML${V}`;

/** Complete <｜｜DSML｜｜tool_calls>…</｜｜DSML｜｜tool_calls> block. */
const BLOCK_RE = new RegExp(`<${NS}tool_calls>[\\s\\S]*?<\\/${NS}tool_calls>`, "g");

/** <｜｜DSML｜｜invoke name="…">…</｜｜DSML｜｜invoke> */
const INVOKE_RE = new RegExp(`<${NS}invoke\\s+name="([^"]+)">[\\s\\S]*?<\\/${NS}invoke>`, "g");

/** <｜｜DSML｜｜parameter name="…" …>value</｜｜DSML｜｜parameter> */
const PARAM_RE = new RegExp(`<${NS}parameter\\s+name="([^"]+)"(?:\\s+[^>]*)?>(${`[\\s\\S]`}*?)<\\/${NS}parameter>`, "g");

/** Partial DSML opening — a `<` followed by a vertical bar at end of text (mid-stream). */
const PARTIAL_RE = new RegExp(`<[|｜][\\s\\S]*$`);

// ── local-MCP tool → server routing ───────────────────────────────────────
// Computer Use owns desktop, system, network, and vision tools (formerly
// split across studio-desktop / studio-system / studio-network). Groups are
// kept separate only for traceability — all three resolve to "computer-use".

const DESKTOP_TOOLS = new Set([
  "screenshot_and_analyze", "analyze_image", "fetch_image_url", "ocr_file", "ocr_url",
  "capture_screenshot", "capture_window_screenshot", "screenshot_region", "annotated_snapshot", "ocr_screen",
  "list_windows", "get_active_window", "get_window_info", "focus_window", "close_window",
  "show_window", "move_resize_window", "wait_for_window", "launch_app",
  "get_ui_tree", "click_ui_element", "get_ui_element_value", "set_ui_element_value",
  "move_mouse", "click_at", "double_click_at", "scroll_at", "type_text", "press_hotkey",
  "get_mouse_position", "drag_and_drop", "key_down", "key_up",
  "get_clipboard", "set_clipboard", "send_notification", "show_dialog",
]);

const SYSTEM_TOOLS = new Set([
  "get_system_stats", "get_cpu_details", "get_disk_io", "get_gpu_stats", "get_battery_info",
  "get_memory_details", "get_storage_info", "get_system_info", "get_drivers", "list_processes",
  "get_network_stats", "get_network_bandwidth", "read_event_log",
  "start_process", "get_process_details", "set_process_affinity", "kill_process",
  "set_process_priority", "suspend_process", "manage_service", "set_service_startup", "run_elevated",
  "get_registry_value", "set_registry_value", "list_registry_keys", "delete_registry_value", "delete_registry_key",
  "list_displays", "get_display_settings", "set_display_resolution", "set_display_scaling", "set_display_orientation",
  "list_audio_devices", "get_volume", "set_volume", "toggle_mute", "set_default_audio_device", "set_app_volume",
  "list_power_plans", "set_power_plan", "system_power_action",
  "get_firewall_status", "list_firewall_rules", "add_firewall_rule", "remove_firewall_rule",
  "list_env_vars", "set_env_var", "remove_env_var",
  "list_installed_apps", "list_startup_apps", "get_file_association", "set_file_association", "manage_startup_app",
  "list_scheduled_tasks", "manage_scheduled_task", "create_scheduled_task",
  "list_users", "create_user", "delete_user", "set_user_password", "manage_user_account",
  "list_groups", "get_group_members", "manage_group_member",
]);

const NETWORK_TOOLS = new Set([
  "ssh_exec", "ssh_session",
  "ping_host", "check_port", "dns_lookup", "traceroute",
  "list_wifi_networks", "get_wifi_status", "connect_wifi", "disconnect_wifi",
  "list_adapters", "enable_adapter", "disable_adapter", "set_static_ip", "set_dhcp",
  "manage_hosts_file",
]);

// ── Public API ─────────────────────────────────────────────────────────────

export interface DSMLParseResult {
  /** Response text with all DSML tool_calls blocks removed. */
  cleaned: string;
  /** Tool calls extracted from the DSML blocks, ready for execution. */
  toolCalls: LocalToolCall[];
}

/**
 * Quick check: does the text contain any DSML tool_calls markup?
 * Use this as a fast guard before calling `parseDSML`.
 */
export function hasDSML(text: string): boolean {
  return new RegExp(`<${V}DSML${V}tool_calls>`).test(text);
}

/**
 * Parse DSML tool call blocks from an LLM text response.
 * Returns the stripped text and an array of tool calls ready for execution.
 */
export function parseDSML(text: string): DSMLParseResult {
  const toolCalls: LocalToolCall[] = [];

  for (const blockMatch of text.matchAll(BLOCK_RE)) {
    const block = blockMatch[0];

    for (const invMatch of block.matchAll(INVOKE_RE)) {
      const toolName = invMatch[1].trim();
      const invokeBody = invMatch[0];

      // Extract parameters
      const args: Record<string, unknown> = {};
      for (const paramMatch of invokeBody.matchAll(PARAM_RE)) {
        const key   = paramMatch[1].trim();
        const value = paramMatch[2].trim();
        // Attempt JSON decode; fall back to raw string
        try {
          args[key] = JSON.parse(value);
        } catch {
          args[key] = value;
        }
      }

      const server = inferServer(toolName);
      toolCalls.push({
        callId:   `dsml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tool:     toolName,
        mcpTool:  toolName,
        args,
        server,
      });
    }
  }

  const cleaned = text
    .replace(BLOCK_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleaned, toolCalls };
}

/**
 * Strip DSML markup from a partially-received text stream for live display.
 * Removes both complete blocks and any partial opening at the end of the buffer
 * (i.e. the stream is mid-block and hasn't received the closing tag yet).
 */
export function stripDSMLForStreaming(text: string): string {
  return text
    .replace(BLOCK_RE, "")   // complete blocks
    .replace(PARTIAL_RE, "") // partial block at end of buffer
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Infer the MCP server for a DSML-extracted tool name.
 * Computer Use (formerly desktop/system/network) owns all OS-level tools;
 * Studio Harness owns filesystem, git, execution, interaction, utils, lsp.
 */
function inferServer(toolName: string): string {
  if (DESKTOP_TOOLS.has(toolName))        return "computer-use";
  if (SYSTEM_TOOLS.has(toolName))         return "computer-use";
  if (NETWORK_TOOLS.has(toolName))        return "computer-use";
  return "studio-harness"; // default: filesystem, git, execution
}
