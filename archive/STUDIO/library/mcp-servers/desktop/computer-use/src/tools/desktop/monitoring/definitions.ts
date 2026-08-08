/** Tool schema definitions for desktop monitoring tools (read-only hardware & OS stats). */
export const DESKTOP_MONITORING_DEFINITIONS = [
  {
    name: "get_system_stats",
    description:
      "Get real-time snapshot: CPU load %, RAM (total/free/used %), per-disk size/free/used%, GPU name & VRAM, OS name, uptime hours. " +
      "Use as the fast health check before diving into specific monitoring tools.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_cpu_details",
    description:
      "Deep CPU info: processor name, physical/logical core count, max & current GHz, temperature (if WMI thermal zone available), " +
      "total process/thread count, and per-core usage % sampled over 1 second. Use after get_system_stats when you need per-core breakdown.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_disk_io",
    description:
      "Current disk read/write throughput in KB/s per physical disk, sampled over 1 second via Windows performance counters. " +
      "Use to diagnose I/O bottlenecks or high disk activity.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_gpu_stats",
    description:
      "GPU stats: load %, VRAM used/total, temperature, power draw. " +
      "Uses nvidia-smi for NVIDIA cards (full stats). Falls back to WMI Win32_VideoController (name + VRAM only, no load %) for other GPUs.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_battery_info",
    description:
      "Battery status for laptops: charge level %, status (Charging/Discharging/Full), estimated runtime minutes, and health %. " +
      "Returns present: false on desktops or when no battery is reported by WMI.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_processes",
    description:
      "List running Windows processes: name, PID, CPU seconds, RAM MB, peak RAM MB, thread count, handle count, priority class, start time. " +
      "Sorted by RAM (default) or CPU. Supports name_filter substring search. Use before kill_process or set_process_priority.",
    inputSchema: {
      type: "object",
      properties: {
        limit:       { type: "number", description: "Max processes to return (default 60)" },
        sort_by:     { type: "string", enum: ["ram", "cpu"], description: "Sort field (default: ram)" },
        name_filter: { type: "string", description: "Substring to filter process names (optional)" },
      },
      required: [],
    },
  },
  {
    name: "get_network_stats",
    description:
      "Active TCP connections grouped with adapter info. Each connection shows local/remote address+port, state, owning process. " +
      "filter: listening = only open ports; established = only active sessions.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["all", "listening", "established"], description: "Connection state filter (default: all)" },
      },
      required: [],
    },
  },
  {
    name: "get_network_bandwidth",
    description:
      "Current network throughput in KB/s per adapter (bytes received/sent per second), sampled over 1 second. " +
      "Use to identify which adapter is saturated or which process is consuming bandwidth.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_event_log",
    description:
      "Read Windows Event Log entries (System, Application, Security, etc.). Returns timestamp, EventId, level, provider, and truncated message. " +
      "Filter by severity level, source provider, or start_time. Use to diagnose service failures, crashes, or system errors.",
    inputSchema: {
      type: "object",
      properties: {
        log_name:   { type: "string", description: "Log name: System, Application, Security, Setup, etc. (default: System)" },
        max_events: { type: "number", description: "Max entries to return (default 20)" },
        level:      { type: "string", enum: ["Critical","Error","Warning","Information"], description: "Filter by severity (optional)" },
        source:     { type: "string", description: "Filter by provider/source name substring (optional)" },
        start_time: { type: "string", description: "ISO datetime lower bound, e.g. '2025-01-01 08:00' (optional)" },
      },
      required: [],
    },
  },

  // ── monitoring extras ────────────────────────────────────────────────────
  {
    name: "get_memory_details",
    description: "Detailed RAM breakdown: physical used/free, virtual memory, page file, committed bytes, paged/non-paged pool, cache, and page faults per second.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_storage_info",
    description: "Storage overview: all volumes (drive letter, file system, total/free GB, health) and physical disks (model, type, size, health). Use for disk capacity planning and health checks.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_system_info",
    description: "Full hardware inventory: computer name, manufacturer/model, CPU, RAM, OS version/build/arch, BIOS version/date, motherboard, serial number, domain.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_drivers",
    description: "List Windows drivers (online or offline). Filter by signed/unsigned status or name substring. Use to audit unsigned drivers or diagnose BSoD causes.",
    inputSchema: {
      type: "object",
      properties: {
        filter:      { type: "string", enum: ["all","signed","unsigned"], description: "Signature filter (default: all)" },
        name_filter: { type: "string", description: "Substring to match in driver name" },
        limit:       { type: "number", description: "Max results (default 100)" },
      },
      required: [],
    },
  },
] as const;
