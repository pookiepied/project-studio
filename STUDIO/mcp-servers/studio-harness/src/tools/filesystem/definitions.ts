/** Tool schema definitions for filesystem tools — raw file access + text/name search. */
export const FILESYSTEM_DEFINITIONS = [
  {
    name: "read_file",
    description:
      "Read the contents of a file with line numbers. Supports offset/limit to read specific ranges — " +
      "always use these for files over ~500 lines. Returns line-numbered content, total line count, " +
      "and start line so you can reference exact positions in follow-up calls. " +
      "For large files without offset/limit, you will get an instructive error explaining your options — " +
      "including allow_large: true to read the full file when you genuinely need it. " +
      "Use outline_file first on large files to find the exact section you need.",
    inputSchema: {
      type: "object",
      properties: {
        path:        { type: "string",  description: "Absolute or relative path to the file" },
        offset:      { type: "number",  description: "0-indexed line position to start reading from (default 0 = beginning). Use with limit to read specific sections." },
        limit:       { type: "number",  description: "Maximum number of lines to return. Omit only for small files. For large files, always provide this." },
        allow_large: { type: "boolean", description: "Set to true to bypass the large-file token gate and read the entire file. Use only when you genuinely need the full content — prefer offset+limit or outline_file for efficiency. A 5 MB hard ceiling still applies regardless." },
      },
      required: ["path"],
    },
  },
  {
    name: "edit_file",
    description:
      "Replace an exact string in a file. old_string must appear exactly once — add surrounding " +
      "lines if needed to make it unique. Use write_file for complete rewrites.",
    inputSchema: {
      type: "object",
      properties: {
        path:       { type: "string", description: "Path to the file to edit" },
        old_string: { type: "string", description: "Exact string to find (must be unique in the file)" },
        new_string: { type: "string", description: "String to replace it with" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "multi_edit",
    description:
      "Apply multiple exact-string replacements across one or more existing files. " +
      "All edits are validated before any file is written: every old_string must appear exactly once " +
      "at the point it is applied. Use this for coordinated edits that should succeed or fail together.",
    inputSchema: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          description: "Ordered list of replacements to apply. Later edits to the same file see earlier edits.",
          items: {
            type: "object",
            properties: {
              path:       { type: "string", description: "Path to the file to edit" },
              old_string: { type: "string", description: "Exact string to find (must be unique when this edit is applied)" },
              new_string: { type: "string", description: "String to replace it with" },
            },
            required: ["path", "old_string", "new_string"],
          },
        },
      },
      required: ["edits"],
    },
  },
  {
    name: "write_file",
    description:
      "Write (overwrite) a file with new content. Creates parent directories if they don't exist. " +
      "Use for new files or complete rewrites; prefer edit_file for targeted changes.",
    inputSchema: {
      type: "object",
      properties: {
        path:    { type: "string", description: "Path to the file to write" },
        content: { type: "string", description: "Full content to write to the file" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "delete_file",
    description:
      "Delete a file or directory. For directories, recursive: true is required — " +
      "this permanently removes the directory and all its contents. " +
      "ALWAYS confirm with the user before deleting directories or important files.",
    inputSchema: {
      type: "object",
      properties: {
        path:      { type: "string",  description: "Absolute or relative path to the file or directory to delete" },
        recursive: { type: "boolean", description: "Required when deleting a directory — removes it and all contents (default: false)" },
      },
      required: ["path"],
    },
  },
  {
    name: "move_file",
    description:
      "Move or rename a file or directory. Creates destination parent directories if needed. " +
      "Works across drives on Windows by falling back to copy-then-delete.",
    inputSchema: {
      type: "object",
      properties: {
        source:      { type: "string", description: "Current path of the file or directory" },
        destination: { type: "string", description: "New path (including new name if renaming)" },
      },
      required: ["source", "destination"],
    },
  },
  {
    name: "glob",
    description:
      "Find files matching a glob pattern (e.g. **/*.ts, src/**/*.css). " +
      "Returns matching absolute paths sorted alphabetically.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern to match (e.g. **/*.ts)" },
        path:    { type: "string", description: "Directory to search in (optional, defaults to cwd)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "grep",
    description:
      "Search file contents for a regex pattern. Use this tool instead of shelling out to rg, grep, or PowerShell search commands. " +
      "Runs ripgrep (bundled with Studio), so results honor .gitignore and match ripgrep semantics everywhere. " +
      "Use type to filter by language (e.g. 'ts', 'py', 'go') instead of glob for common types. " +
      "Results are paginated — use head_limit and offset to page through large result sets. " +
      "output_mode controls format: 'files_with_matches' (default), 'content' (lines), or 'count'. " +
      "Auto-excludes .git, node_modules, dist, and other noise directories.",
    inputSchema: {
      type: "object",
      properties: {
        pattern:          { type: "string",  description: "Regular expression to search for" },
        path:             { type: "string",  description: "File or directory to search (optional, defaults to cwd)" },
        glob:             { type: "string",  description: "File glob filter (e.g. *.ts, **/*.tsx)" },
        type:             { type: "string",  description: "File type shorthand (e.g. 'ts', 'js', 'py', 'go', 'rust', 'java'). More efficient than glob for standard types." },
        output_mode:      { type: "string",  enum: ["content", "files_with_matches", "count"], description: "Output format (default: files_with_matches)" },
        case_insensitive: { type: "boolean", description: "Case-insensitive search (-i)" },
        context_lines:    { type: "number",  description: "Lines of context before AND after each match (-C)" },
        "-A":             { type: "number",  description: "Lines to show AFTER each match (requires output_mode: content)" },
        "-B":             { type: "number",  description: "Lines to show BEFORE each match (requires output_mode: content)" },
        multiline:        { type: "boolean", description: "Enable multiline mode — dot matches newlines, patterns can span lines (-U --multiline-dotall)" },
        head_limit:       { type: "number",  description: "Max results to return (default 250). Pass 0 for unlimited. Use with offset to paginate." },
        offset:           { type: "number",  description: "Skip first N results before applying head_limit (default 0). Use for pagination." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "ls",
    description:
      "List the contents of a directory. Returns file/folder entries with types and sizes. " +
      "Skips hidden files (dotfiles) by default.",
    inputSchema: {
      type: "object",
      properties: {
        path:      { type: "string",  description: "Directory to list (optional, defaults to cwd)" },
        recursive: { type: "boolean", description: "List recursively (default false)" },
      },
      required: [],
    },
  },
] as const;
