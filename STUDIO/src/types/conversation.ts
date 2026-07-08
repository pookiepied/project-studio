/**
 * Unified Conversation Type Definitions
 * Connects Chat and Canvas as two views of the same data
 * Note: Canvas support disabled - feature coming soon
 */

// All canvas imports removed - canvas feature disabled

export interface UnifiedConversation {
  id: string;
  title: string;
  type: 'chat'; // Only chat supported - canvas disabled
  
  // Chat data
  messages: ConversationMessage[];
  
  // Canvas data (disabled)
  // canvas?: CanvasData; // Disabled - feature coming soon
  
  // Cross-platform linking
  // linkedCanvasId?: string; // Disabled
  linkedChatId?: string; // Chat ID if this canvas has a chat
  
  // Metadata
  model: string;
  createdAt: number;
  updatedAt: number;
  lastViewedAs: 'chat'; // Only chat view supported
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  
  // Source tracking
  source: 'chat' | 'canvas' | 'voice' | 'transcribe'; // Where was this created?
  // canvasAction?: CanvasAction; // Disabled - if from canvas, what action?
  
}

// For migration from existing chat format
export interface LegacyChatConversation {
  id: string;
  title: string;
  model: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }>;
  createdAt: number;
  updatedAt: number;
}
