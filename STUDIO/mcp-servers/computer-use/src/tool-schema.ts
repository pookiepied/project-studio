type Definition = { name: string; description: string; inputSchema: { type: "object"; properties?: Record<string, any>; required?: readonly string[] }; outputSchema?: Record<string, unknown>; annotations?: Record<string, unknown> };
const READ_ONLY = /^(get_|list_|read_|screenshot_and_analyze|ocr_(file|url)|analyze_image|ping_host|check_port|dns_lookup|traceroute|skill_read_local)/;
const DESTRUCTIVE = /^(kill_|suspend_|run_elevated|close_window|click_|mouse_|double_click|drag_|type_text|press_hotkey|key_|set_|delete_|create_user|manage_|connect_wifi|disconnect_wifi|enable_adapter|disable_adapter|system_power_action|add_firewall_rule|remove_firewall_rule)/;
const OPEN_WORLD = /^(launch_app|run_elevated|ping_host|check_port|dns_lookup|traceroute|connect_wifi|ocr_url|screenshot_and_analyze|ssh_)/;
const title = (name: string) => name.split("_").map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(" ");
export function finalizeToolDefinitions<const T extends readonly Definition[]>(definitions: T): T {
  const names = new Set<string>();
  for (const tool of definitions) {
    if (names.has(tool.name)) throw new Error(`Duplicate tool definition: ${tool.name}`); names.add(tool.name);
    if (!tool.description?.trim()) throw new Error(`${tool.name}: description is required`);
    const properties = tool.inputSchema?.properties ?? {};
    for (const required of tool.inputSchema?.required ?? []) if (!(required in properties)) throw new Error(`${tool.name}: required property '${required}' is not declared`);
    validateProperties(tool.name, properties);
    const readOnly = READ_ONLY.test(tool.name) && !DESTRUCTIVE.test(tool.name);
    tool.annotations ??= { title: title(tool.name), readOnlyHint: readOnly, destructiveHint: DESTRUCTIVE.test(tool.name), idempotentHint: readOnly, openWorldHint: OPEN_WORLD.test(tool.name) };
    if (!/^(screenshot_and_analyze|analyze_image)$/.test(tool.name)) tool.outputSchema ??= { type: "object", description: "Structured result. Failures contain an error string; bounded operations report truncation or limits where applicable.", additionalProperties: true };
  }
  return definitions;
}
function validateProperties(path: string, properties: Record<string, any>): void {
  for (const [property, schema] of Object.entries(properties)) {
    const next = `${path}.${property}`; if (!schema.description?.trim()) throw new Error(`${next}: description is required`);
    if (schema.properties) validateProperties(next, schema.properties);
    if (schema.items?.properties) validateProperties(`${next}[]`, schema.items.properties);
  }
}
