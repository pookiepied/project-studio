/** Tool schema definitions for desktop process/service control tools. */
export const DESKTOP_CONTROL_DEFINITIONS = [
  {
    name: "kill_process",
    description:
      "Force-kill one or more Windows processes by name or PID. " +
      "Returns list of killed {name, pid}. Ask the user before killing system-critical processes (lsass, winlogon, csrss, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Process name (e.g. 'chrome', 'notepad') — kills ALL matching instances" },
        pid:  { type: "number", description: "Exact PID to kill" },
      },
      required: [],
      anyOf: [{ required: ["name"] }, { required: ["pid"] }],
    },
  },
  {
    name: "set_process_priority",
    description:
      "Change the Windows scheduling priority of a process. " +
      "High/RealTime can starve other processes — prefer AboveNormal for performance boosts. " +
      "Provide name or pid.",
    inputSchema: {
      type: "object",
      properties: {
        name:     { type: "string", description: "Process name" },
        pid:      { type: "number", description: "Process ID" },
        priority: { type: "string", enum: ["realtime","high","above_normal","normal","below_normal","idle"], description: "Priority class" },
      },
      required: ["priority"],
      anyOf: [{ required: ["name"] }, { required: ["pid"] }],
    },
  },
  {
    name: "suspend_process",
    description:
      "Suspend (freeze) or resume a process via NtSuspendProcess/NtResumeProcess. " +
      "Suspended processes consume no CPU but stay in memory. Use to pause a runaway process without killing it.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["suspend","resume"], description: "Action to perform" },
        pid:    { type: "number", description: "Process ID" },
        name:   { type: "string", description: "Process name (first match)" },
      },
      required: ["action"],
      anyOf: [{ required: ["name"] }, { required: ["pid"] }],
    },
  },
  {
    name: "manage_service",
    description:
      "Windows service management: list all services, or get status / start / stop / restart / pause / resume a named service. " +
      "Use action: list first to find the internal Name (not DisplayName) for other actions.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list","status","start","stop","restart","pause","resume"], description: "Action (default: status)" },
        name:   { type: "string", description: "Service Name (e.g. 'wuauserv', 'postgresql-x64-16')" },
      },
      required: ["action"],
    },
  },
  {
    name: "set_service_startup",
    description:
      "Change the startup type of a Windows service (Automatic, AutomaticDelayedStart, Manual, Disabled). " +
      "Takes effect on next boot for Boot/System types.",
    inputSchema: {
      type: "object",
      properties: {
        name:    { type: "string", description: "Service Name" },
        startup: { type: "string", enum: ["Automatic","AutomaticDelayedStart","Manual","Disabled","Boot","System"], description: "New startup type" },
      },
      required: ["name", "startup"],
    },
  },
  {
    name: "run_elevated",
    description:
      "Run a PowerShell command as Administrator (elevated). Triggers a UAC prompt if UAC is enabled. " +
      "Output cannot be captured from the elevated process — redirect to a file if you need the result. " +
      "Use for tasks requiring admin rights that the current session cannot do.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "PowerShell command to run elevated, e.g. 'Set-ExecutionPolicy RemoteSigned'" },
      },
      required: ["command"],
    },
  },

  // ── process extras ────────────────────────────────────────────────────────
  {
    name: "start_process",
    description: "Launch a new process. Can wait for completion and capture stdout/stderr. Use for running executables, scripts, or opening files with their default app.",
    inputSchema: {
      type: "object",
      properties: {
        executable:     { type: "string",  description: "Path to executable or command" },
        args:           { type: "string",  description: "Arguments string (optional)" },
        cwd:            { type: "string",  description: "Working directory (optional)" },
        wait:           { type: "boolean", description: "Wait for process to exit (default: true)" },
        window_style:   { type: "string",  enum: ["Normal","Minimized","Maximized","Hidden"], description: "Window style (default: Normal)" },
        capture_output: { type: "boolean", description: "Capture stdout/stderr (forces UseShellExecute=false)" },
      },
      required: ["executable"],
    },
  },
  {
    name: "get_process_details",
    description: "Deep inspection of a single process: command line, parent process, loaded module names (sample), CPU/RAM, threads, handles, path, company, version, and whether it's responding.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Process name" },
        pid:  { type: "number", description: "Process ID" },
      },
      required: [],
      anyOf: [{ required: ["name"] }, { required: ["pid"] }],
    },
  },
  {
    name: "set_process_affinity",
    description: "Pin a process to specific CPU cores by setting its processor affinity mask. Useful for isolating workloads or reducing CPU contention.",
    inputSchema: {
      type: "object",
      properties: {
        name:  { type: "string",  description: "Process name" },
        pid:   { type: "number",  description: "Process ID" },
        cores: { type: "array", items: { type: "number" }, description: "0-based core indices to allow, e.g. [0,1,2,3]" },
      },
      required: ["cores"],
      anyOf: [{ required: ["name"] }, { required: ["pid"] }],
    },
  },
] as const;
