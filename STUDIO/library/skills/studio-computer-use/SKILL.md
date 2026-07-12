---
name: studio-computer-use
description: STUDIO desktop computer-use workflow for controlling Windows apps, reading screens with vision/OCR, managing windows, using mouse/keyboard, inspecting UI Automation, diagnosing system/network state, and making local OS changes through the computer-use MCP server. Use when a user asks STUDIO to operate software, click/type/navigate a GUI, inspect the visible desktop, automate native apps, troubleshoot Windows, change local settings, or coordinate desktop actions with STUDIO tools.
---

# STUDIO Computer Use

Use the `computer-use` MCP server for Windows desktop observation, GUI control, native app automation, system diagnostics, local settings, network, security, clipboard, notifications, and user dialogs. Use `studio-harness` for files, code, shell execution, git, LSP, and project work. If `mcp_computer_use__*` tools are unavailable, ask the user to start **Computer Use** from STUDIO Extensions before attempting desktop actions.

## Operating Loop

1. Establish context: identify the target app, window, user goal, and whether the action is read-only, reversible, or risky.
2. Observe before acting: use `list_windows`, `get_active_window`, or `screenshot_and_analyze`; use `ocr_screen` when text matters more than layout.
3. Prefer semantic control: use UI Automation tools before coordinate clicks when the app exposes controls.
4. Act in small steps: focus the target window, perform one logical action, then verify with a screenshot, OCR, UI tree, window info, or tool result.
5. Recover deliberately: if state differs from expectation, re-observe and choose a new path instead of repeating the same click.
6. Summarize only user-visible results, including any setting changed, file/app opened, command launched, or action that still needs user confirmation.

## Tool Routing

Use the first matching route:

| Task | Primary tools |
|---|---|
| See what is on screen | `screenshot_and_analyze`; use `capture_screenshot` only when a saved image path is needed |
| Read visible text | `ocr_screen`; use region coordinates for dense or noisy screens |
| Inspect or control a native app | `list_windows`, `focus_window`, `get_ui_tree`, `click_ui_element`, `set_ui_element_value`, `get_ui_element_value` |
| Click by position | `annotated_snapshot` then `click_at`; use raw coordinates only after observation gives reliable centers |
| Type or use shortcuts | `focus_window`, then `type_text` or `press_hotkey` |
| Launch/open apps, files, or URLs | `launch_app`; use `wait_for_window` after launching GUI apps |
| Move, resize, minimize, restore, or close windows | `list_windows`, `focus_window`, `show_window`, `move_resize_window`, `close_window` |
| Diagnose performance or crashes | `get_system_stats`, then targeted CPU/GPU/memory/storage/network/process/event-log tools |
| Manage processes/services | `list_processes` or `get_process_details`, then `kill_process`, `suspend_process`, `set_process_priority`, `manage_service` |
| Change Windows settings | Use specific settings tools for registry, display, audio, power, firewall, env vars, apps, startup, scheduled tasks |
| Diagnose connectivity | `ping_host`, `check_port`, `dns_lookup`, `traceroute`, adapter/Wi-Fi tools |
| Work with local users/groups | `list_users`, `list_groups`, then user/group mutation tools |
| Exchange text with the desktop | `get_clipboard`, `set_clipboard`, `show_dialog`, `send_notification` |
| Work with local files/code/shell/git | Use `studio-harness`, not `computer-use` |

## Visual Strategy

- Use `screenshot_and_analyze` for direct visual understanding because it returns image content to the model.
- Use `annotated_snapshot` when deciding where to click; click the returned element center rather than estimating.
- Use `capture_window_screenshot` or `screenshot_region` when the next step needs a file path for `analyze_image` or `ocr_file`.
- Use OCR as confirmation for labels, errors, dialog text, form values, and completion states.
- On multi-monitor setups, call `list_windows` or use monitor `-1` before choosing coordinates; keep all coordinates absolute screen pixels.

## GUI Automation Policy

Prefer this order for app interaction:

1. `get_ui_tree` plus `click_ui_element` or `set_ui_element_value` when controls are exposed.
2. Keyboard shortcuts when they are standard for the focused app and easy to verify.
3. `annotated_snapshot` plus `click_at` for visual-only controls.
4. Raw `move_mouse`, drag, scroll, mouse down/up, or coordinate clicks only for canvases, custom controls, games, sliders, or apps without accessible UI.

Always focus the intended window before typing or sending hotkeys. After `key_down` or `mouse_down`, always call the matching `key_up` or `mouse_up`, even if the task fails.

## Safety Gates

Ask for explicit user confirmation before:

- shutdown, restart, logoff, hibernate, sleep, or destructive power actions;
- deleting registry keys/values, changing HKLM, firewall rules, hosts file, services, startup entries, scheduled tasks, users, groups, passwords, network adapters, static IP/DHCP, or display resolution/orientation;
- killing, suspending, or reprioritizing system-critical processes or unknown high-impact processes;
- entering credentials, secrets, payment data, or sending messages/emails/forms on the user's behalf;
- closing unsaved work or dismissing dialogs that may discard data.

For risky changes, first read the current state and report the exact planned change. Prefer reversible user-scope changes over machine-wide changes. If an elevated action is required, explain that `run_elevated` may show UAC and cannot capture output unless redirected.

## Reliability Patterns

- For flaky UI: wait for the expected window or text, then retry once after re-observation.
- For hidden/minimized apps: `list_windows`, `focus_window`, and `show_window` with `restore`.
- For slow operations: poll with `wait_for_window`, screenshots, OCR, process status, or event logs; avoid blind fixed sleeps except for short UI settling.
- For long tasks: use `send_notification` when finished if the user is likely away.
- For ambiguous windows with the same title: use handles from `list_windows`.
- For text entry into fragile fields: use `set_clipboard` plus paste hotkey when typing is unreliable, then verify the field value.
- For web pages inside a browser without browser-specific tools: use screen vision/OCR and standard keyboard shortcuts; do not assume DOM access.

## Completion Standard

Do not claim success from a click alone. Verify final state with the most direct signal available: tool output, visible UI, OCR text, window state, process status, setting read-back, or network result. If verification is impossible, say what was attempted and what evidence is missing.
