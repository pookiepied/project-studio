import type { McpServerDefinition } from "./types";

export const systemMcpServerDefinitions: McpServerDefinition[] = [];

export function listSystemMcpServerDefinitions(): McpServerDefinition[] {
  return systemMcpServerDefinitions;
}
