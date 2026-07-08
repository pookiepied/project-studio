/**
 * Chat-specific response parser
 * Handles formatting, line breaks, and structure for chat messages
 */

/**
 * Parse chat response to preserve formatting and structure
 * Unlike rephrase parser, this maintains markdown, code blocks, and line breaks
 */
export function parseChatResponse(text: string): string {
  if (!text) return "";
  
  let parsed = text.trim();

  // Strip any residual thinking tags that weren't caught by the stream parser
  parsed = parsed.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  parsed = parsed.replace(/<think>[\s\S]*?<\/thinking>/gi, "").trim();
  // Strip unclosed opening tag (model stopped mid-think)
  parsed = parsed.replace(/<think>[\s\S]*/gi, "").trim();

  // Remove only meta-commentary that doesn't belong in chat
  // Keep natural conversational elements
  const metaPatterns = [
    /^(as an ai|i'm an ai|i am an ai).*$/im,
    /^(i don't have|i cannot|i can't)\s+(personal|real-time|access to).*$/im,
  ];
  
  metaPatterns.forEach((pattern) => {
    parsed = parsed.replace(pattern, "");
  });
  
  // Normalize line breaks (preserve intentional breaks)
  parsed = parsed.replace(/\n{3,}/g, "\n\n"); // Max 2 consecutive line breaks
  
  // Clean up excessive spaces but preserve intentional formatting
  parsed = parsed.replace(/ {3,}/g, "  "); // Max 2 consecutive spaces
  
  return parsed.trim();
}

/**
 * Format chat message for display
 * Handles code blocks, lists, and other markdown-like formatting
 */
export function formatChatMessage(text: string): string {
  if (!text) return "";
  
  let formatted = parseChatResponse(text);
  
  // Ensure proper spacing around code blocks
  formatted = formatted.replace(/```(\w+)?\n/g, "```$1\n");
  formatted = formatted.replace(/\n```/g, "\n```");
  
  return formatted;
}

/**
 * Validate chat response
 */
export function isValidChatResponse(text: string): boolean {
  if (!text || text.trim().length < 1) return false;
  
  const cleaned = parseChatResponse(text);
  
  // Check if cleaned text has substance
  if (cleaned.length < 1) return false;
  
  return true;
}

/**
 * Extract code blocks from chat response
 */
export function extractCodeBlocks(text: string): Array<{ language: string; code: string }> {
  const codeBlocks: Array<{ language: string; code: string }> = [];
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    codeBlocks.push({
      language: match[1] || "text",
      code: match[2].trim(),
    });
  }
  
  return codeBlocks;
}
