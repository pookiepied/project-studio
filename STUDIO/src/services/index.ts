export { aiService } from "./ai/aiService";
export type { APIChatMessage, ChatRequest, ChatResponse, TranscribeResponse } from "./ai/aiService";
export { configService } from "./storage/configService";

export { reportError, reportMessage, initErrorReporting, getStoredErrors, clearStoredErrors } from "./errors/errorReporting";
export { errorService } from "./errors/errorService";
export type { ErrorCategory, CategorizedError } from "./errors/errorService";
export { fetchModels, getModelsByType, getChatModels, getAudioModels, getModelById, clearModelsCache, isCacheValid, migrateModelId } from "./ai/modelService";
export type { Model, ModelsResponse } from "./ai/modelService";
export { NotificationService } from "./notifications";
export {
  createConversation,
  saveConversation,
  loadConversation,
  getAllConversations,
  deleteConversation,
  addMessage,
  updateConversationTitle,
  updateMessage,
  deleteMessage,
  regenerateLastResponse,
  exportConversation,
  importConversation,
  getConversationMessages,
  getContextMessages,
} from "./storage/chatHistoryService";

export { networkService } from "./network/networkService";
export type { NetworkStatus } from "./network/networkService";
