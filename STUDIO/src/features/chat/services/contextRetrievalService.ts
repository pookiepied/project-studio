/**
 * Context Retrieval Service
 * Handles @chat mentions and context retrieval with vector search fallback
 * Note: Canvas support disabled - feature coming soon
 */

import { ChatConversation } from '@/types';
// import { CanvasData } from '../../types/canvas'; // Disabled - canvas removed
import * as chatHistoryService from '@/services/storage/chatHistoryService';
// import * as canvasService from '../canvas/canvasService'; // Disabled - canvas removed
import { errorService } from '@/services/errors/errorService';

export interface ContextReference {
  type: 'chat'; // Only chat supported - canvas disabled
  id: string;
  title: string;
  preview: string;
}

export interface RetrievedContext {
  reference: ContextReference;
  content: string;
  relevanceScore?: number;
  isFullContent: boolean; // true if full content, false if vector-searched excerpt
}

/**
 * Parse @mentions from user input
 * Supports: @canvas, @canvas[id], @chat[id]
 */
export function parseMentions(content: string): {
  mentions: Array<{ type: 'chat'; id?: string; match: string }>;
  cleanContent: string;
} {
  const mentionRegex = /@(chat)(?:\[([^\]]+)\])?/g; // Canvas mentions disabled
  const mentions: Array<{ type: 'chat'; id?: string; match: string }> = [];
  
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push({
      type: match[1] as 'chat',
      id: match[2],
      match: match[0]
    });
  }
  
  // Remove mentions from content
  const cleanContent = content.replace(mentionRegex, '').trim();
  
  return { mentions, cleanContent };
}

/**
 * Get available contexts for autocomplete
 */
export async function getAvailableContexts(): Promise<ContextReference[]> {
  try {
    const contexts: ContextReference[] = [];
    
    // Get all conversations
    const conversations = await chatHistoryService.getAllConversations();
    for (const conv of conversations) {
      contexts.push({
        type: 'chat',
        id: conv.id,
        title: conv.title,
        preview: `${conv.messageCount} messages - ${new Date(conv.updatedAt).toLocaleDateString()}`
      });
    }
    
    // Canvas support disabled - feature coming soon
    // const canvases = await canvasService.getAllCanvases();
    // for (const canvas of canvases) {
    //   contexts.push({
    //     type: 'canvas',
    //     id: canvas.conversationId,
    //     title: canvas.nodes[0]?.content.substring(0, 50) || 'Untitled Canvas',
    //     preview: `${canvas.nodes.length} nodes - ...`
    //   });
    // }
    
    // Sort by most recent (based on ID which contains timestamp)
    return contexts.sort((a, b) => b.id.localeCompare(a.id));
  } catch (error) {
    const categorizedError = errorService.categorize(error);
    throw new Error(`Failed to load contexts: ${categorizedError.userMessage}`);
  }
}

/**
 * Retrieve context content for mentions
 */
export async function retrieveContexts(
  mentions: Array<{ type: 'canvas' | 'chat'; id?: string; match: string }>,
  query?: string
): Promise<RetrievedContext[]> {
  const results: RetrievedContext[] = [];
  
  for (const mention of mentions) {
    try {
      // Canvas mentions disabled - only chat supported
      if (mention.type === 'chat') {
        const context = await retrieveChatContext(mention.id, query);
        if (context) results.push(context);
      }
      // Canvas support disabled - feature coming soon
    } catch (error) {
      const categorizedError = errorService.categorize(error);
      // Continue with other mentions even if one fails
      results.push({
        reference: {
          type: 'chat', // Only chat supported
          id: mention.id || 'unknown',
          title: 'Error',
          preview: categorizedError.userMessage
        },
        content: `Error retrieving context: ${categorizedError.userMessage}`,
        isFullContent: false
      });
    }
  }
  
  return results;
}

/**
 * Retrieve canvas context - DISABLED
 * Canvas support coming soon
 */
// Disabled - not used
// async function retrieveCanvasContext(_canvasId?: string, _query?: string): Promise<RetrievedContext | null> {
//   // Canvas feature disabled - returning null
//   return null;
// }

/**
 * Retrieve chat context
 */
async function retrieveChatContext(
  chatId?: string,
  query?: string
): Promise<RetrievedContext | null> {
  if (!chatId) {
    // If no specific chat ID, get the most recent one
    const conversations = await chatHistoryService.getAllConversations();
    if (conversations.length === 0) return null;
    
    chatId = conversations[0].id;
  }
  
  const conversation = await chatHistoryService.loadConversation(chatId);
  if (!conversation) return null;
  
  const reference: ContextReference = {
    type: 'chat',
    id: chatId,
    title: conversation.title,
    preview: `${conversation.messages.length} messages`
  };
  
  // If no query, return recent messages
  if (!query) {
    const content = formatChatContent(conversation);
    return {
      reference,
      content,
      isFullContent: false // Always summarized for chats
    };
  }
  
  // Use simple text search for now
  const relevantContent = searchChatContent(conversation, query);
  
  return {
    reference,
    content: relevantContent.content,
    relevanceScore: relevantContent.score,
    isFullContent: false
  };
}

/**
 * Format canvas content for context - DISABLED
 */
// Disabled - not used
// function formatCanvasContent(_canvas: any): string {
//   // Canvas feature disabled
//   return 'Canvas feature coming soon';
// }

/**
 * Format chat content for context (recent messages)
 */
function formatChatContent(conversation: ChatConversation, maxMessages: number = 6): string {
  const recentMessages = conversation.messages.slice(-maxMessages);
  const messageTexts = recentMessages.map(msg => 
    `${msg.role}: ${msg.content.substring(0, 150)}${msg.content.length > 150 ? '...' : ''}`
  ).join('\n\n');
  
  return `Referenced Chat: "${conversation.title}"

Recent conversation (${recentMessages.length} messages):
${messageTexts}

Last updated: ${new Date(conversation.updatedAt).toLocaleDateString()}`;
}

/**
 * Simple text search in canvas content - DISABLED
 */
// Disabled - not used
// function searchCanvasContent(_canvas: any, _query: string): { content: string; score: number } {
//   // Canvas feature disabled
//   return { content: 'Canvas feature coming soon', score: 0 };
// }

/**
 * Simple text search in chat content
 */
function searchChatContent(conversation: ChatConversation, query: string): { content: string; score: number } {
  const queryLower = query.toLowerCase();
  const relevantMessages = conversation.messages.filter(msg => 
    msg.content.toLowerCase().includes(queryLower)
  );
  
  if (relevantMessages.length === 0) {
    // No direct matches, return recent messages with low score
    return {
      content: formatChatContent(conversation),
      score: 0.1
    };
  }
  
  // Format relevant messages
  const content = `Chat: "${conversation.title}"
Relevant messages for "${query}":
${relevantMessages.map(msg => `- ${msg.role}: ${msg.content}`).join('\n')}`;
  
  const score = Math.min(relevantMessages.length / conversation.messages.length, 0.9);
  
  return { content, score };
}

/**
 * Format retrieved contexts for LLM
 */
export function formatContextsForLLM(contexts: RetrievedContext[]): string {
  if (contexts.length === 0) return '';
  
  const formatted = contexts.map(ctx => {
    const header = `=== ${ctx.reference.type.toUpperCase()}: ${ctx.reference.title} ===`;
    const relevance = ctx.relevanceScore ? ` (relevance: ${Math.round(ctx.relevanceScore * 100)}%)` : '';
    const fullContentNote = ctx.isFullContent ? ' [Full Content]' : ' [Excerpt]';
    
    return `${header}${relevance}${fullContentNote}
${ctx.content}`;
  }).join('\n\n');
  
  return `\n\n--- REFERENCED CONTEXTS ---\n${formatted}\n--- END CONTEXTS ---\n`;
}