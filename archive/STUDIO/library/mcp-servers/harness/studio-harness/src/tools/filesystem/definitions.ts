/** Tool schema definitions for filesystem tools — raw file access + text/name search. */
export const FILESYSTEM_DEFINITIONS = [
  {
    name: "read_file",
    description:
      "Read text using bounded line or byte ranges without loading the complete file into memory. " +
      "Prefer 1-based start_line/end_line; legacy offset/limit remains supported. Responses have a byte budget, " +
      "line numbers, total lines, and truncation metadata. Binary content is refused and routed through file_metadata.",
    inputSchema: {
      type: "object",
      properties: {
        path:        { type: "string",  description: "Absolute or relative path to the file" },
        offset:      { type: "number",  description: "0-indexed line position to start reading from (default 0 = beginning). Use with limit to read specific sections." },
        limit:       { type: "number",  description: "Maximum number of lines to return. Omit only for small files. For large files, always provide this." },
        start_line:  { type: "number", description: "1-based first line; preferred over legacy offset" },
        end_line:    { type: "number", description: "1-based inclusive final line" },
        max_bytes:   { type: "number", description: "Maximum response bytes (default 262144, hard max 5 MB)" },
        byte_offset: { type: "number", description: "Raw byte start; requires byte_length" },
        byte_length: { type: "number", description: "Raw bytes requested; requires byte_offset" },
        encoding:    { type: "string", description: "Text encoding (default utf8)" },
        include_line_numbers: { type: "boolean", description: "Prefix returned text lines with source line numbers (default true)." },
      },
      required: ["path"],
    },
  },
  {
    name: "read_many_files", description: "Read explicit bounded ranges from multiple files with aggregate file and byte budgets.",
    inputSchema: { type: "object", properties: { requests: { type: "array", description: "Explicit file requests; each entry requires path and may provide a bounded line range and byte budget.", items: { type: "object", properties: { path: { type: "string", description: "File to read." }, start_line: { type: "number", description: "1-based first line." }, end_line: { type: "number", description: "1-based inclusive final line." }, max_bytes: { type: "number", description: "Per-file response-byte ceiling." } }, required: ["path"] } }, max_files: { type: "number", description: "Maximum requests processed (default 20, hard maximum 100)." }, max_total_bytes: { type: "number", description: "Aggregate returned-content budget (default 524288 bytes, hard maximum 5242880)." } }, required: ["requests"] },
  },
  { name: "file_metadata", description: "Inspect file type, size, timestamps, binary/encoding classification, and generated/minified heuristics.", inputSchema: { type: "object", properties: { path: { type: "string", description: "File or directory to inspect." } }, required: ["path"] } },
  { name: "detect_binary", description: "Classify a file as text or binary from a bounded sample.", inputSchema: { type: "object", properties: { path: { type: "string", description: "File to classify." }, sample_bytes: { type: "number", description: "Leading bytes sampled (default 8192, maximum 1048576)." } }, required: ["path"] } },
  { name: "content_hash", description: "Compute a stable hash for a file or selected byte range.", inputSchema: { type: "object", properties: { path: { type: "string", description: "File to hash." }, algorithm: { type: "string", enum: ["sha256", "sha512", "sha1", "md5"], description: "Hash algorithm (default sha256)." }, byte_offset: { type: "number", description: "Zero-based byte offset (default 0)." }, byte_length: { type: "number", description: "Number of bytes to hash; omit to hash through end-of-file." } }, required: ["path"] } },
  { name: "watch_files", description: "Track changes using snapshots. Actions: snapshot, changes, drop.", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["snapshot", "changes", "drop"], description: "Lifecycle operation (default snapshot)." }, path: { type: "string", description: "Root directory for snapshot; defaults to cwd." }, snapshot_id: { type: "string", description: "Required for changes and drop operations." }, max_files: { type: "number", description: "Maximum scanned files (default 10000, hard maximum 100000)." } }, required: [] } },
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
        expected_revision: { type: "object", description: "Optional revision returned by read_file; rejects the edit with stale_file when its hash no longer matches.", properties: { algorithm: { type: "string", description: "Hash algorithm; currently sha256." }, hash: { type: "string", description: "Expected whole-file hash." }, size_bytes: { type: "number", description: "File size observed during the read." }, modified_ms: { type: "number", description: "Modification time observed during the read." } }, required: ["hash"] },
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
              expected_revision: { type: "object", description: "Optional revision returned by read_file for this file.", properties: { hash: { type: "string", description: "Expected whole-file SHA-256 hash." } }, required: ["hash"] },
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
        expected_revision: { type: "object", description: "Optional revision required to overwrite an existing file; a mismatch rejects the write.", properties: { hash: { type: "string", description: "Expected whole-file SHA-256 hash." } }, required: ["hash"] },
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
        expected_revision: { type: "object", description: "Optional revision required before deleting a regular file; not applicable to directories.", properties: { hash: { type: "string", description: "Expected whole-file SHA-256 hash." } }, required: ["hash"] },
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
        expected_revision: { type: "object", description: "Optional revision required before moving a regular file; not applicable to directories.", properties: { hash: { type: "string", description: "Expected whole-file SHA-256 hash." } }, required: ["hash"] },
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
        depth: { type: "number", description: "Maximum tree depth" },
        max_entries: { type: "number", description: "Maximum returned entries (default 500)" },
        include_hidden: { type: "boolean", description: "Include dotfiles" },
        ignore: { type: "array", items: { type: "string" }, description: "Additional exact names to ignore" },
      },
      required: [],
    },
  },
] as const;
