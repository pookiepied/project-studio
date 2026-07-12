/** Tool schema definitions for desktop automation tools (screenshots, windows, UI elements, mouse/keyboard). */
export const DESKTOP_AUTOMATION_DEFINITIONS = [
  // ── Screenshots ────────────────────────────────────────────────────────────
  {
    name: "capture_screenshot",
    description:
      "Capture a screenshot of the desktop. monitor: 0=primary (default), N=nth screen, -1=all monitors combined. " +
      "Saves a PNG to %TEMP% (or save_path if provided) and returns the file path + dimensions.",
    inputSchema: {
      type: "object",
      properties: {
        monitor:   { type: "number", description: "Monitor index: 0=primary, -1=all combined (default: 0)" },
        save_path: { type: "string", description: "Full path to save the PNG (optional — defaults to %TEMP%)" },
      },
      required: [],
    },
  },
  {
    name: "capture_window_screenshot",
    description:
      "Capture a screenshot of a specific native window by title substring. " +
      "Focuses the window first, then captures just its bounds to a PNG. Returns path + dimensions.",
    inputSchema: {
      type: "object",
      properties: {
        title:     { type: "string", description: "Window title substring to match" },
        save_path: { type: "string", description: "Full path to save the PNG (optional)" },
      },
      required: ["title"],
    },
  },
  {
    name: "screenshot_region",
    description: "Capture a specific rectangular region of the screen. Specify x, y (top-left corner), width, height in screen pixels. Returns the path to the saved PNG.",
    inputSchema: {
      type: "object",
      properties: {
        x:         { type: "number", description: "Left edge of region" },
        y:         { type: "number", description: "Top edge of region" },
        width:     { type: "number", description: "Region width in pixels" },
        height:    { type: "number", description: "Region height in pixels" },
        save_path: { type: "string", description: "Optional file path to save PNG (defaults to %TEMP%)" },
      },
      required: ["x","y","width","height"],
    },
  },
  {
    name: "annotated_snapshot",
    description:
      "Take a full-screen screenshot and overlay numbered blue labels on every interactive UI element " +
      "(buttons, inputs, checkboxes, links, etc). Returns image path + element map with id, name, type, " +
      "and center coordinates. Use before click_at to identify element positions without guessing.",
    inputSchema: {
      type: "object",
      properties: {
        save_path: { type: "string", description: "Optional path to save annotated PNG" },
      },
      required: [],
    },
  },
  {
    name: "ocr_screen",
    description:
      "Extract all visible text from the screen (or a region) using Windows OCR (Windows.Media.Ocr). " +
      "Returns the full text as a string plus per-line breakdown. " +
      "Optionally specify a region (x,y,width,height) to OCR only part of the screen.",
    inputSchema: {
      type: "object",
      properties: {
        x:        { type: "number", description: "Region left (omit for full screen)" },
        y:        { type: "number", description: "Region top (omit for full screen)" },
        width:    { type: "number", description: "Region width" },
        height:   { type: "number", description: "Region height" },
        language: { type: "string", description: "BCP-47 language tag e.g. 'en-US' (defaults to user profile language)" },
      },
      required: [],
    },
  },

  // ── Window management ──────────────────────────────────────────────────────
  {
    name: "list_windows",
    description:
      "Enumerate all visible top-level windows: handle, title, process name, PID, position (x/y), dimensions, minimized/maximized state. " +
      "Supports title substring filter. Use to find a window handle before calling focus/close/move tools.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Title substring filter (optional)" },
        limit:  { type: "number", description: "Max windows to return (default 50)" },
      },
      required: [],
    },
  },
  {
    name: "get_window_info",
    description: "Get detailed info about a single window: title, handle, class name, process, PID, bounds, minimized/maximized state.",
    inputSchema: {
      type: "object",
      properties: {
        title:  { type: "string", description: "Window title substring to match" },
        handle: { type: "number", description: "Window handle (HWND) for exact match" },
      },
      required: [],
    },
  },
  {
    name: "focus_window",
    description: "Bring a window to the foreground and restore it from minimized state. Provide title substring or handle.",
    inputSchema: {
      type: "object",
      properties: {
        title:  { type: "string", description: "Window title substring" },
        handle: { type: "number", description: "Window handle (HWND)" },
      },
      required: [],
    },
  },
  {
    name: "close_window",
    description: "Send WM_CLOSE to a window (graceful close, same as clicking the X). Provide title or handle.",
    inputSchema: {
      type: "object",
      properties: {
        title:  { type: "string", description: "Window title substring" },
        handle: { type: "number", description: "Window handle (HWND)" },
      },
      required: [],
    },
  },
  {
    name: "show_window",
    description: "Minimize, maximize, or restore a window via ShowWindow.",
    inputSchema: {
      type: "object",
      properties: {
        title:  { type: "string", description: "Window title substring" },
        handle: { type: "number", description: "Window handle (HWND)" },
        action: { type: "string", enum: ["minimize","maximize","restore"], description: "Action to perform" },
      },
      required: ["action"],
    },
  },
  {
    name: "move_resize_window",
    description: "Move and/or resize a window via SetWindowPos. Omit x/y to keep position; omit width/height to keep size.",
    inputSchema: {
      type: "object",
      properties: {
        title:  { type: "string", description: "Window title substring" },
        handle: { type: "number", description: "Window handle (HWND)" },
        x:      { type: "number", description: "New left edge position" },
        y:      { type: "number", description: "New top edge position" },
        width:  { type: "number", description: "New width in pixels" },
        height: { type: "number", description: "New height in pixels" },
      },
      required: [],
    },
  },
  {
    name: "get_active_window",
    description: "Get the currently focused (foreground) window: title, handle, process name, PID, position, size, and whether minimized/maximized.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "wait_for_window",
    description: "Poll until a window whose title contains the given string appears, then return its info. Useful after launching an app to wait for its window before interacting with it.",
    inputSchema: {
      type: "object",
      properties: {
        title:       { type: "string", description: "Substring to match in window title" },
        timeout_sec: { type: "number", description: "Max seconds to wait (default 30)" },
        interval_ms: { type: "number", description: "Poll interval in ms (default 500)" },
      },
      required: ["title"],
    },
  },
  {
    name: "launch_app",
    description: "Open a file, URL, or application using Windows Shell.Execute (same as double-clicking in Explorer). Supports any registered file type, URLs, and .exe paths.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "File path, URL (https://...), or executable" },
        args:   { type: "string", description: "Optional arguments for executables" },
      },
      required: ["target"],
    },
  },

  // ── UI Automation ──────────────────────────────────────────────────────────
  {
    name: "get_ui_tree",
    description:
      "Inspect the UI Automation element tree of a native window: all controls with name, type, automationId, class, value, enabled state, and bounding rect. " +
      "Use to discover element names/IDs before calling click_ui_element or set_ui_element_value.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Window title substring to inspect" },
        depth: { type: "number", description: "How many levels deep to traverse (default 3, max ~6)" },
      },
      required: ["title"],
    },
  },
  {
    name: "click_ui_element",
    description:
      "Click a UI element in a native window using Windows UI Automation InvokePattern. " +
      "Falls back to a mouse click at the element's center if invoke is not supported. " +
      "Use get_ui_tree first to find element_name or automation_id.",
    inputSchema: {
      type: "object",
      properties: {
        window_title:  { type: "string", description: "Window title substring" },
        element_name:  { type: "string", description: "Element Name property (from get_ui_tree)" },
        automation_id: { type: "string", description: "Element AutomationId property (more reliable than name)" },
        control_type:  { type: "string", description: "Control type hint to narrow search (optional)" },
      },
      required: ["window_title"],
    },
  },
  {
    name: "get_ui_element_value",
    description:
      "Read the current value, selected state, or name property of a UI element via Windows UI Automation ValuePattern/SelectionItemPattern.",
    inputSchema: {
      type: "object",
      properties: {
        window_title:  { type: "string", description: "Window title substring" },
        element_name:  { type: "string", description: "Element Name property" },
        automation_id: { type: "string", description: "Element AutomationId (preferred)" },
      },
      required: ["window_title"],
    },
  },
  {
    name: "set_ui_element_value",
    description:
      "Set the text value of a text field or editable control in a native window using UI Automation ValuePattern.SetValue(). " +
      "Clears the existing value and replaces it.",
    inputSchema: {
      type: "object",
      properties: {
        window_title:  { type: "string", description: "Window title substring" },
        element_name:  { type: "string", description: "Element Name property" },
        automation_id: { type: "string", description: "Element AutomationId (preferred)" },
        value:         { type: "string", description: "New value to set" },
      },
      required: ["window_title", "value"],
    },
  },

  // ── Mouse & Keyboard input ─────────────────────────────────────────────────
  {
    name: "move_mouse",
    description: "Move the mouse cursor to absolute screen coordinates (x, y).",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Screen X coordinate" },
        y: { type: "number", description: "Screen Y coordinate" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "click_at",
    description: "Click at absolute screen coordinates. button: left (default), right, or middle.",
    inputSchema: {
      type: "object",
      properties: {
        x:      { type: "number", description: "Screen X coordinate" },
        y:      { type: "number", description: "Screen Y coordinate" },
        button: { type: "string", enum: ["left","right","middle"], description: "Mouse button (default: left)" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "mouse_down",
    description: "Press and hold a mouse button at absolute screen coordinates. Pair with mouse_up to release.",
    inputSchema: {
      type: "object",
      properties: {
        x:      { type: "number", description: "Screen X coordinate" },
        y:      { type: "number", description: "Screen Y coordinate" },
        button: { type: "string", enum: ["left","right","middle"], description: "Mouse button (default: left)" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "mouse_up",
    description: "Release a held mouse button. Optionally move to x/y before releasing.",
    inputSchema: {
      type: "object",
      properties: {
        x:      { type: "number", description: "Optional screen X coordinate to move to before release" },
        y:      { type: "number", description: "Optional screen Y coordinate to move to before release" },
        button: { type: "string", enum: ["left","right","middle"], description: "Mouse button (default: left)" },
      },
      required: [],
    },
  },
  {
    name: "double_click_at",
    description: "Double left-click at absolute screen coordinates.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Screen X coordinate" },
        y: { type: "number", description: "Screen Y coordinate" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "scroll_at",
    description: "Scroll the mouse wheel at a position. delta: positive=scroll up, negative=scroll down (units = notches, default 3).",
    inputSchema: {
      type: "object",
      properties: {
        x:     { type: "number", description: "Screen X coordinate" },
        y:     { type: "number", description: "Screen Y coordinate" },
        delta: { type: "number", description: "Scroll amount in notches: positive=up, negative=down (default 3)" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "type_text",
    description:
      "Type text into the currently focused window via SendKeys. Special keys are auto-escaped. " +
      "Focus the target window with focus_window first. Supports optional delay before typing.",
    inputSchema: {
      type: "object",
      properties: {
        text:     { type: "string", description: "Text to type" },
        delay_ms: { type: "number", description: "Milliseconds to wait before typing (optional)" },
      },
      required: ["text"],
    },
  },
  {
    name: "press_hotkey",
    description:
      "Send a keyboard shortcut using SendKeys syntax. Examples: '^c'=Ctrl+C, '^v'=Ctrl+V, '%{F4}'=Alt+F4, '^+s'=Ctrl+Shift+S, '{ENTER}'=Enter, '{TAB}'=Tab. " +
      "Focus the target window first with focus_window.",
    inputSchema: {
      type: "object",
      properties: {
        keys: { type: "string", description: "SendKeys string, e.g. '^c' for Ctrl+C, '%{F4}' for Alt+F4" },
      },
      required: ["keys"],
    },
  },
  {
    name: "get_mouse_position",
    description: "Get the current mouse cursor position as {x, y} screen coordinates.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "drag_and_drop",
    description: "Smoothly drag from one screen position to another. Simulates mouse-down at source, interpolated movement, then mouse-up at destination. Works for file drag, UI rearrangement, sliders, etc.",
    inputSchema: {
      type: "object",
      properties: {
        from_x: { type: "number", description: "Source X coordinate" },
        from_y: { type: "number", description: "Source Y coordinate" },
        to_x:   { type: "number", description: "Destination X coordinate" },
        to_y:   { type: "number", description: "Destination Y coordinate" },
        button: { type: "string", enum: ["left","right","middle"], description: "Mouse button (default: left)" },
        steps:  { type: "number", description: "Number of interpolation steps for smooth movement (default: 20)" },
      },
      required: ["from_x","from_y","to_x","to_y"],
    },
  },
  {
    name: "key_down",
    description: "Hold a key down without releasing it. Use with key_up to simulate key-hold combinations (e.g., hold Shift while dragging). Common keys: SHIFT, CTRL, ALT, WIN, F1-F12.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key name in SendKeys/VK notation: SHIFT, CTRL, ALT, WIN, F1-F12, or single character" },
      },
      required: ["key"],
    },
  },
  {
    name: "key_up",
    description: "Release a key that was held down with key_down. Always pair with key_down to avoid stuck keys.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key name matching the corresponding key_down call" },
      },
      required: ["key"],
    },
  },
] as const;
