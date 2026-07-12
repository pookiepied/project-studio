/** Tool schema definitions for execution tools (bash, powershell, repl). */
export const EXECUTION_DEFINITIONS = [
  {
    name: "bash",
    description:
      "Execute a shell command. On Windows this runs via Git Bash (falling back to cmd.exe if Git Bash isn't installed); on macOS/Linux via /bin/sh. " +
      "Use this for running things — installs, builds, tests, git, scripts. " +
      "Do NOT author file content through the shell (echo/heredoc); use write_file / edit_file, which handle any characters safely. " +
      "Returns stdout, stderr, and exit code. " +
      "Output is capped at 50,000 chars by default — raise max_output_chars (up to 500,000) if you need more. " +
      "Processes stalled with no output are killed. Use non-interactive flags (--yes, -y) to prevent prompts.",
    inputSchema: {
      type: "object",
      properties: {
        command:          { type: "string", description: "The shell command to execute" },
        cwd:              { type: "string", description: "Working directory (optional, defaults to process cwd)" },
        timeout:          { type: "number", description: "Timeout in milliseconds (default 30000)" },
        max_output_chars: { type: "number", description: "Max chars to capture from stdout/stderr (default 50000, max 500000). Raise this when the command produces large output you need to see in full." },
      },
      required: ["command"],
    },
  },
  {
    name: "powershell",
    description:
      "Execute a PowerShell command (Windows) for system administration and deployment tasks. " +
      "Use for: running deployment commands (wrangler deploy, npm run build, git push), " +
      "system operations not covered by the dedicated desktop tools, and post-coding verification. " +
      "For file edits, prefer edit_file or multi_edit so changes are explicit and reviewable. " +
      "For Windows system settings (registry, display, audio, processes, firewall, network, etc.) " +
      "prefer the dedicated desktop tools which are more reliable and safer. " +
      "Returns stdout, stderr, and exit code. " +
      "Output is capped at 50,000 chars by default — raise max_output_chars (up to 500,000) if you need more.",
    inputSchema: {
      type: "object",
      properties: {
        command:          { type: "string", description: "PowerShell command to execute" },
        cwd:              { type: "string", description: "Working directory (optional)" },
        timeout:          { type: "number", description: "Timeout in milliseconds (default 30000)" },
        max_output_chars: { type: "number", description: "Max chars to capture from stdout/stderr (default 50000, max 500000)." },
      },
      required: ["command"],
    },
  },
  {
    name: "repl",
    description:
      "Execute code in a Node.js or Python interpreter. Writes the code to a temp file and runs it. " +
      "Returns stdout, stderr, and exit code. Output capped at 50,000 chars — raise max_output_chars if needed.",
    inputSchema: {
      type: "object",
      properties: {
        language:         { type: "string", enum: ["node", "python"], description: "Language to run the code in" },
        code:             { type: "string", description: "Code to execute" },
        timeout:          { type: "number", description: "Timeout in milliseconds (default 15000)" },
        max_output_chars: { type: "number", description: "Max chars to capture from stdout (default 50000, max 500000)" },
      },
      required: ["language", "code"],
    },
  },
  {
    name: "start_process",
    description:
      "Start a long-running command in the background and return immediately with a process_id. " +
      "Use this for anything that does NOT exit on its own — dev servers (npm run dev), file watchers, " +
      "test runners in watch mode, tail -f. For commands that run to completion (build, install, test, git) use `bash` instead, which blocks and returns the full output. " +
      "The process keeps running across tool calls; page its output with read_process_output, send stdin with write_process_input, and terminate it with stop_process. " +
      "All managed processes are killed automatically when the harness shuts down. Runs through the same shell as `bash` (Git Bash on Windows).",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command line to run in the background (e.g. 'npm run dev')." },
        cwd:     { type: "string", description: "Working directory (optional, defaults to the harness cwd)." },
        env:     { type: "object", additionalProperties: { type: "string" }, description: "Extra environment variables merged over the current environment (optional)." },
      },
      required: ["command"],
    },
  },
  {
    name: "read_process_output",
    description:
      "Read buffered stdout or stderr from a background process started with start_process, paged by character offset. " +
      "Returns a bounded chunk plus next_offset and has_more so you can page without re-reading. " +
      "stdout and stderr are paged independently. Output is retained in a rolling ~2 MB per-stream buffer; if older output was dropped the result says so. " +
      "Poll this to watch a dev server come up (e.g. wait for a 'ready' / 'listening on' line) rather than sleeping blindly.",
    inputSchema: {
      type: "object",
      properties: {
        process_id: { type: "string", description: "The process_id returned by start_process." },
        stream:     { type: "string", enum: ["stdout", "stderr"], description: "Which stream to read (default 'stdout')." },
        offset:     { type: "number", description: "Absolute character offset to start reading from (default 0). Pass the previous next_offset to continue." },
        limit:      { type: "number", description: "Max characters to return (default 20000, max 200000)." },
      },
      required: ["process_id"],
    },
  },
  {
    name: "write_process_input",
    description:
      "Send a line of input to the stdin of a running background process (e.g. answer an interactive prompt, or issue a command to a REPL/watch process). " +
      "A trailing newline is appended by default so the process sees a complete line. Only works while the process is running.",
    inputSchema: {
      type: "object",
      properties: {
        process_id:     { type: "string", description: "The process_id returned by start_process." },
        input:          { type: "string", description: "Text to write to the process's stdin." },
        append_newline: { type: "boolean", description: "Append a trailing newline if absent (default true)." },
      },
      required: ["process_id", "input"],
    },
  },
  {
    name: "stop_process",
    description:
      "Terminate a background process started with start_process and (by default) remove it from the process table. " +
      "Sends SIGTERM first, then SIGKILL after a short grace period; on Windows the whole process tree is killed. " +
      "Returns the final status, exit code, and output counts. Always stop dev servers and watchers you started once you are done with them.",
    inputSchema: {
      type: "object",
      properties: {
        process_id: { type: "string", description: "The process_id returned by start_process." },
        signal:     { type: "string", description: "POSIX signal to send first (default 'SIGTERM'). Ignored on Windows." },
        remove:     { type: "boolean", description: "Remove the process from the table after stopping (default true). Pass false to keep it listed for a final output read." },
      },
      required: ["process_id"],
    },
  },
  {
    name: "list_processes",
    description:
      "List the background processes started by this harness via start_process, with status (running/exited/killed), pid, uptime, and buffered-output sizes. " +
      "Only shows harness-managed processes — never unrelated system processes. Use it to recover a process_id or check whether a dev server is still up.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "command_exists",
    description:
      "Check whether an executable is available and resolve its path and version — without running arbitrary code. " +
      "Use this to preflight a tool (does `cargo`, `pnpm`, `python` exist?) before invoking it, so a missing-binary failure is caught cleanly. " +
      "Takes a bare executable name, not a command line.",
    inputSchema: {
      type: "object",
      properties: {
        command:       { type: "string", description: "Bare executable name to resolve (e.g. 'node', 'cargo'). No arguments or shell syntax." },
        probe_version: { type: "boolean", description: "Also run `<command> --version` to capture a version string (default true)." },
      },
      required: ["command"],
    },
  },
] as const;
