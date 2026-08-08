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
] as const;
