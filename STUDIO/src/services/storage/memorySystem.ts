/**
 * Advanced Memory System for STUDIO
 * Implements time-based, event-based, and personal-based memory
 */

import { unifiedStorage } from "./unifiedStorageService";
import { ChatMessage, ChatConversation } from "../../types";
import { logger } from "../logging/logger";

// Memory Types
export interface MemoryEntry {
  id: string;
  type: "short-term" | "mid-term" | "long-term";
  category: "personal" | "event" | "preference" | "fact" | "conversation";
  content: string;
  context: string;
  importance: number; // 1-10 scale
  timestamp: number;
  lastAccessed: number;
  accessCount: number;
  tags: string[];
  conversationId?: string;
  relatedEntries?: string[]; // IDs of related memories
}

export interface PersonalProfile {
  preferences: Record<string, any>;
  habits: string[];
  interests: string[];
  communication_style: string;
  expertise_areas: string[];
  goals: string[];
  personality_traits: string[];
  last_updated: number;
}

export interface ConversationMemory {
  conversationId: string;
  isShared: boolean; // Can other conversations access this memory?
  summary: string;
  key_topics: string[];
  important_decisions: string[];
  unresolved_questions: string[];
  created: number;
  updated: number;
}

class MemorySystem {
  private memories: Map<string, MemoryEntry> = new Map();
  private profile: PersonalProfile | null = null;
  private conversationMemories: Map<string, ConversationMemory> = new Map();
  private initialized = false;

  /**
   * Initialize the memory system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load existing memories
      const memoriesData = await unifiedStorage.readJSON<MemoryEntry[]>("memory/entries.json");
      if (memoriesData && Array.isArray(memoriesData)) {
        memoriesData.forEach(entry => {
          if (entry && entry.id && entry.content) {
            this.memories.set(entry.id, entry);
          }
        });
      }

      // Load personal profile
      this.profile = await unifiedStorage.readJSON<PersonalProfile>("memory/profile.json");
      if (!this.profile) {
        this.profile = this.createDefaultProfile();
        await this.saveProfile();
      }

      // Load conversation memories
      const convMemories = await unifiedStorage.readJSON<ConversationMemory[]>("memory/conversations.json");
      if (convMemories && Array.isArray(convMemories)) {
        convMemories.forEach(mem => {
          if (mem && mem.conversationId) {
            this.conversationMemories.set(mem.conversationId, mem);
          }
        });
      }

      this.initialized = true;
      logger.info('Memory', `Initialized with ${this.memories.size} memories`);
    } catch (error) {
      logger.error('Memory', 'Failed to initialize', error);
      // Initialize with empty state but mark as initialized
      this.profile = this.createDefaultProfile();
      this.initialized = true;
    }
  }

  /**
   * Add a new memory entry
   */
  async addMemory(
    content: string,
    type: MemoryEntry["type"],
    category: MemoryEntry["category"],
    context: string,
    importance: number = 5,
    conversationId?: string,
    tags: string[] = []
  ): Promise<string> {
    const id = `mem-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    const entry: MemoryEntry = {
      id,
      type,
      category,
      content,
      context,
      importance,
      timestamp: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 0,
      tags,
      conversationId,
      relatedEntries: []
    };

    this.memories.set(id, entry);
    await this.saveMemories();
    
    logger.debug('Memory', `Added ${type} ${category} memory: ${content.substring(0, 50)}...`);
    return id;
  }

  /**
   * Retrieve relevant memories based on query
   */
  async retrieveMemories(
    query: string,
    conversationId?: string,
    limit: number = 10
  ): Promise<MemoryEntry[]> {
    const queryLower = query.toLowerCase();
    const relevantMemories: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const entry of this.memories.values()) {
      let score = 0;

      // Content relevance
      if (entry.content.toLowerCase().includes(queryLower)) score += 10;
      if (entry.context.toLowerCase().includes(queryLower)) score += 5;
      
      // Tag relevance
      entry.tags.forEach(tag => {
        if (tag.toLowerCase().includes(queryLower)) score += 8;
      });

      // Importance weight
      score += entry.importance;

      // Recency weight (more recent = higher score)
      const daysSince = (Date.now() - entry.timestamp) / (1000 * 60 * 60 * 24);
      score += Math.max(0, 10 - daysSince);

      // Access frequency weight
      score += Math.min(entry.accessCount, 5);

      // Conversation context bonus
      if (conversationId && entry.conversationId === conversationId) {
        score += 15;
      }

      // Shared memory bonus
      const convMem = this.conversationMemories.get(entry.conversationId || "");
      if (convMem?.isShared) {
        score += 5;
      }

      if (score > 5) { // Minimum relevance threshold
        relevantMemories.push({ entry, score });
      }
    }

    // Sort by score and return top results
    const results = relevantMemories
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => {
        // Update access tracking
        item.entry.lastAccessed = Date.now();
        item.entry.accessCount++;
        return item.entry;
      });

    if (results.length > 0) {
      await this.saveMemories(); // Save updated access tracking
    }

    return results;
  }

  /**
   * Process conversation for memory extraction
   */
  async processConversation(conversation: ChatConversation): Promise<void> {
    const messages = conversation.messages;
    if (messages.length < 2) return; // Need at least user + assistant

    // Extract personal information
    await this.extractPersonalInfo(messages);
    
    // Extract events and facts
    await this.extractEvents(messages, conversation.id);
    
    // Update conversation memory
    await this.updateConversationMemory(conversation);
  }

  /**
   * Extract personal information from messages
   */
  private async extractPersonalInfo(messages: ChatMessage[]): Promise<void> {
    // This would use AI to extract personal info
    // For now, simple keyword detection
    const userMessages = messages.filter(m => m.role === "user");
    
    for (const message of userMessages) {
      const content = message.content.toLowerCase();
      
      // Detect preferences
      if (content.includes("i prefer") || content.includes("i like")) {
        await this.addMemory(
          message.content,
          "long-term",
          "preference",
          "User stated preference",
          7,
          undefined,
          ["preference", "personal"]
        );
      }
      
      // Detect personal facts
      if (content.includes("i am") || content.includes("my name is")) {
        await this.addMemory(
          message.content,
          "long-term",
          "personal",
          "Personal information",
          9,
          undefined,
          ["personal", "identity"]
        );
      }
    }
  }

  /**
   * Extract events from messages
   */
  private async extractEvents(messages: ChatMessage[], conversationId: string): Promise<void> {
    // Simple event detection - would be enhanced with AI
    const userMessages = messages.filter(m => m.role === "user");
    
    for (const message of userMessages) {
      const content = message.content.toLowerCase();
      
      // Date/time patterns
      const datePatterns = [
        /yesterday|today|tomorrow/,
        /\d{1,2}\/\d{1,2}\/\d{4}/,
        /january|february|march|april|may|june|july|august|september|october|november|december/
      ];
      
      if (datePatterns.some(pattern => pattern.test(content))) {
        await this.addMemory(
          message.content,
          "mid-term",
          "event",
          "Time-referenced event",
          6,
          conversationId,
          ["event", "temporal"]
        );
      }
    }
  }

  /**
   * Update conversation memory
   */
  private async updateConversationMemory(conversation: ChatConversation): Promise<void> {
    const existing = this.conversationMemories.get(conversation.id);
    
    // Generate summary (simplified - would use AI)
    const summary = this.generateConversationSummary(conversation);
    
    const convMemory: ConversationMemory = {
      conversationId: conversation.id,
      isShared: existing?.isShared || false,
      summary,
      key_topics: this.extractTopics(conversation),
      important_decisions: [],
      unresolved_questions: [],
      created: existing?.created || conversation.createdAt,
      updated: Date.now()
    };

    this.conversationMemories.set(conversation.id, convMemory);
    await this.saveConversationMemories();
  }

  /**
   * Generate conversation summary
   */
  private generateConversationSummary(conversation: ChatConversation): string {
    // Simplified summary generation
    const messageCount = conversation.messages.length;
    const firstMessage = conversation.messages[0]?.content.substring(0, 100) || "";
    
    return `Conversation with ${messageCount} messages. Started with: "${firstMessage}..."`;
  }

  /**
   * Extract topics from conversation
   */
  private extractTopics(conversation: ChatConversation): string[] {
    // Simple keyword extraction - would be enhanced with AI
    const allText = conversation.messages
      .map(m => m.content)
      .join(" ")
      .toLowerCase();
    
    const commonTopics = [
      "programming", "ai", "machine learning", "web development",
      "python", "javascript", "react", "nodejs", "database",
      "design", "business", "marketing", "finance", "health"
    ];
    
    return commonTopics.filter(topic => allText.includes(topic));
  }

  /**
   * Set conversation as shared memory
   */
  async setConversationShared(conversationId: string, isShared: boolean): Promise<void> {
    const existing = this.conversationMemories.get(conversationId);
    if (existing) {
      existing.isShared = isShared;
      existing.updated = Date.now();
      await this.saveConversationMemories();
    }
  }

  /**
   * Get memory context for AI
   */
  async getMemoryContext(query: string, conversationId?: string): Promise<string> {
    const memories = await this.retrieveMemories(query, conversationId, 5);
    
    if (memories.length === 0) return "";
    
    const context = memories.map(mem => {
      const timeAgo = this.formatTimeAgo(mem.timestamp);
      return `[${mem.category.toUpperCase()}] ${mem.content} (${timeAgo})`;
    }).join("\n");
    
    return `\n--- RELEVANT MEMORIES ---\n${context}\n--- END MEMORIES ---\n`;
  }

  /**
   * Format time ago
   */
  private formatTimeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return `${Math.floor(days / 30)} months ago`;
  }

  /**
   * Create default profile
   */
  private createDefaultProfile(): PersonalProfile {
    return {
      preferences: {},
      habits: [],
      interests: [],
      communication_style: "friendly",
      expertise_areas: [],
      goals: [],
      personality_traits: [],
      last_updated: Date.now()
    };
  }

  /**
   * Save memories to storage
   */
  private async saveMemories(): Promise<void> {
    const entries = Array.from(this.memories.values());
    await unifiedStorage.writeJSON("memory/entries.json", entries);
  }

  /**
   * Save profile to storage
   */
  private async saveProfile(): Promise<void> {
    if (this.profile) {
      await unifiedStorage.writeJSON("memory/profile.json", this.profile);
    }
  }

  /**
   * Save conversation memories
   */
  private async saveConversationMemories(): Promise<void> {
    const entries = Array.from(this.conversationMemories.values());
    await unifiedStorage.writeJSON("memory/conversations.json", entries);
  }

  /**
   * Clean up old memories (garbage collection)
   */
  async cleanupMemories(): Promise<void> {
    const now = Date.now();
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    
    let removedCount = 0;
    
    for (const [id, entry] of this.memories.entries()) {
      // Remove old, low-importance, rarely accessed memories
      const age = now - entry.timestamp;
      const shouldRemove = (
        age > oneYear && 
        entry.importance < 5 && 
        entry.accessCount < 3 &&
        entry.type === "short-term"
      );
      
      if (shouldRemove) {
        this.memories.delete(id);
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      await this.saveMemories();
      logger.debug('Memory', `Cleaned up ${removedCount} old memories`);
    }
  }
}

// Export singleton instance
export const memorySystem = new MemorySystem();