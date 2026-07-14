import type { McpServerRecord } from "../types";

export const systemMcpServerRegistrations: McpServerRecord[] = [];

export function listSystemMcpServerRegistrations(): McpServerRecord[] {
  return systemMcpServerRegistrations;
}
