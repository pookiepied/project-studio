/**
 * Parse and clean AI responses to remove unwanted fluff
 */

/**
 * Common AI fluff patterns to remove
 */
const FLUFF_PATTERNS = [
  // Introductions
  /^(here is|here's|okay,?|sure,?|certainly,?|of course,?|absolutely,?)\s*/i,
  /^(i'll|i will|let me|i can|i'd be happy to)\s+\w+\s+(this|that|it|the text)\s*(for you)?[.:]\s*/i,
  
  // Meta-commentary
  /^(the refined text is|the rephrased version is|the text has been rephrased)[.:]\s*/i,
  /^(as requested|as you asked|based on your request)[,:]\s*/i,
  
  // Conclusions
  /(do you need|need any|anything else|can i help|may i assist).*$/i,
  /(let me know|feel free|don't hesitate).*$/i,
  /(hope this helps|i hope|hopefully).*$/i,
  /(is there anything|would you like).*$/i,
  
  // Quotes and formatting artifacts
  /^["'`]+|["'`]+$/g,
  /^\s*[-*]\s*/gm, // Remove bullet points at start of lines
];

/**
 * Clean AI response by removing common fluff patterns
 */
export function parseAIResponse(text: string): string {
  if (!text) return "";
  
  let cleaned = text.trim();
  
  // Apply all fluff removal patterns
  FLUFF_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, "");
  });
  
  // Remove extra whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  
  // Remove trailing punctuation artifacts
  cleaned = cleaned.replace(/[.,:;!?]+$/, (match) => {
    // Keep only one final punctuation mark
    return match[0];
  });
  
  return cleaned;
}

/**
 * Extract the main content from AI response
 * Handles cases where AI wraps content in quotes or adds extra formatting
 */
export function extractMainContent(text: string): string {
  if (!text) return "";
  
  let content = text.trim();
  
  // Check if content is wrapped in quotes
  const quoteMatch = content.match(/^["'`](.+)["'`]$/s);
  if (quoteMatch) {
    content = quoteMatch[1].trim();
  }
  
  // Check if content is in a code block
  const codeBlockMatch = content.match(/^```(?:\w+)?\s*\n(.+)\n```$/s);
  if (codeBlockMatch) {
    content = codeBlockMatch[1].trim();
  }
  
  return content;
}

/**
 * Full parsing pipeline: extract content, remove fluff, clean up
 */
export function cleanAIResponse(text: string): string {
  if (!text) return "";
  
  // Step 1: Extract main content
  let cleaned = extractMainContent(text);
  
  // Step 2: Remove fluff patterns
  cleaned = parseAIResponse(cleaned);
  
  // Step 3: Final cleanup
  cleaned = cleaned.trim();
  
  return cleaned;
}

/**
 * Validate that the response is not just fluff
 * Returns true if response contains actual content
 */
export function isValidResponse(text: string): boolean {
  if (!text || text.trim().length < 3) return false;
  
  const cleaned = cleanAIResponse(text);
  
  // Check if cleaned text has substance
  if (cleaned.length < 3) return false;
  
  // Check if it's not just punctuation
  if (/^[.,!?;:\s]+$/.test(cleaned)) return false;
  
  return true;
}

/**
 * Split response into sentences for better processing
 */
export function splitIntoSentences(text: string): string[] {
  if (!text) return [];
  
  // Split on sentence boundaries
  const sentences = text
    .split(/([.!?]+\s+)/)
    .filter((s) => s.trim().length > 0)
    .reduce((acc: string[], curr, i, arr) => {
      if (i % 2 === 0) {
        const sentence = curr + (arr[i + 1] || "");
        acc.push(sentence.trim());
      }
      return acc;
    }, []);
  
  return sentences;
}
