export const DESKTOP_WORKFLOW = `# Desktop Workflow

Load this skill before any task involving desktop automation, system monitoring, settings configuration, or UI interaction on a Windows machine.

---

## Capability Domains at a Glance

| # | Domain | Tools | What you can do |
|---|---|---|---|
| 1 | **Monitoring** | 13 | Read-only: CPU, RAM, GPU, disk I/O, battery, processes, event log |
| 2 | **Process & Service Control** | 9 | Launch, kill, suspend, prioritize, pin-to-cores, manage services |
| 3 | **Settings** | 34 | Registry, display, audio, power, firewall, env vars, apps, scheduler |
| 4 | **Vision** | 10 | See the screen, analyze images, fetch image URLs, OCR files and URLs |
| 5 | **Window Automation** | 13 | Find, focus, resize, close windows; read/click/write UI elements |
| 6 | **Input** | 10 | Mouse, keyboard, hotkeys, drag and drop, key hold/release |
| 7 | **Network** | 14 | Ping, port check, DNS, Wi-Fi, adapters, hosts file |
| 8 | **Security** | 8 | Local users and groups |
| + | **System UI** | 4 | Clipboard, toast notifications, dialogs |

---

## Domain 1 — Monitoring (read-only, always safe)

| Tool | What it returns |
|---|---|
| \`get_system_stats\` | CPU %, RAM %, disk GB free/used, GPU names — the quick overview |
| \`get_cpu_details\` | Per-core load %, current GHz, temperature C, process + thread count |
| \`get_disk_io\` | Live read/write KB/s per physical disk (1-second sample) |
| \`get_gpu_stats\` | Load %, VRAM used/total, temp, power draw (nvidia-smi then WMI fallback) |
| \`get_battery_info\` | Level %, status, health %, estimated minutes remaining |
| \`get_memory_details\` | Total/free/used RAM, page file, pool sizes, cache, page faults/s |
| \`get_storage_info\` | Volumes (health, %) + physical disks (type, bus, size) |
| \`get_system_info\` | Manufacturer, model, CPU, BIOS, serial number, domain |
| \`get_drivers\` | Driver inventory; filter: signed/unsigned; name_filter for search |
| \`list_processes\` | All running processes with PID, CPU %, RAM MB, path |
| \`get_network_stats\` | Per-interface bytes sent/received, packets, errors |
| \`get_network_bandwidth\` | Live bandwidth sample across all active interfaces |
| \`read_event_log\` | Windows Event Log — Application, System, or Security |

**Pattern: "What is the machine doing right now?"**
\`\`\`
get_system_stats()          -- quick health check (CPU, RAM, disk)
get_cpu_details()           -- per-core breakdown if CPU is high
list_processes()            -- who is using the resources
get_disk_io()               -- if disk reads/writes are high
read_event_log(log: "System", level: "Error", count: 20)  -- recent errors
\`\`\`

---

## Domain 2 — Process & Service Control

| Tool | Key parameters | Notes |
|---|---|---|
| \`start_process\` | executable, args, cwd, window_style, capture_output | Set capture_output: true to get stdout/stderr back |
| \`get_process_details\` | name or pid | Returns command line, parent, modules, priority, responding state |
| \`kill_process\` | name or pid | Kills all instances matching name |
| \`set_process_priority\` | name/pid, priority | realtime/high/above_normal/normal/below_normal/idle |
| \`set_process_affinity\` | name/pid, cores: [0,1,2] | Pin process to specific logical cores |
| \`suspend_process\` | name/pid, action: suspend or resume | Uses NtSuspendProcess. Works on most processes, not protected ones. |
| \`manage_service\` | name, action: start/stop/restart/status | Standard Windows service management |
| \`set_service_startup\` | name, startup_type | auto/manual/disabled/delayed-auto |
| \`run_elevated\` | command | Runs via UAC elevation; may show UAC prompt |

**Pattern: "Launch a program and capture its output"**
\`\`\`
start_process({ executable: "python", args: "script.py", capture_output: true })
\`\`\`

**Pattern: "Fix a runaway process"**
\`\`\`
list_processes()                                            -- find which process is high-CPU
get_process_details({ name: "X" })                         -- confirm it is the right one
set_process_priority({ name: "X", priority: "below_normal" })   -- throttle it
kill_process({ name: "X" })                                -- or terminate it
\`\`\`

---

## Domain 3 — Settings (34 tools)

### Registry
| Tool | Use for |
|---|---|
| \`get_registry_value\` | Read any HKLM/HKCU/HKCR value |
| \`set_registry_value\` | Write string/dword/qword/binary/multi-string |
| \`list_registry_keys\` | Enumerate subkeys under a path |
| \`delete_registry_value\` | Remove a single value |
| \`delete_registry_key\` | Remove a key; set recursive: true for subtrees |

### Display
| Tool | Notes |
|---|---|
| \`list_displays\` | Returns all monitors with device name, bounds, bpp |
| \`get_display_settings\` | Current resolution, refresh rate, DPI scaling % |
| \`set_display_resolution\` | width, height, optional refresh_hz. Immediate effect. |
| \`set_display_scaling\` | 100/125/150/175/200/250/300. Takes effect on next sign-in. |
| \`set_display_orientation\` | landscape/portrait/landscape_flipped/portrait_flipped. Immediate. |

### Audio
| Tool | Notes |
|---|---|
| \`list_audio_devices\` | Returns device list + default render/capture device IDs + master volume |
| \`get_volume\` | Fast: just current % and mute state |
| \`set_volume\` | 0-100, immediate |
| \`toggle_mute\` | No args = toggle; pass mute: true/false to force state |
| \`set_default_audio_device\` | Pass device_id from list_audio_devices; role: render/capture/all |
| \`set_app_volume\` | process_name + level 0-100; only works if app has an active audio session |

**Pattern: "Switch audio output to headphones"**
\`\`\`
list_audio_devices()                         -- get headphone device_id
set_default_audio_device({ device_id: "..." })
\`\`\`

### Power
| Tool | Notes |
|---|---|
| \`list_power_plans\` | Returns available plans with GUID and active flag |
| \`set_power_plan\` | Pass plan_guid (preferred) or name |
| \`system_power_action\` | action: shutdown/restart/sleep/hibernate/lock |

### Firewall
| Tool | Notes |
|---|---|
| \`get_firewall_status\` | State per profile (Domain, Private, Public) |
| \`list_firewall_rules\` | filter by name, direction, protocol, enabled state |
| \`add_firewall_rule\` | name, direction (in/out), protocol, local_port or remote_port |
| \`remove_firewall_rule\` | name |

### Environment Variables
| Tool | Notes |
|---|---|
| \`list_env_vars\` | scope: user/system/process |
| \`set_env_var\` | name, value, scope: user/system. Persists via registry. |
| \`remove_env_var\` | name, scope: user/system |

IMPORTANT: set_env_var changes the registry but does NOT update the current process env. Open a new terminal to see changes.

### Apps and Startup
| Tool | Notes |
|---|---|
| \`list_installed_apps\` | Scans all 3 uninstall registry paths; supports filter + limit |
| \`list_startup_apps\` | Run keys + Task Scheduler startup entries |
| \`get_file_association\` | extension (e.g. ".pdf") -> prog_id + open command |
| \`set_file_association\` | Sets user-level (HKCU) association; no elevation needed |
| \`manage_startup_app\` | action: enable/disable/remove; name = registry value name |

### Scheduled Tasks
| Tool | Notes |
|---|---|
| \`list_scheduled_tasks\` | filter by folder; returns status, next run, last run result |
| \`manage_scheduled_task\` | action: run/enable/disable/delete |
| \`create_scheduled_task\` | name, command, schedule (daily/weekly/onlogon/once), time |

---

## Domain 4 — Vision (See the screen)

**Primary tools — return actual image pixels so you can see what is on screen:**

| Tool | Best for |
|---|---|
| \`screenshot_and_analyze\` | **Primary.** Capture + see in one call. Window title, region, or full screen. Returns image pixels directly — use this whenever you need to see what is on screen. |
| \`analyze_image\` | Load any image file from disk and see its pixels — use after another tool saves a file. |
| \`fetch_image_url\` | Fetch an image from any http/https URL and see its pixels. |

**OCR tools — extract text without vision:**

| Tool | Best for |
|---|---|
| \`ocr_screen\` | Extract visible text from screen. Optional x/y/width/height region. Optional language tag. |
| \`ocr_file\` | OCR any local image file — useful when you have a saved screenshot path. |
| \`ocr_url\` | Fetch image from URL and OCR it. |

**Legacy path-only tools (do not use for visual understanding):**

| Tool | Notes |
|---|---|
| \`capture_screenshot\` | Returns a file path only — you cannot see the image. Use \`screenshot_and_analyze\` instead. |
| \`capture_window_screenshot\` | Returns a file path only. Use \`screenshot_and_analyze\` with window_title instead. |
| \`screenshot_region\` | Returns a file path only. Use \`screenshot_and_analyze\` with x/y/width/height instead. |
| \`annotated_snapshot\` | Returns a file path with numbered UI element overlays — use for automation targeting (coordinates), not for visual understanding. |

**Pattern: "What does the screen look like right now?"**
\`\`\`
screenshot_and_analyze()                         -- see the full screen immediately
\`\`\`

**Pattern: "Look at a specific window"**
\`\`\`
screenshot_and_analyze({ window_title: "Notepad" })   -- see just that window
\`\`\`

**Pattern: "Read text from a dialog box"**
\`\`\`
get_active_window()                                    -- get position + size
screenshot_and_analyze({ x, y, width, height })        -- see the region
-- or if you only need the text:
ocr_screen({ x, y, width, height })                    -- extract text directly
\`\`\`

**Pattern: "Find what is clickable before automating"**
\`\`\`
annotated_snapshot()    -- numbered overlay shows every UI element with center coordinates
-- Use those coordinates to click_at() precisely
\`\`\`

OCR requires a Windows language pack to be installed. It fails gracefully with a clear error if none is available.

---

## Domain 5 — Window Automation

### Finding windows
| Tool | Notes |
|---|---|
| \`list_windows\` | All visible windows; filter by title substring |
| \`get_active_window\` | Currently focused window: title, pid, size, position |
| \`get_window_info\` | Detail on a specific window by title or handle |
| \`wait_for_window\` | Poll until a window title appears (timeout_sec, interval_ms) |

### Window control
| Tool | Notes |
|---|---|
| \`focus_window\` | Bring to foreground (restore if minimized first) |
| \`close_window\` | Sends WM_CLOSE — graceful close, app can reject |
| \`show_window\` | action: minimize/maximize/restore |
| \`move_resize_window\` | x, y (omit to keep position), width, height (omit to keep size) |
| \`launch_app\` | Pass file path, executable, or URL |

### UI Element interaction (UIAutomation)
| Tool | Notes |
|---|---|
| \`get_ui_tree\` | window_title, depth (1-5). Reveals element names, types, automation IDs |
| \`click_ui_element\` | window_title + element_name or automation_id. Tries InvokePattern first, falls back to mouse click. |
| \`get_ui_element_value\` | Read text box value, checkbox state, etc. |
| \`set_ui_element_value\` | Type into a text field by setting ValuePattern |

**Pattern: "Interact with an app UI reliably"**
\`\`\`
-- Step 1: discover structure
get_ui_tree({ title: "Settings", depth: 3 })
-- find the element_name or automation_id you need

-- Step 2: click or type
click_ui_element({ window_title: "Settings", element_name: "Bluetooth" })
set_ui_element_value({ window_title: "Notepad", element_name: "Text Editor", value: "Hello" })
\`\`\`

Prefer UIAutomation over coordinates — element names survive window moves and resizes. Use coordinates only when no automation_id or name is available.

---

## Domain 6 — Input (Mouse and Keyboard)

| Tool | Notes |
|---|---|
| \`move_mouse\` | Move cursor without clicking |
| \`click_at\` | button: left/right/middle (default: left) |
| \`double_click_at\` | Two left-clicks 50ms apart |
| \`scroll_at\` | delta: positive = scroll up, negative = down. Each unit = 120 Windows wheel delta. |
| \`drag_and_drop\` | from_x/y to to_x/y with interpolated movement (steps: 20 default) |
| \`type_text\` | SendKeys with auto-escaping of special chars. Pass delay_ms for slow typing. |
| \`press_hotkey\` | SendKeys notation: ^c (Ctrl+C), %{F4} (Alt+F4), ^+s (Ctrl+Shift+S), {ENTER} |
| \`key_down\` / \`key_up\` | Hold modifier keys for multi-step combos. key: SHIFT/CTRL/ALT/WIN/F1-F12 |
| \`get_mouse_position\` | Current cursor x,y |

SendKeys cheat sheet:
- ^ = Ctrl   % = Alt   + = Shift
- Special keys in braces: {ENTER}, {TAB}, {ESC}, {F5}, {UP}, {DEL}, {HOME}, {END}
- Repeat notation: {RIGHT 5} = press Right arrow 5 times

**Pattern: "Fill a form in any application"**
\`\`\`
focus_window({ title: "SomeApp" })
click_at({ x: 400, y: 300 })           -- click the first field
type_text({ text: "John Doe" })
press_hotkey({ keys: "{TAB}" })        -- next field
type_text({ text: "john@example.com" })
press_hotkey({ keys: "{ENTER}" })      -- submit
\`\`\`

**Pattern: "Hold Shift while pressing Down arrow 3 times"**
\`\`\`
key_down({ key: "SHIFT" })
press_hotkey({ keys: "{DOWN 3}" })
key_up({ key: "SHIFT" })
\`\`\`

---

## Domain 7 — Network

### Diagnostics
| Tool | Notes |
|---|---|
| \`ping_host\` | host, count (default 4). Returns min/avg/max RTT, loss %. |
| \`check_port\` | host, port, timeout_ms (default 3000). Returns open: true/false. |
| \`dns_lookup\` | host, type: A/AAAA/MX/CNAME/TXT/SRV. Returns all records. |
| \`traceroute\` | host, max_hops (default 30). Uses Test-NetConnection; falls back to tracert. |

### Wi-Fi
| Tool | Notes |
|---|---|
| \`list_wifi_networks\` | Nearby SSIDs with signal %, auth, encryption, connected flag |
| \`get_wifi_status\` | Current state, SSID, BSSID, signal, channel, speed |
| \`connect_wifi\` | ssid, password (optional). Creates WPA2 profile if needed. |
| \`disconnect_wifi\` | Disconnects all wireless adapters. |

### Adapters and IP
| Tool | Notes |
|---|---|
| \`list_adapters\` | All NICs with status, IP addresses, routes, DNS servers |
| \`enable_adapter\` / \`disable_adapter\` | name = adapter name from list_adapters |
| \`set_static_ip\` | name, ip, prefix_length, gateway, dns (array) |
| \`set_dhcp\` | Switch adapter back to DHCP (removes static config) |
| \`manage_hosts_file\` | action: read/add/remove; ip + hostname for add/remove |

Adapter enable/disable and IP configuration require elevation. Use run_elevated if needed.

---

## Domain 8 — Security (Local Users and Groups)

| Tool | Notes |
|---|---|
| \`list_users\` | All local accounts: enabled status, last logon, SID |
| \`create_user\` | username, password (or no_password: true), full_name, description |
| \`delete_user\` | username — cannot delete currently logged-in user |
| \`set_user_password\` | username, password |
| \`manage_user_account\` | username, action: enable/disable |
| \`list_groups\` | All security groups; include_members: true for member lists |
| \`get_group_members\` | group name returns member list with object type |
| \`manage_group_member\` | action: add/remove; group, username |

All user/group operations require admin privileges.

---

## System UI — Clipboard, Notifications, Dialogs

| Tool | Notes |
|---|---|
| \`get_clipboard\` | Returns clipboard text (null if not text or empty) |
| \`set_clipboard\` | Sets clipboard to text string |
| \`send_notification\` | title, message, optional app_id. Shows Windows toast. |
| \`show_dialog\` | message, title, type: ok/yesno/input, buttons: ok/yesno/okcancel. Returns user selection. |

---

## Decision Tree

\`\`\`
Desktop task arrived
|
+-- "What is happening on the machine?"
|   -> get_system_stats()         quick overview
|   -> list_processes()           who uses resources
|   -> read_event_log()           recent errors
|
+-- "Control an application"
|   +-- Know the app UI structure?
|   |   YES -> get_ui_tree(title)            find element names/IDs
|   |          click_ui_element / set_ui_element_value
|   |   NO  -> screenshot_and_analyze()      see the current state first
|   |          annotated_snapshot()          numbered overlay for coordinates
|   |          click_at(cx, cy)              coordinate click
|   |
|   +-- App not open yet?
|       launch_app(target)
|       wait_for_window(title)
|       then interact
|
+-- "Read text from the screen"
|   -> ocr_screen()               full screen text
|   -> ocr_screen(x, y, w, h)     specific region only
|
+-- "Change a system setting"
|   +-- Display?   -> list_displays -> set_display_resolution / set_display_orientation
|   +-- Audio?     -> list_audio_devices -> set_volume / set_default_audio_device
|   +-- Power?     -> list_power_plans -> set_power_plan
|   +-- Registry?  -> get_registry_value -> set_registry_value
|   +-- Startup?   -> list_startup_apps -> manage_startup_app
|   +-- Firewall?  -> get_firewall_status -> add_firewall_rule
|
+-- "Network issue?"
|   -> ping_host(host)            reachable?
|   -> check_port(host, port)     service running?
|   -> traceroute(host)           where does it fail?
|   -> dns_lookup(host, type)     DNS resolution?
|   -> list_adapters()            IP config correct?
|
+-- "Security / user management?"
    -> list_users()               who exists
    -> list_groups()              group memberships
    -> manage_group_member()      access control
\`\`\`

---

## Tool Cooperation Patterns

Vision -> Automation:
\`\`\`
screenshot_and_analyze()   -- see the current state before acting
annotated_snapshot()       -- numbered overlay shows all clickable elements with coordinates
ocr_screen()               -- read dialog text without needing automation IDs
screenshot_and_analyze()   -- verify the result after acting (call again to confirm)
\`\`\`

Monitor -> Control:
\`\`\`
get_system_stats()                                     -- notice high CPU
list_processes()                                       -- identify the process
get_process_details(name)                              -- confirm it is the right one
set_process_priority(name, "below_normal")             -- throttle
\`\`\`

Settings -> Verify:
\`\`\`
get_display_settings()    -- check current state before changing
set_display_resolution()  -- make the change
get_display_settings()    -- verify it took effect
\`\`\`

---

## Known Limitations

| Tool | Limitation |
|---|---|
| \`set_display_scaling\` | Requires sign-out. No live apply on Win10/11 without explorer injection. |
| \`ocr_screen\` | Requires a Windows language pack. Fails with clear error if absent. |
| \`suspend_process\` | Uses undocumented NtSuspendProcess. Cannot suspend protected processes. |
| \`set_default_audio_device\` | Uses undocumented IPolicyConfig COM. Works Win10/11, not officially supported. |
| \`set_app_volume\` | Only works if the process has an active audio session (currently producing sound). |
| \`set_file_association\` | User-level only. System-wide requires elevation and a different code path. |
| \`set_env_var\` | Updates registry only. New terminals pick up the change; current process does not. |
| \`close_window\` | WM_CLOSE — app may show Save dialog or reject. Use kill_process for force-close. |
| \`run_elevated\` | Triggers the Windows UAC prompt. The user must physically click Yes. |
| \`connect_wifi\` | Creating a new network profile requires elevation. |
| \`network adapter tools\` | enable/disable/set_static_ip require admin privileges. |
| \`user and group tools\` | All require admin privileges. |

---

## Anti-Patterns

| Do not | Do instead |
|---|---|
| Click by coordinates without checking layout | annotated_snapshot() first — coordinates shift if window moves |
| Try UIAutomation on UAC prompts | UAC runs protected — use key_down + press_hotkey to interact |
| kill_process to close a normal app | close_window() first — gives the app a chance to save |
| set_registry_value blindly | get_registry_value first to check existing value |
| type_text in the wrong window | focus_window() then get_active_window() to confirm focus |
| Loop screenshots rapidly | Use wait_for_window or sleep between polls |
`;
