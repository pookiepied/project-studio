/**
 * Text merging utilities with overlap detection
 * Uses sentence-level similarity to merge transcription chunks
 */

/**
 * Calculate similarity between two strings using Levenshtein distance
 * Returns a value between 0 (completely different) and 1 (identical)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Levenshtein distance algorithm
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Normalize text for comparison
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // Remove punctuation
    .replace(/\s+/g, " ")    // Normalize whitespace
    .trim();
}

/**
 * Split text into sentences
 */
function splitSentences(text: string): string[] {
  return text
    .split(/([.!?]+\s+)/)
    .filter((s) => s.trim().length > 0)
    .reduce((acc: string[], curr, i, arr) => {
      if (i % 2 === 0) {
        const sentence = curr + (arr[i + 1] || "");
        if (sentence.trim().length > 0) {
          acc.push(sentence.trim());
        }
      }
      return acc;
    }, []);
}

/**
 * Find overlapping sentences between two text chunks
 */
function findOverlap(chunk1: string, chunk2: string, threshold: number = 0.8): number {
  const sentences1 = splitSentences(chunk1);
  const sentences2 = splitSentences(chunk2);
  
  if (sentences1.length === 0 || sentences2.length === 0) return 0;
  
  // Check last sentences of chunk1 against first sentences of chunk2
  const maxCheck = Math.min(3, sentences1.length, sentences2.length);
  
  for (let overlapSize = maxCheck; overlapSize > 0; overlapSize--) {
    const end1 = sentences1.slice(-overlapSize);
    const start2 = sentences2.slice(0, overlapSize);
    
    // Calculate average similarity
    let totalSimilarity = 0;
    for (let i = 0; i < overlapSize; i++) {
      const norm1 = normalizeText(end1[i]);
      const norm2 = normalizeText(start2[i]);
      totalSimilarity += calculateSimilarity(norm1, norm2);
    }
    
    const avgSimilarity = totalSimilarity / overlapSize;
    
    if (avgSimilarity >= threshold) {
      return overlapSize;
    }
  }
  
  return 0;
}

/**
 * Merge two text chunks by removing overlapping sentences
 */
export function mergeChunks(chunk1: string, chunk2: string, threshold: number = 0.8): string {
  if (!chunk1) return chunk2;
  if (!chunk2) return chunk1;
  
  const sentences1 = splitSentences(chunk1);
  const sentences2 = splitSentences(chunk2);
  
  const overlapSize = findOverlap(chunk1, chunk2, threshold);
  
  if (overlapSize > 0) {
    // Remove overlapping sentences from chunk2
    const uniqueSentences2 = sentences2.slice(overlapSize);
    return sentences1.join(" ") + " " + uniqueSentences2.join(" ");
  }
  
  // No overlap found, concatenate with space
  return chunk1 + " " + chunk2;
}

/**
 * Merge multiple transcription chunks in order
 */
export function mergeTranscriptions(chunks: string[], threshold: number = 0.8): string {
  if (chunks.length === 0) return "";
  if (chunks.length === 1) return chunks[0];
  
  let merged = chunks[0];
  
  for (let i = 1; i < chunks.length; i++) {
    merged = mergeChunks(merged, chunks[i], threshold);
  }
  
  return merged.trim();
}

/**
 * Remove duplicate sentences from text
 */
export function removeDuplicates(text: string, threshold: number = 0.9): string {
  const sentences = splitSentences(text);
  const unique: string[] = [];
  
  for (const sentence of sentences) {
    const normalized = normalizeText(sentence);
    
    // Check if this sentence is similar to any already added
    const isDuplicate = unique.some((existing) => {
      const normalizedExisting = normalizeText(existing);
      return calculateSimilarity(normalized, normalizedExisting) >= threshold;
    });
    
    if (!isDuplicate) {
      unique.push(sentence);
    }
  }
  
  return unique.join(" ");
}

/**
 * Clean and organize transcribed text
 */
export function cleanTranscription(text: string): string {
  if (!text) return "";
  
  // Remove filler words
  let cleaned = text.replace(/\b(um|uh|like|you know|sort of|kind of)\b/gi, "");
  
  // Remove excessive whitespace
  cleaned = cleaned.replace(/\s+/g, " ");
  
  // Fix spacing around punctuation
  cleaned = cleaned.replace(/\s+([.,!?;:])/g, "$1");
  cleaned = cleaned.replace(/([.,!?;:])\s*/g, "$1 ");
  
  // Capitalize first letter of sentences
  cleaned = cleaned.replace(/(^|[.!?]\s+)([a-z])/g, (_match, p1, p2) => {
    return p1 + p2.toUpperCase();
  });
  
  return cleaned.trim();
}

/**
 * Full text merging pipeline
 */
export function processTranscriptionChunks(chunks: string[]): string {
  // Step 1: Merge chunks with overlap detection
  const merged = mergeTranscriptions(chunks, 0.8);
  
  // Step 2: Remove duplicates
  const deduplicated = removeDuplicates(merged, 0.9);
  
  // Step 3: Clean and organize
  const cleaned = cleanTranscription(deduplicated);
  
  return cleaned;
}

/**
 * Interface for transcription chunk with metadata
 */
export interface TranscriptionChunk {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

/**
 * Merge transcription chunks with metadata
 */
export function mergeTranscriptionChunks(chunks: TranscriptionChunk[]): string {
  // Sort by start time
  const sorted = [...chunks].sort((a, b) => a.startTime - b.startTime);
  
  // Extract text
  const texts = sorted.map((chunk) => chunk.text);
  
  // Process and merge
  return processTranscriptionChunks(texts);
}
