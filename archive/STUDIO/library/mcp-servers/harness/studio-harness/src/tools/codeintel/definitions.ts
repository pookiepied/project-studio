/** Tool schema definition for the structural-outline primitive. */
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
] as const;
