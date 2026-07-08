/** Tool schema definitions for desktop settings tools (registry, display, audio, power, firewall, env-vars, apps, scheduler). */
export const DESKTOP_SETTINGS_DEFINITIONS = [
  // ── Registry ────────────────────────────────────────────────────────────────
  {
    name: "get_registry_value",
    description:
      "Read a Windows registry key. key_path uses PowerShell PSDrive notation: HKCU:\\, HKLM:\\, HKCR:\\. " +
      "Omit name to read all values. Returns value names, types, and data.",
    inputSchema: {
      type: "object",
      properties: {
        key_path: { type: "string", description: "Registry key path (e.g. HKCU:\\Software\\MyApp)" },
        name:     { type: "string", description: "Value name to read (optional — omit for all values)" },
      },
      required: ["key_path"],
    },
  },
  {
    name: "set_registry_value",
    description:
      "Write a value to a Windows registry key. Creates the key if missing. " +
      "ALWAYS confirm with the user before writing to HKLM (system-wide). " +
      "Supports String, DWord, QWord, Binary, MultiString, ExpandString types.",
    inputSchema: {
      type: "object",
      properties: {
        key_path: { type: "string", description: "Registry key path" },
        name:     { type: "string", description: "Value name to write" },
        value:    { type: "string", description: "Value data" },
        type:     { type: "string", enum: ["String","DWord","QWord","Binary","MultiString","ExpandString"], description: "Registry value type (default: String)" },
      },
      required: ["key_path", "name", "value"],
    },
  },
  {
    name: "list_registry_keys",
    description: "List all sub-keys and values (with types and data) under a registry key path.",
    inputSchema: {
      type: "object",
      properties: { key_path: { type: "string", description: "Registry key path to inspect" } },
      required: ["key_path"],
    },
  },
  {
    name: "delete_registry_value",
    description: "Delete a specific value from a registry key. Does NOT delete the key itself.",
    inputSchema: {
      type: "object",
      properties: {
        key_path: { type: "string", description: "Registry key path" },
        name:     { type: "string", description: "Value name to delete" },
      },
      required: ["key_path", "name"],
    },
  },
  {
    name: "delete_registry_key",
    description: "Delete an entire Windows registry key and optionally all its sub-keys (recursive). Unlike delete_registry_value which removes a single value, this removes the whole key.",
    inputSchema: {
      type: "object",
      properties: {
        key_path:  { type: "string",  description: "Registry key path to delete (e.g. HKCU:\\Software\\OldApp)" },
        recursive: { type: "boolean", description: "Delete all sub-keys recursively (default: true)" },
      },
      required: ["key_path"],
    },
  },

  // ── Display ────────────────────────────────────────────────────────────────
  {
    name: "list_displays",
    description:
      "List all connected monitors: device name, primary flag, resolution, position (x/y), bits-per-pixel, working area. " +
      "Use before set_display_resolution to identify the target device name.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_display_settings",
    description: "Get current display settings from WMI: adapter name, resolution, refresh rate, bits per pixel, DPI scaling %.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "set_display_resolution",
    description:
      "Change display resolution (and optionally refresh rate) via ChangeDisplaySettingsEx Win32 API. " +
      "A restart may be required for some configurations. Provide device from list_displays for multi-monitor setups.",
    inputSchema: {
      type: "object",
      properties: {
        width:      { type: "number", description: "Horizontal resolution in pixels" },
        height:     { type: "number", description: "Vertical resolution in pixels" },
        refresh_hz: { type: "number", description: "Refresh rate in Hz (optional)" },
        device:     { type: "string", description: "Device name from list_displays (optional, default: primary)" },
      },
      required: ["width", "height"],
    },
  },
  {
    name: "set_display_scaling",
    description: "Set Windows display DPI scaling percentage (100%, 125%, 150%, 175%, 200%, etc.). Takes effect after sign-out and sign-in.",
    inputSchema: {
      type: "object",
      properties: {
        percent: { type: "number", description: "Scaling percentage: 100, 125, 150, 175, 200, 225, 250, or 300" },
      },
      required: ["percent"],
    },
  },
  {
    name: "set_display_orientation",
    description: "Rotate a display: landscape (normal), portrait (90°), landscape_flipped (180°), portrait_flipped (270°).",
    inputSchema: {
      type: "object",
      properties: {
        orientation: { type: "string", enum: ["landscape","portrait","landscape_flipped","portrait_flipped"], description: "Target orientation" },
        device:      { type: "string", description: "Display device name from list_displays (omit for primary)" },
      },
      required: ["orientation"],
    },
  },

  // ── Audio ──────────────────────────────────────────────────────────────────
  {
    name: "list_audio_devices",
    description:
      "List audio devices via WMI (Win32_SoundDevice), plus current master volume %, mute state, and default render/capture device IDs.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_volume",
    description: "Get current master volume level (0–100) and mute state via Core Audio API.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "set_volume",
    description: "Set master volume level (0–100) via Core Audio API. Does not affect per-app volumes.",
    inputSchema: {
      type: "object",
      properties: { level: { type: "number", description: "Volume level 0–100" } },
      required: ["level"],
    },
  },
  {
    name: "toggle_mute",
    description: "Toggle mute on/off, or force a specific state via Core Audio API.",
    inputSchema: {
      type: "object",
      properties: { mute: { type: "boolean", description: "Force mute on (true) or off (false). Omit to toggle." } },
      required: [],
    },
  },
  {
    name: "set_default_audio_device",
    description: "Switch the default audio output (render) or input (capture) device. Get device_id from list_audio_devices. Uses Windows PolicyConfig COM API.",
    inputSchema: {
      type: "object",
      properties: {
        device_id: { type: "string", description: "Device ID from list_audio_devices default_render_id / default_capture_id" },
        role:      { type: "string", enum: ["all","render","capture"], description: "Which role to apply (default: all)" },
      },
      required: ["device_id"],
    },
  },
  {
    name: "set_app_volume",
    description: "Set per-application volume level for a running process using Windows Audio Session API (WASAPI). The process must have an active audio session.",
    inputSchema: {
      type: "object",
      properties: {
        process_name: { type: "string", description: "Process name (e.g. 'chrome', 'spotify')" },
        level:        { type: "number", description: "Volume level 0–100" },
      },
      required: ["process_name","level"],
    },
  },

  // ── Power ──────────────────────────────────────────────────────────────────
  {
    name: "list_power_plans",
    description: "List all Windows power plans with GUID, name, and which is currently active.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "set_power_plan",
    description: "Activate a Windows power plan by GUID or name (e.g. 'Balanced', 'High performance', 'Power saver').",
    inputSchema: {
      type: "object",
      properties: {
        guid: { type: "string", description: "Power plan GUID from list_power_plans" },
        name: { type: "string", description: "Power plan name substring (alternative to guid)" },
      },
      required: [],
      anyOf: [{ required: ["guid"] }, { required: ["name"] }],
    },
  },
  {
    name: "system_power_action",
    description:
      "Trigger a system power action: shutdown, restart, sleep, hibernate, lock screen, or logoff. " +
      "Supports optional delay in seconds. CONFIRM with the user before shutdown or restart.",
    inputSchema: {
      type: "object",
      properties: {
        action:        { type: "string", enum: ["shutdown","restart","sleep","hibernate","lock","logoff"], description: "Action to perform" },
        delay_seconds: { type: "number", description: "Seconds to wait before executing (default 0)" },
      },
      required: ["action"],
    },
  },

  // ── Firewall ───────────────────────────────────────────────────────────────
  {
    name: "get_firewall_status",
    description: "Get Windows Firewall state for each profile (Domain, Private, Public): enabled, default inbound/outbound actions.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_firewall_rules",
    description: "List Windows Firewall rules. Filter by direction (Inbound/Outbound), enabled state, or name substring. Returns up to limit rules.",
    inputSchema: {
      type: "object",
      properties: {
        direction:   { type: "string", enum: ["Inbound","Outbound"], description: "Filter by traffic direction (optional)" },
        enabled:     { type: "boolean", description: "Filter to enabled or disabled rules only (optional)" },
        name_filter: { type: "string", description: "DisplayName substring filter (optional)" },
        limit:       { type: "number", description: "Max rules to return (default 100)" },
      },
      required: [],
    },
  },
  {
    name: "add_firewall_rule",
    description: "Add a Windows Firewall rule via New-NetFirewallRule. Specify port for port-based rules or program for app-based rules.",
    inputSchema: {
      type: "object",
      properties: {
        name:      { type: "string", description: "Unique display name for the rule" },
        direction: { type: "string", enum: ["Inbound","Outbound"], description: "Traffic direction (default: Inbound)" },
        action:    { type: "string", enum: ["Allow","Block"], description: "Allow or Block (default: Allow)" },
        protocol:  { type: "string", enum: ["TCP","UDP","Any"], description: "Protocol (default: TCP)" },
        port:      { type: "number", description: "Local port number (optional)" },
        program:   { type: "string", description: "Full path to the executable (optional)" },
      },
      required: ["name"],
    },
  },
  {
    name: "remove_firewall_rule",
    description: "Remove a Windows Firewall rule by display name. Exact name required.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Rule DisplayName to remove" } },
      required: ["name"],
    },
  },

  // ── Environment variables ──────────────────────────────────────────────────
  {
    name: "list_env_vars",
    description:
      "List Windows environment variables from Machine, User, and/or Process scope. " +
      "Returns {scope, name, value} rows. Use filter to search by name or value substring.",
    inputSchema: {
      type: "object",
      properties: {
        scope:  { type: "string", enum: ["User","Machine","Process","all"], description: "Scope(s) to read (default: all)" },
        filter: { type: "string", description: "Substring filter applied to name and value (optional)" },
      },
      required: [],
    },
  },
  {
    name: "set_env_var",
    description:
      "Set a persistent environment variable at User or Machine scope via SetEnvironmentVariable. " +
      "Machine scope requires admin. Change takes effect in new processes (not the current session).",
    inputSchema: {
      type: "object",
      properties: {
        name:  { type: "string", description: "Variable name" },
        value: { type: "string", description: "Variable value" },
        scope: { type: "string", enum: ["User","Machine"], description: "Persistence scope (default: User)" },
      },
      required: ["name", "value"],
    },
  },
  {
    name: "remove_env_var",
    description: "Delete a persistent environment variable at User or Machine scope.",
    inputSchema: {
      type: "object",
      properties: {
        name:  { type: "string", description: "Variable name to remove" },
        scope: { type: "string", enum: ["User","Machine"], description: "Scope (default: User)" },
      },
      required: ["name"],
    },
  },

  // ── Apps & Startup ────────────────────────────────────────────────────────
  {
    name: "list_installed_apps",
    description:
      "List installed Windows applications from the registry uninstall keys (HKLM + HKCU, 32 & 64-bit). " +
      "Returns DisplayName, version, publisher, install date, size, and uninstall command. Supports name filter.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "App name substring filter (optional)" },
        limit:  { type: "number", description: "Max apps to return (default 200)" },
      },
      required: [],
    },
  },
  {
    name: "list_startup_apps",
    description:
      "List programs configured to run at Windows startup from registry Run keys (HKCU + HKLM) and Win32_StartupCommand. " +
      "Returns scope, name, and command for each entry.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "manage_startup_app",
    description: "Enable or disable a startup registry entry (the equivalent of toggling in Task Manager → Startup tab). Use list_startup_apps first to see names.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["enable","disable","remove"], description: "Action to perform" },
        name:   { type: "string", description: "Registry value name of the startup entry" },
        scope:  { type: "string", enum: ["user","system"], description: "User or system-wide startup (default: user)" },
      },
      required: ["action","name"],
    },
  },
  {
    name: "get_file_association",
    description: "Get the default program associated with a file extension (e.g. '.pdf'). Returns the ProgId and the open command.",
    inputSchema: {
      type: "object",
      properties: { extension: { type: "string", description: "File extension e.g. '.pdf' or 'pdf'" } },
      required: ["extension"],
    },
  },
  {
    name: "set_file_association",
    description: "Set the default program for a file extension at the user level (HKCU). Example: associate .log files with notepad.exe.",
    inputSchema: {
      type: "object",
      properties: {
        extension: { type: "string", description: "File extension e.g. '.log'" },
        program:   { type: "string", description: "Full path to the executable e.g. 'C:\\Windows\\notepad.exe'" },
      },
      required: ["extension","program"],
    },
  },

  // ── Scheduled tasks ───────────────────────────────────────────────────────
  {
    name: "list_scheduled_tasks",
    description:
      "List Windows Task Scheduler tasks: name, path, state, description, next run time, last run time, last result. " +
      "Filter by folder (default: root) and name substring.",
    inputSchema: {
      type: "object",
      properties: {
        folder:      { type: "string", description: "Task folder path (default: \\ for all)" },
        max_results: { type: "number", description: "Max tasks to return (default 100)" },
        filter:      { type: "string", description: "Task name substring filter (optional)" },
      },
      required: [],
    },
  },
  {
    name: "manage_scheduled_task",
    description: "Run, enable, disable, delete, or get status of a Windows scheduled task by name.",
    inputSchema: {
      type: "object",
      properties: {
        task_name: { type: "string", description: "Task name as shown in Task Scheduler" },
        action:    { type: "string", enum: ["run","enable","disable","delete","status"], description: "Action to perform" },
      },
      required: ["task_name", "action"],
    },
  },
  {
    name: "create_scheduled_task",
    description:
      "Create a new Windows scheduled task with a trigger. " +
      "Supports daily (at a time), hourly, at-startup, and at-logon triggers.",
    inputSchema: {
      type: "object",
      properties: {
        task_name: { type: "string", description: "Display name for the new task" },
        command:   { type: "string", description: "Executable or script path" },
        arguments: { type: "string", description: "Arguments to pass to the command (optional)" },
        trigger:   { type: "string", enum: ["daily","hourly","startup","logon"], description: "Trigger type (default: daily)" },
        time:      { type: "string", description: "Time for daily trigger, e.g. '08:00' (default: 08:00)" },
      },
      required: ["task_name", "command"],
    },
  },
] as const;
