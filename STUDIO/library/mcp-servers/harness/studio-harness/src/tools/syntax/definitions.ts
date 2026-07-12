const file = { type: "string", description: "Source file to parse." },
  root = { type: "string", description: "Repository root (default cwd)." },
  max = { type: "number", description: "Maximum returned results." };
export const SYNTAX_DEFINITIONS = [
  {
    name: "parse_file",
    description:
      "Return a compact, bounded Tree-sitter syntax tree with source ranges and optional node text.",
    inputSchema: {
      type: "object",
      properties: {
        path: file,
        start_line: {
          type: "number",
          description: "Optional 1-based range start.",
        },
        end_line: {
          type: "number",
          description: "Optional 1-based inclusive range end.",
        },
        max_depth: {
          type: "number",
          description: "Maximum returned tree depth (default 6, maximum 30).",
        },
        max_nodes: {
          type: "number",
          description: "Maximum returned nodes (default 1000, maximum 10000).",
        },
        include_text: {
          type: "boolean",
          description:
            "Include source text for returned nodes (default false).",
        },
        named_nodes_only: {
          type: "boolean",
          description: "Exclude anonymous grammar tokens (default true).",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "query_syntax_tree",
    description:
      "Run a native Tree-sitter S-expression query and return bounded structured captures.",
    inputSchema: {
      type: "object",
      properties: {
        path: file,
        query: {
          type: "string",
          description:
            "Tree-sitter query source using grammar node types and @captures.",
        },
        include_text: {
          type: "boolean",
          description: "Include capture source text (default true).",
        },
        max_results: {
          type: "number",
          description: "Maximum captures (default 250, maximum 5000).",
        },
      },
      required: ["path", "query"],
    },
  },
  {
    name: "find_structural_pattern",
    description:
      "Find code with the same normalized AST shape as a valid example snippet, ignoring identifier and literal values.",
    inputSchema: {
      type: "object",
      properties: {
        path: file,
        pattern: {
          type: "string",
          description: "Valid code snippet in the target file's language.",
        },
        max_results: {
          type: "number",
          description: "Maximum matches (default 100, maximum 1000).",
        },
      },
      required: ["path", "pattern"],
    },
  },
  {
    name: "structural_replace",
    description:
      "Preview or revision-safely apply a static replacement to every normalized AST match; reparses and rolls back if syntax errors result.",
    inputSchema: {
      type: "object",
      properties: {
        path: file,
        pattern: {
          type: "string",
          description: "Valid structural example snippet.",
        },
        replacement: {
          type: "string",
          description: "Static replacement source text.",
        },
        max_results: {
          type: "number",
          description: "Maximum structural matches considered.",
        },
        apply: {
          type: "boolean",
          description:
            "Apply after preview and revision validation (default false).",
        },
        expected_revision: {
          type: "object",
          description:
            "Revision returned by read_file; required when apply is true.",
        },
      },
      required: ["path", "pattern", "replacement"],
    },
  },
  {
    name: "extract_symbol_body",
    description:
      "Return exactly one complete Tree-sitter definition body and revision; ambiguous names return candidates instead of guessing.",
    inputSchema: {
      type: "object",
      properties: {
        path: file,
        symbol: { type: "string", description: "Exact definition name." },
      },
      required: ["path", "symbol"],
    },
  },
  {
    name: "find_dead_exports",
    description:
      "Find conservative JavaScript/TypeScript export candidates with no additional lexical identifier occurrence; never treats candidates as deletion proof.",
    inputSchema: {
      type: "object",
      properties: {
        root_dir: root,
        glob: {
          type: "string",
          description: "Source glob (default JS/TS files).",
        },
        max_files: {
          type: "number",
          description: "Maximum files analyzed (default 500, maximum 2000).",
        },
      },
      required: [],
    },
  },
  {
    name: "find_duplicate_structure",
    description:
      "Identify functions and methods with identical normalized AST shape across bounded repository files.",
    inputSchema: {
      type: "object",
      properties: {
        root_dir: root,
        glob: { type: "string", description: "Source glob override." },
        max_files: {
          type: "number",
          description: "Maximum parsed files (default 500, maximum 2000).",
        },
        max_groups: {
          type: "number",
          description: "Maximum duplicate groups (default 50, maximum 500).",
        },
      },
      required: [],
    },
  },
  {
    name: "calculate_complexity",
    description:
      "Return per-function Tree-sitter complexity, nesting, branch count and line metrics with the approximation formula.",
    inputSchema: {
      type: "object",
      properties: { path: file },
      required: ["path"],
    },
  },
  {
    name: "detect_syntax_errors",
    description:
      "Parse without compiling or executing and return Tree-sitter ERROR and missing nodes as structured ranges.",
    inputSchema: {
      type: "object",
      properties: {
        path: file,
        max_results: {
          type: "number",
          description: "Maximum syntax errors (default 200, maximum 2000).",
        },
      },
      required: ["path"],
    },
  },
] as const;
