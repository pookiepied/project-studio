/**
 * Cross-Platform Service
 * Handles linking and transitions between Chat and Transcribe
 * Note: Canvas integration disabled - feature coming soon
 */

// import { ChatConversation } from '@/types'; // Not used - commented out to avoid lint error
// import { CanvasData } from '@/types/canvas'; // Disabled - canvas removed
import { UnifiedConversation } from '@/types/conversation';
import * as chatHistoryService from '../storage/chatHistoryService';
// import * as canvasService from '../canvas/canvasService'; // Disabled - canvas removed
import { errorService } from '../errors/errorService';

/**
 * Create a canvas from an existing chat conversation - DISABLED
 */
// Disabled - canvas feature removed
// export async function createCanvasFromChat(
//   conversationId: string,
//   _model: string
// ): Promise<CanvasData | null> {
//   try {
//     // Load the chat conversation
//     const conversation = await chatHistoryService.loadConversation(conversationId);
//     if (!conversation) {
//       throw new Error('Conversation not found');
//     }

//     // Create canvas with conversation title
//     const canvas = await canvasService.createCanvas(conversationId, conversation.title);
    
//     return canvas;
//   } catch (error) {
//     const categorizedError = errorService.categorize(error);
//     throw new Error(`Failed to create canvas from chat: ${categorizedError.userMessage}`);
//   }
// }

/**
 * Create a chat from canvas interaction - DISABLED
 */
// Disabled - canvas feature removed
// export async function createChatFromCanvas(
//   canvasId: string,
//   initialPrompt: string,
//   model: string
// ): Promise<ChatConversation | null> {
//   try {
//     // Extract conversation ID from canvas ID (format: canvas-{conversationId})
//     const conversationId = canvasId.replace('canvas-', '');
    
//     // Check if chat already exists
//     let conversation = await chatHistoryService.loadConversation(conversationId);
    
//     if (!conversation) {
//       // Create new conversation
//       conversation = await chatHistoryService.createConversation(initialPrompt, model);
//     }
    
//     return conversation;
//   } catch (error) {
//     const categorizedError = errorService.categorize(error);
//     throw new Error(`Failed to create chat from canvas: ${categorizedError.userMessage}`);
//   }
// }

/**
 * Transfer transcribed content to canvas - DISABLED
 */
// Disabled - canvas feature removed
// export async function transferTranscribeToCanvas(
//   transcribedText: string,
//   model: string
// ): Promise<{ conversation: ChatConversation; canvas: CanvasData } | null> {
//   try {
//     // Create new conversation with transcribed text as title and first message
//     const conversation = await chatHistoryService.createConversation(transcribedText, model);
    
//     // Add the transcribed text as the first user message
//     const userMessage = {
//       id: `msg-${Date.now()}`,
//       role: 'user' as const,
//       content: transcribedText,
//       timestamp: Date.now()
//     };
    
//     conversation.messages.push(userMessage);
//     await chatHistoryService.saveConversation(conversation);
    
//     // Create canvas from the transcribed content
//     const canvas = await canvasService.createCanvas(conversation.id, transcribedText);
    
//     return { conversation, canvas };
//   } catch (error) {
//     const categorizedError = errorService.categorize(error);
//     throw new Error(`Failed to transfer transcribe to canvas: ${categorizedError.userMessage}`);
//   }
// }

/**
 * Get unified conversation data (chat only - canvas disabled)
 */
export async function getUnifiedConversation(conversationId: string): Promise<UnifiedConversation | null> {
  try {
    const conversation = await chatHistoryService.loadConversation(conversationId);
    if (!conversation) return null;

    // Canvas disabled - only chat supported
    // const canvas = await canvasService.getCanvas(conversationId);
    
    // Determine conversation type - always chat since canvas is disabled
    const type = 'chat' as const;

    const unified: UnifiedConversation = {
      id: conversation.id,
      title: conversation.title,
      type,
      messages: conversation.messages.map(msg => ({
        ...msg,
        source: 'chat' as const
      })),
      // canvas: canvas || undefined, // Disabled
      linkedChatId: conversation.id,
      model: conversation.model,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastViewedAs: 'chat'
    };

    return unified;
  } catch (error) {
    const categorizedError = errorService.categorize(error);
    throw new Error(`Failed to get unified conversation: ${categorizedError.userMessage}`);
  }
}
