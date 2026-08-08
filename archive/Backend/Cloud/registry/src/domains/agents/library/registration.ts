import { systemOwner } from "../../../system/ownership";
import type { AgentDefinition, AgentRegistration } from "../types";

export function toSystemAgentRegistration(definition: AgentDefinition): AgentRegistration {
  const owner = systemOwner();
  return {
    ...owner,
    id: definition.id,
    name: definition.name,
    slug: definition.slug,
    description: definition.description,
    origin: "studio",
    status: definition.status,
    version: definition.version,
    runtimeType: definition.runtimeType,
    definitionRef: definition.definitionRef,
    capabilitySummary: {
      mcpServers: definition.access.mcpServers,
      skills: definition.access.skills,
      nativeTools: definition.access.nativeTools,
      memoryScopes: definition.access.memoryScopes,
    },
    scheduleEnabled: definition.scheduling.enabled,
    metadata: {
      ...definition.metadata,
      outputFormat: definition.io.outputFormat,
    },
    createdAt: "",
    updatedAt: "",
  };
}
