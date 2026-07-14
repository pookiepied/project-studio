/**
 * Shared text-processing utilities for provider adapters.
 *
 * Kept separate from the adapter base class so they can be tested and
 * imported independently without pulling in the full adapter hierarchy.
 */

// ---------------------------------------------------------------------------
// Tokenizer artefact removal
// ---------------------------------------------------------------------------

/**
 * Strip tokenizer artefacts that occasionally leak into model output.
 *
 * Patterns stripped:
 *   <｜begin▁of▁sentence｜>  — DeepSeek / Llama fullwidth-pipe tokens (U+FF5C)
 *   <|begin_of_text|>        — ChatML / Llama-3 angle-pipe tokens
 *   ▁                        — SentencePiece leading-space marker (U+2581)
 *
 * Use for COMPLETE messages (non-streaming responses) where trimming
 * leading/trailing whitespace is safe.
 *
 * For STREAMING delta chunks use cleanStreamChunk() — it preserves
 * whitespace because a chunk like " hello" carries a real word boundary.
 */
export function cleanModelTokens(content: string | null): string | null {
  if (!content) return null;
  const cleaned = content
    .replace(/<｜[^｜]*｜>/g, "")  // <｜…｜>
    .replace(/<\|[^|]*\|>/g, "")               // <|…|>
    .replace(/▁/g, " ");                        // SentencePiece space marker
  return cleaned.trim() || null;
}

/**
 * Strip tokenizer artefacts from a single SSE streaming delta chunk.
 *
 * Does NOT trim — providers often send a leading space as its own chunk
 * (" ") or with a word (" hello"). Trimming destroys word boundaries and
 * causes words to run together in the output.
 */
export function cleanStreamChunk(content: string): string {
  return content
    .replace(/<｜[^｜]*｜>/g, "")  // <｜…｜>
    .replace(/<\|[^|]*\|>/g, "")               // <|…|>
    .replace(/▁/g, " ");                        // SentencePiece space marker
}

// ---------------------------------------------------------------------------
// Think-block stripper
// ---------------------------------------------------------------------------

/**
 * Stateful stripper that removes <think>…</think> (and <thinking>…</thinking>)
 * blocks from a content stream delivered in arbitrary chunk boundaries.
 *
 * Create ONE instance per stream call, then call strip(chunk) for each
 * delta. Partial tags split across chunk boundaries are buffered in a
 * small tail so no fragment ever leaks to the caller.
 *
 * Example split that is handled correctly:
 *   chunk 1: "Hello <thi"
 *   chunk 2: "nk> inner"
 *   chunk 3: "</think> world"
 *   → yields "Hello ", "", " world"
 */
export class ThinkStripper {
  private inBlock = false;
  private tail    = ""; // partial tag leftover from previous chunk

  strip(incoming: string): string {
    let text = this.tail + incoming;
    this.tail = "";
    let out = "";

    while (text.length > 0) {
      if (!this.inBlock) {
        const m = text.match(/<think(?:ing)?>/i);
        if (!m || m.index === undefined) {
          // No opening tag — but the chunk end might be a partial tag
          const partial = text.match(/<(?:t(?:h(?:i(?:n(?:k(?:i(?:n(?:g?>?)?)?)?)?)?)?)?)?$/i);
          if (partial && partial[0].length > 0 && partial[0].length < 11) {
            out += text.slice(0, text.length - partial[0].length);
            this.tail = partial[0];
          } else {
            out += text;
          }
          break;
        }
        out += text.slice(0, m.index);            // text before the opening tag
        text = text.slice(m.index + m[0].length); // skip past opening tag
        this.inBlock = true;
      } else {
        const m = text.match(/<\/think(?:ing)?>/i);
        if (!m || m.index === undefined) {
          // Still inside block — buffer any partial closing tag
          const partial = text.match(/<\/(?:t(?:h(?:i(?:n(?:k(?:i(?:n(?:g?>?)?)?)?)?)?)?)?)?$/i);
          if (partial && partial[0].length > 0 && partial[0].length < 12) {
            this.tail = partial[0];
          }
          break; // discard — still inside think block
        }
        text = text.slice(m.index + m[0].length); // skip past closing tag
        this.inBlock = false;
      }
    }

    return out;
  }
}

