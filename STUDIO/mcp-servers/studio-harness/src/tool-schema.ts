type Definition = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties?: Record<string, any>; required?: readonly string[]; [key: string]: unknown };
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

const READ_ONLY = /^(read_|search_|semantic_|find_|retrieve_|explain_|navigate_|inspect_|parse_|query_|extract_|calculate_|detect_|diagnostics$|index_status|file_metadata|content_hash|glob|grep|ls|outline_|analyze_file|list_processes|command_exists|git_(status|diff|log|show|blame|reflog)|lsp$)/;
const DESTRUCTIVE = /^(write_file|edit_file|multi_edit|delete_file|move_file|structural_replace|rename_symbol|code_actions|format_code|start_process|stop_process|write_process_input|git_(commit|branch|push|pull|reset|restore|rm|mv|merge|rebase|cherry_pick|revert|clean|init|add|stash|worktree|tag|remote|clone|config)|bash|powershell|repl|ssh_)/;
const OPEN_WORLD = /^(bash|powershell|repl|ssh_|start_process|git_(push|pull|fetch|clone)|ask_user_question)/;

function title(name: string): string {
  return name.split("_").map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(" ");
}

export function finalizeToolDefinitions<const T extends readonly Definition[]>(definitions: T): T {
  const names = new Set<string>();
  for (const tool of definitions) {
    if (names.has(tool.name)) throw new Error(`Duplicate tool definition: ${tool.name}`);
    names.add(tool.name);
    if (!tool.description?.trim()) throw new Error(`${tool.name}: description is required`);
    if (tool.inputSchema?.type !== "object") throw new Error(`${tool.name}: inputSchema.type must be object`);
    const properties = tool.inputSchema.properties ?? {};
    for (const required of tool.inputSchema.required ?? []) if (!(required in properties)) throw new Error(`${tool.name}: required property '${required}' is not declared`);
    validateProperties(tool.name, properties);
    const readOnly = READ_ONLY.test(tool.name);
    tool.annotations ??= {
      title: title(tool.name), readOnlyHint: readOnly, destructiveHint: DESTRUCTIVE.test(tool.name),
      idempotentHint: readOnly || /^(write_file|reindex_paths|git_(fetch|status)|content_hash|file_metadata|detect_binary)$/.test(tool.name),
      openWorldHint: OPEN_WORLD.test(tool.name),
    };
    tool.outputSchema ??= { type: "object", description: "Structured result. Failures contain an error string; bounded operations report truncation or limits where applicable.", additionalProperties: true };
  }
  return definitions;
}

function validateProperties(path: string, properties: Record<string, any>): void {
  for (const [property, schema] of Object.entries(properties)) {
    const next = `${path}.${property}`;
    if (!schema.description?.trim()) throw new Error(`${next}: description is required`);
    if (schema.properties) validateProperties(next, schema.properties);
    if (schema.items?.properties) validateProperties(`${next}[]`, schema.items.properties);
  }
}
