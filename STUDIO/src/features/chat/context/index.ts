/**
 * Chat context public surface.
 *
 * Import from here rather than directly from ChatProvider or the sub-modules.
 *   import { ChatProvider, useChatContext, type TaskItem } from '../contexts/chat';
 */

export { ChatProvider, useChatContext, useChatContext as useChat } from "./ChatProvider";
export type { ChatContextType, TaskItem, TodoItem, ActiveToolCall, ToolDisplayClass } from "./types";
export { classifyToolDisplay }                                               from "./toolClassifier";
export {
  pruneContextByTokens,
  buildApiMessages,
  applyAllSystemMessages,
}                                                                            from "./messageBuilder";
export { SILENT_TOOLS, CAPSULE_NATIVE_TOOLS }                              from "./constants";
