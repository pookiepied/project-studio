/**
 * Centralized tool risk classification.
 *
 * Every local MCP tool (Studio Harness + Computer Use) is assigned a single
 * risk class. The permission engine reads this - never model-supplied values -
 * to decide whether a call may run, and whether it needs user approval given
 * the current action mode (review / autonomous). This is trusted app state.
 *
 * Enforcement lives at the execution boundary (see toolExecutor). This map is
 * the security source of truth: an unknown local tool is treated as the most
 * dangerous class by getToolRisk(), so a newly-added tool fails safe until it
 * is classified here.
 */

export type ToolRiskClass =
  | "read-only"          // pure reads of files/metadata (Studio Harness)
  | "file-write"         // create / edit / move files
  | "file-delete"        // delete files or directories
  | "shell"              // arbitrary shell / interpreter execution
  | "git-read"           // git inspection (status/diff/log/fetch)
  | "git-mutate"         // git state changes (commit/push/pull/branch)
  | "computer-observe"   // read-only desktop/OS observation (screens, metrics)
  | "computer-control"   // mouse/keyboard/window/UI actuation
  | "high-risk";         // system mutation: processes, services, registry,
                         // power, firewall, users, network, elevation, ssh

export type ToolRiskCategory =
  | "filesystem"
  | "shell"
  | "git"
  | "computer"
  | "system";

export interface RiskClassMeta {
  label: string;
  category: ToolRiskCategory;
  /** True if the action mutates state (vs. a pure read). */
  mutating: boolean;
  /** In REVIEW mode, prompt the user before running. */
  reviewRequiresApproval: boolean;
  /**
   * In AUTONOMOUS mode, STILL prompt before running. Reserved for
   * irreversible / system-critical actions - the hard floor that autonomy
   * cannot silently cross.
   */
  autonomousRequiresApproval: boolean;
}

export const RISK_CLASS_META: Record<ToolRiskClass, RiskClassMeta> = {
  "read-only":        { label: "Read file/metadata",   category: "filesystem", mutating: false, reviewRequiresApproval: false, autonomousRequiresApproval: false },
  "git-read":         { label: "Git inspection",        category: "git",        mutating: false, reviewRequiresApproval: false, autonomousRequiresApproval: false },
  "computer-observe": { label: "Observe screen/system", category: "computer",   mutating: false, reviewRequiresApproval: false, autonomousRequiresApproval: false },
  "file-write":       { label: "Write/edit file",       category: "filesystem", mutating: true,  reviewRequiresApproval: true,  autonomousRequiresApproval: false },
  "file-delete":      { label: "Delete file",           category: "filesystem", mutating: true,  reviewRequiresApproval: true,  autonomousRequiresApproval: false },
  "shell":            { label: "Run shell command",     category: "shell",      mutating: true,  reviewRequiresApproval: true,  autonomousRequiresApproval: false },
  "git-mutate":       { label: "Change git state",      category: "git",        mutating: true,  reviewRequiresApproval: true,  autonomousRequiresApproval: false },
  "computer-control": { label: "Control mouse/keyboard",category: "computer",   mutating: true,  reviewRequiresApproval: true,  autonomousRequiresApproval: false },
  "high-risk":        { label: "System-level change",   category: "system",     mutating: true,  reviewRequiresApproval: true,  autonomousRequiresApproval: true  },
};

/**
 * Tool name -> risk class. Names are the raw MCP tool names as dispatched by the
 * two local servers. Keep in sync with the servers' registries.
 *
 * Studio Harness: 33 tools. Computer Use: 116 tools.
 */
export const TOOL_RISK: Record<string, ToolRiskClass> = {
  // =========================== Studio Harness (33) ===========================
  // -- read-only (12) --
  read_file: "read-only",
  glob: "read-only",
  grep: "read-only",
  ls: "read-only",
  outline_file: "read-only",
  index_codebase: "read-only",       // writes only its own .studio/ index
  explore_codebase: "read-only",
  search_symbol: "read-only",
  analyze_file: "read-only",
  lsp: "read-only",
  sleep: "read-only",
  ask_user_question: "read-only",
  // -- file mutation (5) --
  edit_file: "file-write",
  multi_edit: "file-write",
  write_file: "file-write",
  move_file: "file-write",
  delete_file: "file-delete",
  // -- shell (3) --
  bash: "shell",
  powershell: "shell",
  repl: "shell",
  // -- git (11) --
  git_status: "git-read",
  git_diff: "git-read",
  git_log: "git-read",
  git_fetch: "git-read",
  git_show: "git-read",       // inspect a commit or read a file at a revision
  git_commit: "git-mutate",
  git_push: "git-mutate",
  git_pull: "git-mutate",
  git_branch: "git-mutate",
  git_stash: "git-mutate",    // mutates the working tree (save/pop/apply/drop)
  git_worktree: "git-mutate", // creates/removes on-disk linked checkouts
  // -- remote execution (2) --
  ssh_exec: "high-risk",     // arbitrary command execution on a remote host
  ssh_session: "high-risk",  // persistent remote shell

  // =========================== Computer Use (116) ============================
  // -- computer-observe (55): vision, screenshots, metrics, read-only queries --
  screenshot_and_analyze: "computer-observe",
  analyze_image: "computer-observe",
  ocr_file: "computer-observe",
  ocr_url: "computer-observe",
  capture_screenshot: "computer-observe",
  capture_window_screenshot: "computer-observe",
  screenshot_region: "computer-observe",
  annotated_snapshot: "computer-observe",
  ocr_screen: "computer-observe",
  list_windows: "computer-observe",
  get_active_window: "computer-observe",
  get_window_info: "computer-observe",
  wait_for_window: "computer-observe",
  get_ui_tree: "computer-observe",
  get_ui_element_value: "computer-observe",
  get_mouse_position: "computer-observe",
  get_clipboard: "computer-observe",
  get_system_stats: "computer-observe",
  get_cpu_details: "computer-observe",
  get_disk_io: "computer-observe",
  get_gpu_stats: "computer-observe",
  get_battery_info: "computer-observe",
  get_memory_details: "computer-observe",
  get_storage_info: "computer-observe",
  get_system_info: "computer-observe",
  get_drivers: "computer-observe",
  list_processes: "computer-observe",
  get_network_stats: "computer-observe",
  get_network_bandwidth: "computer-observe",
  read_event_log: "computer-observe",
  get_process_details: "computer-observe",
  get_registry_value: "computer-observe",
  list_registry_keys: "computer-observe",
  list_displays: "computer-observe",
  get_display_settings: "computer-observe",
  list_audio_devices: "computer-observe",
  get_volume: "computer-observe",
  list_power_plans: "computer-observe",
  get_firewall_status: "computer-observe",
  list_firewall_rules: "computer-observe",
  list_env_vars: "computer-observe",
  list_installed_apps: "computer-observe",
  list_startup_apps: "computer-observe",
  get_file_association: "computer-observe",
  list_scheduled_tasks: "computer-observe",
  list_users: "computer-observe",
  list_groups: "computer-observe",
  get_group_members: "computer-observe",
  ping_host: "computer-observe",
  check_port: "computer-observe",
  dns_lookup: "computer-observe",
  traceroute: "computer-observe",
  list_wifi_networks: "computer-observe",
  get_wifi_status: "computer-observe",
  list_adapters: "computer-observe",
  // -- computer-control (21): actuation of input, windows, UI, system-ui --
  focus_window: "computer-control",
  close_window: "computer-control",
  show_window: "computer-control",
  move_resize_window: "computer-control",
  launch_app: "computer-control",
  click_ui_element: "computer-control",
  set_ui_element_value: "computer-control",
  move_mouse: "computer-control",
  click_at: "computer-control",
  mouse_down: "computer-control",
  mouse_up: "computer-control",
  double_click_at: "computer-control",
  scroll_at: "computer-control",
  type_text: "computer-control",
  press_hotkey: "computer-control",
  drag_and_drop: "computer-control",
  key_down: "computer-control",
  key_up: "computer-control",
  set_clipboard: "computer-control",
  send_notification: "computer-control",
  show_dialog: "computer-control",
  // -- high-risk (40): process/service/registry/power/firewall/user/net --
  start_process: "high-risk",
  set_process_affinity: "high-risk",
  kill_process: "high-risk",
  set_process_priority: "high-risk",
  suspend_process: "high-risk",
  manage_service: "high-risk",
  set_service_startup: "high-risk",
  run_elevated: "high-risk",
  set_registry_value: "high-risk",
  delete_registry_value: "high-risk",
  delete_registry_key: "high-risk",
  set_display_resolution: "high-risk",
  set_display_scaling: "high-risk",
  set_display_orientation: "high-risk",
  set_volume: "high-risk",
  toggle_mute: "high-risk",
  set_default_audio_device: "high-risk",
  set_app_volume: "high-risk",
  set_power_plan: "high-risk",
  system_power_action: "high-risk",
  add_firewall_rule: "high-risk",
  remove_firewall_rule: "high-risk",
  set_env_var: "high-risk",
  remove_env_var: "high-risk",
  set_file_association: "high-risk",
  manage_startup_app: "high-risk",
  manage_scheduled_task: "high-risk",
  create_scheduled_task: "high-risk",
  create_user: "high-risk",
  delete_user: "high-risk",
  set_user_password: "high-risk",
  manage_user_account: "high-risk",
  manage_group_member: "high-risk",
  connect_wifi: "high-risk",
  disconnect_wifi: "high-risk",
  enable_adapter: "high-risk",
  disable_adapter: "high-risk",
  set_static_ip: "high-risk",
  set_dhcp: "high-risk",
  manage_hosts_file: "high-risk",
};

/**
 * Resolve a tool's risk class. Unknown local tools FAIL SAFE to "high-risk" so
 * a newly-introduced or renamed tool can never slip past the permission engine
 * unclassified.
 */
export function getToolRisk(toolName: string): ToolRiskClass {
  return TOOL_RISK[toolName] ?? "high-risk";
}

export function getRiskMeta(toolName: string): RiskClassMeta {
  return RISK_CLASS_META[getToolRisk(toolName)];
}

/** True if the tool only observes/reads and never mutates state. */
export function isReadOnlyTool(toolName: string): boolean {
  return !getRiskMeta(toolName).mutating;
}
