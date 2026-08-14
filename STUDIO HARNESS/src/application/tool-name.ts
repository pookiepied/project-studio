/** Stable model-facing names that cannot collide across MCP identity parts. */
export function modelToolName(namespace: string, name: string): string {
  if (namespace === "native") return name;
  const encode = (value: string): string => `${value.length}_${value}`;
  return `mcp__${encode(namespace.slice("mcp:".length))}__${encode(name)}`;
}
