/** Tool schema definitions for code-intelligence tools (outline, indexing, symbol search, file analysis). */
export const CODEINTEL_DEFINITIONS = [
  {
    name: "outline_file",
    description:
      "Get the structural outline of a file — functions, classes, interfaces, exports — with line numbers, " +
      "WITHOUT reading the file content. Use this before read_file on any file over ~100 lines. " +
      "Tells you exactly which line range to pass to read_file for the relevant section. " +
      "Uses LSP for rich output when available, Tree-sitter as the broad structural fallback, then regex for unsupported grammars. " +
      "Supported: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Ruby, C/C++.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute or relative path to the file to outline",
        },
        workspace_root: {
          type: "string",
          description:
            "Project root directory for LSP context (optional — auto-detected from file path)",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "index_codebase",
    description:
      "Build or refresh a knowledge index of a codebase. " +
      "Scans source files, extracts import/export relationships, and produces two files in .studio/:\n" +
      "  CODEBASE.md — LLM-readable overview: directory structure, entry points, largest files, hub files\n" +
      "  graph.json  — machine-readable import/export graph with content hashes\n\n" +
      "Incremental: files with unchanged content are skipped (hash comparison), so re-runs are fast. " +
      "Run this once at the start of a coding session on an unfamiliar project, then read .studio/CODEBASE.md " +
      "to orient yourself before reading any source files. " +
      "Supports: TypeScript, JavaScript, Python, Go, Rust, Java, Ruby, and more.",
    inputSchema: {
      type: "object",
      properties: {
        root_dir: {
          type: "string",
          description:
            "Root directory to index (optional, defaults to current working directory)",
        },
        force: {
          type: "boolean",
          description:
            "Force full re-scan even for unchanged files (default false)",
        },
        max_files: {
          type: "number",
          description:
            "Maximum number of files to index (default 500). Increase for larger codebases.",
        },
        timeout: {
          type: "number",
          description:
            "Timeout in milliseconds (default 120000). Increase to 300000 for large monorepos.",
        },
      },
      required: [],
    },
  },
  {
    name: "explore_codebase",
    description:
      "Orient to a project in one call. Builds or uses the existing .studio/CODEBASE.md knowledge index, " +
      "then returns the full project map plus structural outlines of key entry-point files. " +
      "Use this at the start of any coding session on an unfamiliar project — it replaces 5-10 " +
      "separate glob/read/outline calls and costs a fraction of the tokens. " +
      "Subsequent calls are fast because the index is incremental (only changed files re-processed).",
    inputSchema: {
      type: "object",
      properties: {
        root_dir: {
          type: "string",
          description: "Project root directory (optional, defaults to cwd)",
        },
        include_outlines: {
          type: "boolean",
          description:
            "Include structural outlines of entry-point files (default true)",
        },
      },
      required: [],
    },
  },
  {
    name: "search_symbol",
    description:
      "Find a function, class, type, or variable anywhere in the codebase — in one call. " +
      "Tries LSP workspaceSymbol first (most accurate), then falls back to grep with declaration patterns, " +
      "then broad grep. Returns file path, line number, code snippet, and structural outline of the " +
      "containing file. Use this instead of manually running grep + outline_file + read_file in sequence.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description:
            "Name of the symbol to find (function, class, type, variable, etc.)",
        },
        root_dir: {
          type: "string",
          description: "Project root to search in (optional, defaults to cwd)",
        },
        type: {
          type: "string",
          description:
            "File type to restrict search (e.g. 'ts', 'py', 'go', 'rust')",
        },
        max_results: {
          type: "number",
          description: "Maximum number of matches to return (default 5)",
        },
      },
      required: ["symbol"],
    },
  },
  {
    name: "analyze_file",
    description:
      "Deep-dive analysis of a file in one call — without reading the whole thing. " +
      "Returns: structural outline (all functions/classes/exports with line numbers), " +
      "the first 40 lines (imports, top-level setup), and which other files import this file. " +
      "After this call you know what's in the file, how it's structured, what it depends on, " +
      "and who depends on it. Use this before making changes to any file over ~100 lines.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to analyze (absolute or relative)",
        },
        root_dir: {
          type: "string",
          description:
            "Project root for reverse dependency lookup (optional, auto-detected)",
        },
      },
      required: ["file_path"],
    },
  },
] as const;
