/**
 * services/ barrel — feature-level services that stay here until Phase 3.
 *
 * Infra services (storage, network, errors, logging, platform, notifications,
 * connection, skills) moved to @/core in Phase 2. The runtime glue moved to
 * @/runtime in Phase 1. What remains are feature-bound services: ai/* (chat,
 * models, composio), auth/*, conversations/*, extensions/*, files/*, inputs/*.
 */

export { aiService } from "./ai/aiService";
export type { APIChatMessage, ChatRequest, ChatResponse, TranscribeResponse } from "./ai/aiService";
