/**
 * Server-Sent Events framing, and nothing else.
 *
 * The twin of `services/sse.rs` on the Rust side. Two implementations of one
 * grammar is a cost worth naming: they exist because the desktop window reads
 * the harness through Rust, which holds the credential, and a browser on
 * another device reads it through `fetch`, where there is no Rust to do the
 * reading. Neither can use the other's.
 *
 * What makes that safe rather than a drift waiting to happen is that the rules
 * are small, written down in one place, and pinned by the same list of tests on
 * both sides. That list is not re-derived here: it is the one the Rust parser
 * carries, which is itself the list a deleted TypeScript parser paid for
 * earlier in this project's life. The edge cases are where a chunk boundary
 * falls, not the field grammar.
 *
 * Bytes are buffered, not text. A multi-byte UTF-8 character can straddle a
 * chunk boundary, and decoding each chunk on its own would corrupt it
 * silently. A line is decoded only once its terminator has arrived, and every
 * terminator is ASCII, so a complete line is always whole characters.
 *
 * What this module does not know: HTTP, offsets, the harness, what a frame
 * means. Parsing is separated from delivery so both can be tested alone.
 */

/** One dispatched block: an optional event name and its data, joined. */
export interface SseFrame {
  readonly event: string | null
  readonly data: string
}

const LF = 0x0a
const CR = 0x0d
const COLON = 0x3a

/**
 * An incremental parser. Feed it chunks; it returns the frames they completed.
 */
export class SseParser {
  /** Bytes not yet resolved into a complete line. */
  #buffer = new Uint8Array(0)
  /** The block under construction, dispatched by the next blank line. */
  #event: string | null = null
  #data: string | null = null
  readonly #decoder = new TextDecoder()

  /** Feeds one chunk and returns every frame it completed. */
  push(chunk: Uint8Array): readonly SseFrame[] {
    if (chunk.length > 0) {
      const grown = new Uint8Array(this.#buffer.length + chunk.length)
      grown.set(this.#buffer)
      grown.set(chunk, this.#buffer.length)
      this.#buffer = grown
    }
    return this.#drain(false)
  }

  /**
   * Ends the stream: a trailing lone carriage return is resolved as a line
   * break, which can complete a block, and whatever then remains has no
   * terminator at all — so it is a truncated frame and is discarded rather
   * than half-emitted.
   */
  finish(): readonly SseFrame[] {
    const frames = this.#drain(true)
    this.#buffer = new Uint8Array(0)
    this.#event = null
    this.#data = null
    return frames
  }

  #drain(atEnd: boolean): readonly SseFrame[] {
    const frames: SseFrame[] = []
    for (;;) {
      const line = this.#nextLine(atEnd)
      if (line === null) break
      const frame = this.#ingest(line)
      if (frame !== null) frames.push(frame)
    }
    return frames
  }

  /**
   * Removes and returns the next complete line, without its terminator.
   *
   * `null` when the buffer holds no decidable line end. The one undecided case
   * is a carriage return as the very last byte: it is either half of a CRLF or
   * a lone-carriage-return line break, and those are ONE line break rather
   * than two. Deciding early is the bug this shape exists to prevent — one
   * break became two and split a frame in half. More bytes decide it; only the
   * end of the stream may decide it as lone.
   */
  #nextLine(atEnd: boolean): Uint8Array | null {
    for (let index = 0; index < this.#buffer.length; index += 1) {
      const byte = this.#buffer[index]
      let terminator: number
      if (byte === LF) {
        terminator = 1
      } else if (byte === CR) {
        const following = index + 1 < this.#buffer.length ? this.#buffer[index + 1] : null
        if (following === LF) terminator = 2
        else if (following !== null) terminator = 1
        else if (atEnd) terminator = 1
        else return null
      } else {
        continue
      }
      const line = this.#buffer.slice(0, index)
      this.#buffer = this.#buffer.slice(index + terminator)
      return line
    }
    return null
  }

  /**
   * Applies one line to the block under construction, returning a frame
   * exactly when the line was blank and the block had data.
   */
  #ingest(line: Uint8Array): SseFrame | null {
    if (line.length === 0) {
      if (this.#data === null) {
        // A block with no data is a keep-alive, not an event.
        this.#event = null
        return null
      }
      const frame: SseFrame = { event: this.#event, data: this.#data }
      this.#event = null
      this.#data = null
      return frame
    }
    // A comment. Nothing to parse; used by servers as heartbeats.
    if (line[0] === COLON) return null

    const text = this.#decoder.decode(line)
    const at = text.indexOf(':')
    // The spec strips exactly one space after the field colon, so `data:x` and
    // `data: x` are the same and `data:  x` keeps one space. The harness emits
    // no space, so both shapes have to work.
    const name = at === -1 ? text : text.slice(0, at)
    const raw = at === -1 ? '' : text.slice(at + 1)
    const value = raw.startsWith(' ') ? raw.slice(1) : raw

    if (name === 'event') {
      this.#event = value
    } else if (name === 'data') {
      this.#data = this.#data === null ? value : `${this.#data}\n${value}`
    }
    // `id`, `retry`, and anything unknown: ignored, as the spec says.
    return null
  }
}
