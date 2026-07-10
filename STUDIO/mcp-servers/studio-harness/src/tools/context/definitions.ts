const root = {
    type: "string",
    description: "Repository/worktree root (default cwd).",
  },
  max = {
    type: "number",
    description: "Maximum results (default 10, maximum 100).",
  },
  tests = { type: "boolean", description: "Include test code (default true)." },
  generated = {
    type: "boolean",
    description: "Include generated code (default false).",
  };
export const CONTEXT_DEFINITIONS = [
  {
    name: "semantic_code_search",
    description:
      "Find symbol-bounded code by meaning. Returns structured ranges, scores, reasons, snippets, hashes, freshness, and the ranking backend used.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Behavior or concept to locate.",
        },
        root_dir: root,
        max_results: max,
        min_score: {
          type: "number",
          description: "Minimum combined similarity score (default 0).",
        },
        include_tests: tests,
        include_generated: generated,
      },
      required: ["query"],
    },
  },
  {
    name: "semantic_document_search",
    description:
      "Search text-based repository documentation by meaning; does not process PDFs or Office documents.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Architecture, specification, or documentation concept.",
        },
        root_dir: root,
        max_results: max,
        min_score: {
          type: "number",
          description: "Minimum combined similarity score.",
        },
        include_generated: generated,
      },
      required: ["query"],
    },
  },
  {
    name: "find_similar_implementation",
    description:
      "Find implementations similar to supplied code or a selected source range, excluding the source file by default.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Example implementation text." },
        path: {
          type: "string",
          description: "Example source file when code is omitted.",
        },
        start_line: {
          type: "number",
          description: "1-based example range start.",
        },
        end_line: {
          type: "number",
          description: "1-based inclusive example range end.",
        },
        root_dir: root,
        max_results: max,
        include_tests: tests,
        include_generated: generated,
      },
      required: [],
    },
  },
  {
    name: "find_feature_implementation",
    description:
      "Locate and group the code, tests, configuration, and repository documentation implementing a conceptual feature.",
    inputSchema: {
      type: "object",
      properties: {
        feature: {
          type: "string",
          description: "Conceptual feature or behavior.",
        },
        root_dir: root,
        max_results: {
          type: "number",
          description: "Maximum candidate pieces (default 30, maximum 100).",
        },
        include_tests: tests,
        include_generated: generated,
      },
      required: ["feature"],
    },
  },
  {
    name: "retrieve_context_bundle",
    description:
      "Return a ranked, deduplicated, token-bounded collection of relevant repository context for a coding task.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Coding task or investigation goal.",
        },
        root_dir: root,
        token_budget: {
          type: "number",
          description:
            "Approximate total token budget (default 8000, maximum 100000).",
        },
        max_items: {
          type: "number",
          description:
            "Maximum candidates before budget selection (default 30, maximum 100).",
        },
        max_files: {
          type: "number",
          description: "Maximum selected items/files (default 20).",
        },
        include_tests: tests,
        include_generated: generated,
      },
      required: ["task"],
    },
  },
  {
    name: "explain_retrieval",
    description:
      "Explain the stored ranking signals and metadata for a specific indexed chunk and query.",
    inputSchema: {
      type: "object",
      properties: {
        chunk_id: {
          type: "string",
          description: "Chunk identifier returned by a retrieval tool.",
        },
        query: {
          type: "string",
          description: "Query whose similarity should be explained.",
        },
        root_dir: root,
      },
      required: ["chunk_id", "query"],
    },
  },
  {
    name: "index_status",
    description:
      "Report context-index version, coverage, partitions, embedding backend, failures, Git revision, and freshness.",
    inputSchema: {
      type: "object",
      properties: { root_dir: root },
      required: [],
    },
  },
  {
    name: "reindex_paths",
    description:
      "Incrementally index explicit paths, directories, or globs into shared code/document semantic partitions.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Paths or glob patterns; defaults to **/*.",
        },
        root_dir: root,
        max_files: {
          type: "number",
          description: "Maximum matched files (default 2000, maximum 10000).",
        },
      },
      required: [],
    },
  },
] as const;
