/**
 * Splits chat markdown into speakable chunks for TTS.
 *
 * Two responsibilities, same as ChatGPT's read-aloud behavior:
 *  1. Skip content that shouldn't be read verbatim — fenced code blocks and
 *     markdown tables are dropped entirely rather than spoken character by
 *     character.
 *  2. Chunk the remaining prose sentence-by-sentence (merged up to
 *     `maxChunkChars`) so long messages can be synthesized and played back
 *     incrementally instead of as one long blocking request.
 */

const CODE_FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`([^`]+)`/g;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HEADING_RE = /^#{1,6}\s+/gm;
const EMPHASIS_RE = /(\*\*|__|\*|_)(.*?)\1/g;

function stripNonSpeakable(markdown: string): string {
  let text = markdown.replace(CODE_FENCE_RE, '\n');

  text = text
    .split('\n')
    .filter((line) => !TABLE_ROW_RE.test(line) && !TABLE_SEPARATOR_RE.test(line))
    .join('\n');

  text = text
    .replace(HEADING_RE, '')
    .replace(INLINE_CODE_RE, '$1')
    .replace(EMPHASIS_RE, '$2');

  return text.replace(/\n{2,}/g, '\n').trim();
}

/**
 * Split cleaned text into sentence-based chunks, each roughly
 * `maxChunkChars` long (sentences are never split mid-way).
 */
function splitIntoChunks(text: string, maxChunkChars: number): string[] {
  const sentenceMatches = text.match(/[^.!?\n]+[.!?]*(\s+|\n|$)/g) ?? [text];
  const chunks: string[] = [];
  let current = '';

  for (const raw of sentenceMatches) {
    const sentence = raw.trim();
    if (!sentence) continue;

    if (current && (current.length + sentence.length + 1) > maxChunkChars) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function chunkTextForSpeech(markdown: string, maxChunkChars = 280): string[] {
  const cleaned = stripNonSpeakable(markdown);
  if (!cleaned) return [];
  return splitIntoChunks(cleaned, maxChunkChars);
}
