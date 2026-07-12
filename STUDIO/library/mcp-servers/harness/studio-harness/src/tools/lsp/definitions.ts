export const LSP_TOOL_DEFINITION = {
  name: "lsp",
  description:
    "Language Server Protocol code intelligence. Navigate and understand code without reading entire files. " +
    "Use this instead of grep/read_file when you need to find symbol definitions, all usages, type info, or the full symbol tree of a file.\n\n" +
    "Operations:\n" +
    "  goToDefinition - find where a symbol is defined (provide file, line, character)\n" +
    "  findReferences - find all usages of a symbol across the project\n" +
    "  hover - get type info and documentation for a symbol\n" +
    "  documentSymbol - list all functions/classes/variables in a file\n" +
    "  workspaceSymbol - search for a symbol by name across the entire project\n" +
    "  goToImplementation - find concrete implementations of an interface or abstract method\n" +
    "  incomingCalls - who calls this function?\n" +
    "  outgoingCalls - what does this function call?\n\n" +
    "Requires language server installed: TypeScript -> `npm install -g typescript typescript-language-server`, " +
    "Python -> `pip install python-lsp-server`, Rust -> rust-analyzer, Go -> gopls.",
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: [
          "goToDefinition",
          "findReferences",
          "hover",
          "documentSymbol",
          "workspaceSymbol",
          "goToImplementation",
          "incomingCalls",
          "outgoingCalls",
        ],
        description: "The LSP operation to perform",
      },
      filePath: {
        type: "string",
        description: "Absolute or relative path to the file (required for all operations except workspaceSymbol)",
      },
      line: {
        type: "number",
        description: "Line number (1-based, as shown in editors) - required for positional operations",
      },
      character: {
        type: "number",
        description: "Character offset (1-based, as shown in editors) - required for positional operations",
      },
      query: {
        type: "string",
        description: "Symbol name to search for - required for workspaceSymbol",
      },
      workspaceRoot: {
        type: "string",
        description: "Root directory of the project (optional - auto-detected from filePath if omitted)",
      },
      includeDeclaration: {
        type: "boolean",
        description: "Include the declaration site in findReferences results (default: true)",
      },
    },
    required: ["operation"],
  },
} as const;
