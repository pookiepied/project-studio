// LLM wire-format types — re-exported here so gateway-internal code
// can import from "../types" without reaching into chat/.
// Source of truth: chat/src/gateway/types.ts
export type {
  AgentMessage,
  ToolCall,
  TranscribeRequest,
  TranscribeResponse,
  Model,
  ModelsResponse,
  ProviderContract,
} from "../../../legacy/chat/src/server/types";
