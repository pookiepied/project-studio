import { analyzeImage, ocrFile, ocrUrl, screenshotAndAnalyze } from "./tools/vision/index.js";
import { readLocalSkill } from "./tools/skills/index.js";
import {
  // monitoring
  getSystemStats, getCpuDetails, getDiskIo, getGpuStats, getBatteryInfo,
  getMemoryDetails, getStorageInfo, getSystemInfo, getDrivers,
  listProcesses,
  getNetworkStats, getNetworkBandwidth,
  readEventLog,
  // control
  startProcess, getProcessDetails, setProcessAffinity,
  killProcess, setProcessPriority, suspendProcess,
  manageService, setServiceStartup,
  runElevated,
  // settings
  getRegistryValue, setRegistryValue, listRegistryKeys, deleteRegistryValue, deleteRegistryKey,
  listDisplays, getDisplaySettings, setDisplayResolution, setDisplayScaling, setDisplayOrientation,
  listAudioDevices, getVolume, setVolume, toggleMute, setDefaultAudioDevice, setAppVolume,
  listPowerPlans, setPowerPlan, systemPowerAction,
  getFirewallStatus, listFirewallRules, addFirewallRule, removeFirewallRule,
  listEnvVars, setEnvVar, removeEnvVar,
  listInstalledApps, listStartupApps, getFileAssociation, setFileAssociation, manageStartupApp,
  listScheduledTasks, manageScheduledTask, createScheduledTask,
  // automation
  captureScreenshot, captureWindowScreenshot,
  screenshotRegion, annotatedSnapshot, ocrScreen,
  listWindows, getWindowInfo, focusWindow, closeWindow, showWindow, moveResizeWindow,
  getActiveWindow, waitForWindow, launchApp,
  getUiTree, clickUiElement, getUiElementValue, setUiElementValue,
  moveMouse, clickAt, mouseDown, mouseUp, doubleClickAt, scrollAt, typeText, pressHotkey, getMousePosition,
  dragAndDrop, keyDown, keyUp,
  // network
  pingHost, checkPort, dnsLookup, traceroute,
  listWifiNetworks, getWifiStatus, connectWifi, disconnectWifi,
  listAdapters, enableAdapter, disableAdapter, setStaticIp, setDhcp,
  manageHostsFile,
  // security
  listUsers, createUser, deleteUser, setUserPassword, manageUserAccount,
  listGroups, getGroupMembers, manageGroupMember,
  // system-ui
  getClipboard, setClipboard,
  sendNotification,
  showDialog,
} from "./tools/desktop/index.js";

// Tool schema definitions are co-located with their handler folder. Each folder
// owns both its implementation and the JSON schema the AI sees via tools/list.
import { VISION_DEFINITIONS }            from "./tools/vision/definitions.js";
import { SKILL_DEFINITIONS }             from "./tools/skills/definitions.js";
import { DESKTOP_MONITORING_DEFINITIONS } from "./tools/desktop/monitoring/definitions.js";
import { DESKTOP_CONTROL_DEFINITIONS }    from "./tools/desktop/control/definitions.js";
import { DESKTOP_SETTINGS_DEFINITIONS }   from "./tools/desktop/settings/definitions.js";
import { DESKTOP_AUTOMATION_DEFINITIONS } from "./tools/desktop/automation/definitions.js";
import { DESKTOP_NETWORK_DEFINITIONS }    from "./tools/desktop/network/definitions.js";
import { DESKTOP_SECURITY_DEFINITIONS }   from "./tools/desktop/security/definitions.js";
import { DESKTOP_SYSTEM_UI_DEFINITIONS }  from "./tools/desktop/system-ui/definitions.js";
import { finalizeToolDefinitions } from "./tool-schema.js";

// ---------------------------------------------------------------------------
// Tool definitions (schema sent to the AI via tools/list)
//
// Composed from the per-folder definition arrays. This file only declares the
// ORDER tools are advertised in — to change a tool's schema, edit the
// definitions.ts in its folder, not here.
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = finalizeToolDefinitions([
  ...DESKTOP_MONITORING_DEFINITIONS, // hardware & OS stats (read-only)
  ...DESKTOP_CONTROL_DEFINITIONS,    // processes, services, elevation
  ...DESKTOP_SETTINGS_DEFINITIONS,   // registry, display, audio, power, firewall, env, apps, scheduler
  ...VISION_DEFINITIONS,             // image/screen → pixels or text for the LLM
  ...DESKTOP_AUTOMATION_DEFINITIONS, // screen capture, window mgmt, UI elements, mouse/keyboard
  ...DESKTOP_NETWORK_DEFINITIONS,    // ping, wifi, adapters, hosts
  ...DESKTOP_SECURITY_DEFINITIONS,   // local users & groups
  ...DESKTOP_SYSTEM_UI_DEFINITIONS,  // clipboard, notifications, dialog
  ...SKILL_DEFINITIONS,              // local STUDIO skill file reads
]);

// ---------------------------------------------------------------------------
// Dispatch — maps tool name → handler function
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export const HANDLERS: Record<string, ToolHandler> = {
  // ── monitoring (13) ─────────────────────────────────────────────────────────
  get_system_stats:          getSystemStats,
  get_cpu_details:           getCpuDetails,
  get_disk_io:               getDiskIo,
  get_gpu_stats:             getGpuStats,
  get_battery_info:          getBatteryInfo,
  get_memory_details:        getMemoryDetails,
  get_storage_info:          getStorageInfo,
  get_system_info:           getSystemInfo,
  get_drivers:               getDrivers,
  list_processes:            listProcesses,
  get_network_stats:         getNetworkStats,
  get_network_bandwidth:     getNetworkBandwidth,
  read_event_log:            readEventLog,
  // ── control (9) ──────────────────────────────────────────────────────────────
  start_process:             startProcess,
  get_process_details:       getProcessDetails,
  set_process_affinity:      setProcessAffinity,
  kill_process:              killProcess,
  set_process_priority:      setProcessPriority,
  suspend_process:           suspendProcess,
  manage_service:            manageService,
  set_service_startup:       setServiceStartup,
  run_elevated:              runElevated,
  // ── settings (34) ────────────────────────────────────────────────────────────
  get_registry_value:        getRegistryValue,
  set_registry_value:        setRegistryValue,
  list_registry_keys:        listRegistryKeys,
  delete_registry_value:     deleteRegistryValue,
  delete_registry_key:       deleteRegistryKey,
  list_displays:             listDisplays,
  get_display_settings:      getDisplaySettings,
  set_display_resolution:    setDisplayResolution,
  set_display_scaling:       setDisplayScaling,
  set_display_orientation:   setDisplayOrientation,
  list_audio_devices:        listAudioDevices,
  get_volume:                getVolume,
  set_volume:                setVolume,
  toggle_mute:               toggleMute,
  set_default_audio_device:  setDefaultAudioDevice,
  set_app_volume:            setAppVolume,
  list_power_plans:          listPowerPlans,
  set_power_plan:            setPowerPlan,
  system_power_action:       systemPowerAction,
  get_firewall_status:       getFirewallStatus,
  list_firewall_rules:       listFirewallRules,
  add_firewall_rule:         addFirewallRule,
  remove_firewall_rule:      removeFirewallRule,
  list_env_vars:             listEnvVars,
  set_env_var:               setEnvVar,
  remove_env_var:            removeEnvVar,
  list_installed_apps:       listInstalledApps,
  list_startup_apps:         listStartupApps,
  get_file_association:      getFileAssociation,
  set_file_association:      setFileAssociation,
  manage_startup_app:        manageStartupApp,
  list_scheduled_tasks:      listScheduledTasks,
  manage_scheduled_task:     manageScheduledTask,
  create_scheduled_task:     createScheduledTask,
  // ── vision intelligence (4) — return pixels/text to the LLM ──────────────────
  screenshot_and_analyze:    screenshotAndAnalyze,
  analyze_image:             analyzeImage,
  ocr_file:                  ocrFile,
  ocr_url:                   ocrUrl,
  // ── automation (28) — screen capture, windows, UI, mouse/keyboard ────────────
  capture_screenshot:        captureScreenshot,
  capture_window_screenshot: captureWindowScreenshot,
  screenshot_region:         screenshotRegion,
  annotated_snapshot:        annotatedSnapshot,
  ocr_screen:                ocrScreen,
  list_windows:              listWindows,
  get_active_window:         getActiveWindow,
  get_window_info:           getWindowInfo,
  focus_window:              focusWindow,
  close_window:              closeWindow,
  show_window:               showWindow,
  move_resize_window:        moveResizeWindow,
  wait_for_window:           waitForWindow,
  launch_app:                launchApp,
  get_ui_tree:               getUiTree,
  click_ui_element:          clickUiElement,
  get_ui_element_value:      getUiElementValue,
  set_ui_element_value:      setUiElementValue,
  move_mouse:                moveMouse,
  click_at:                  clickAt,
  mouse_down:                mouseDown,
  mouse_up:                  mouseUp,
  double_click_at:           doubleClickAt,
  scroll_at:                 scrollAt,
  drag_and_drop:             dragAndDrop,
  type_text:                 typeText,
  press_hotkey:              pressHotkey,
  key_down:                  keyDown,
  key_up:                    keyUp,
  get_mouse_position:        getMousePosition,
  // ── network (14) ─────────────────────────────────────────────────────────────
  ping_host:                 pingHost,
  check_port:                checkPort,
  dns_lookup:                dnsLookup,
  traceroute:                traceroute,
  list_wifi_networks:        listWifiNetworks,
  get_wifi_status:           getWifiStatus,
  connect_wifi:              connectWifi,
  disconnect_wifi:           disconnectWifi,
  list_adapters:             listAdapters,
  enable_adapter:            enableAdapter,
  disable_adapter:           disableAdapter,
  set_static_ip:             setStaticIp,
  set_dhcp:                  setDhcp,
  manage_hosts_file:         manageHostsFile,
  // ── security (8) ─────────────────────────────────────────────────────────────
  list_users:                listUsers,
  create_user:               createUser,
  delete_user:               deleteUser,
  set_user_password:         setUserPassword,
  manage_user_account:       manageUserAccount,
  list_groups:               listGroups,
  get_group_members:         getGroupMembers,
  manage_group_member:       manageGroupMember,
  // ── system-ui (4) ────────────────────────────────────────────────────────────
  get_clipboard:             getClipboard,
  set_clipboard:             setClipboard,
  send_notification:         sendNotification,
  show_dialog:               showDialog,
  skill_read_local:          readLocalSkill,
};

for (const definition of TOOL_DEFINITIONS) {
  if (!HANDLERS[definition.name]) throw new Error(`Tool definition has no handler: ${definition.name}`);
}
for (const name of Object.keys(HANDLERS)) {
  if (!TOOL_DEFINITIONS.some(definition => definition.name === name)) throw new Error(`Tool handler has no definition: ${name}`);
}

export async function dispatch(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const handler = HANDLERS[name];
  if (!handler) return { error: `Unknown tool: ${name}` };
  return handler(args);
}
