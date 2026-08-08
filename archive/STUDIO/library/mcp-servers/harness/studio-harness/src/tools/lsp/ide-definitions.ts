const pathProp = {
    type: "string",
    description: "Source file containing the target position.",
  },
  root = {
    type: "string",
    description: "Workspace root; auto-detected when omitted.",
  },
  line = { type: "number", description: "1-based source line." },
  character = {
    type: "number",
    description: "1-based UTF-16 character offset.",
  },
  max = {
    type: "number",
    description: "Maximum returned results (default 100, maximum 1000).",
  };
const range = {
  start_line: { type: "number", description: "1-based range start line." },
  start_character: {
    type: "number",
    description: "1-based range start character.",
  },
  end_line: {
    type: "number",
    description: "1-based inclusive range end line.",
  },
  end_character: {
    type: "number",
    description: "1-based range end character.",
  },
};
export const IDE_DEFINITIONS = [
  {
    name: "navigate_symbol",
    description:
      "Resolve the definition, declaration, concrete implementation, or type definition at a source position through the language server.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: [
            "definition",
            "declaration",
            "implementation",
            "type_definition",
          ],
          description: "Navigation target (default definition).",
        },
        path: pathProp,
        line,
        character,
        workspace_root: root,
        max_results: max,
      },
      required: ["path", "line", "character"],
    },
  },
  {
    name: "find_symbol_relationships",
    description:
      "Find semantic references, incoming callers, or outgoing callees for the symbol at a source position.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["references", "incoming_calls", "outgoing_calls"],
          description: "Relationship kind (default references).",
        },
        path: pathProp,
        line,
        character,
        workspace_root: root,
        include_declaration: {
          type: "boolean",
          description:
            "Include the declaration in reference results (default true).",
        },
        max_results: max,
      },
      required: ["path", "line", "character"],
    },
  },
  {
    name: "inspect_symbol",
    description:
      "Retrieve hover documentation, signature help, inlay hints, or semantic-token classifications from the language server.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["hover", "signature_help", "inlay_hints", "semantic_tokens"],
          description: "Inspection kind (default hover).",
        },
        path: pathProp,
        line,
        character,
        ...range,
        workspace_root: root,
      },
      required: ["path"],
    },
  },
  {
    name: "diagnostics",
    description:
      "Return current structured compiler/language-server diagnostics accumulated for an opened source file and workspace session.",
    inputSchema: {
      type: "object",
      properties: {
        path: pathProp,
        workspace_root: root,
        severity: {
          type: "number",
          enum: [1, 2, 3, 4],
          description:
            "Optional LSP severity: 1 error, 2 warning, 3 information, 4 hint.",
        },
        max_results: {
          type: "number",
          description: "Maximum diagnostics (default 500, maximum 5000).",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "rename_symbol",
    description:
      "Prepare and preview a semantic workspace rename; apply only when explicitly requested and after validating expected file revisions.",
    inputSchema: {
      type: "object",
      properties: {
        path: pathProp,
        line,
        character,
        new_name: { type: "string", description: "New identifier name." },
        workspace_root: root,
        apply: {
          type: "boolean",
          description:
            "Apply edits after preview and revision validation (default false).",
        },
        expected_revisions: {
          type: "object",
          description:
            "Map of affected paths to revisions returned by read_file; required for stale-safe application.",
        },
      },
      required: ["path", "line", "character", "new_name"],
    },
  },
  {
    name: "code_actions",
    description:
      "List IDE quick fixes/refactors for a range, then preview or revision-safely apply a selected workspace edit by action_index.",
    inputSchema: {
      type: "object",
      properties: {
        path: pathProp,
        ...range,
        workspace_root: root,
        diagnostics: {
          type: "array",
          description: "Optional LSP diagnostics passed as action context.",
        },
        only: {
          type: "string",
          description:
            "Optional action-kind filter such as quickfix or source.organizeImports.",
        },
        action_index: {
          type: "number",
          description:
            "Index returned by a previous equivalent list request; omit to list actions.",
        },
        apply: {
          type: "boolean",
          description:
            "Apply the selected action's workspace edit (default false).",
        },
        expected_revisions: {
          type: "object",
          description: "Map of affected paths to expected revisions.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "format_code",
    description:
      "Preview or revision-safely apply language-aware document formatting, range formatting, or semantic import organization.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["document", "range", "organize_imports"],
          description: "Formatting operation (default document).",
        },
        path: pathProp,
        ...range,
        workspace_root: root,
        tab_size: {
          type: "number",
          description: "Formatting tab width (default 2).",
        },
        insert_spaces: {
          type: "boolean",
          description: "Use spaces instead of tabs (default true).",
        },
        apply: {
          type: "boolean",
          description:
            "Apply returned edits after revision validation (default false).",
        },
        expected_revision: {
          type: "object",
          description: "Expected revision returned by read_file for this file.",
        },
      },
      required: ["path"],
    },
  },
] as const;
