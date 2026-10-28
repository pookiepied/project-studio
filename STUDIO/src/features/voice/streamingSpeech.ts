import type { AudioSink } from './narration'
import type { SpeechOutcome } from './speak'
import { captionTokens } from './captions'

interface StreamingSpeechOptions {
  speak: (text: string) => Promise<SpeechOutcome>
  openSink: (onEnded: () => void) => AudioSink
  onPlaying: () => void
  /** A phrase's sound has started: the caption follows the voice, not the text stream. */
  onPhrase?: (text: string) => void
  onDone: () => void
  onFailure: (note: string) => void
}

/** Stream short phrases, prefetching at most one clip while another plays. */
export class StreamingSpeech {
  private readonly options: StreamingSpeechOptions
  #tail = ''
  #phrases: string[] = []
  #closed = false
  #finished = false
  #characters = 0
  #wake: (() => void) | undefined
  #played: (() => void) | undefined
  #paused = false
  /** Started-sounding news held while paused, delivered on resume. */
  #held: Array<() => void> = []
  /**
   * The phrases that actually began to sound, in order - not the ones
   * rendered or queued. A phrase held behind a pause is not here until the
   * resume plays it, because until then nobody heard it.
   */
  #heard: string[] = []
  readonly #sink: AudioSink

  constructor(options: StreamingSpeechOptions) {
    this.options = options
    this.#sink = options.openSink(() => { if (!this.#closed) { this.stop(); options.onDone() } })
    void this.#run().catch((error: unknown) => {
      if (this.#closed) return
      this.stop()
      options.onFailure(error instanceof Error ? error.message : 'Speech playback failed.')
    })
  }

  append(delta: string): void {
    if (this.#closed || this.#finished) return
    this.#characters += delta.length
    if (this.#characters > 6000) { this.finish(); return }
    this.#tail += delta
    while (this.#tail.length > 0) {
      const punctuation = /[.!?;:\n](?:\s|$)/.exec(this.#tail)
      let end = punctuation === null ? -1 : punctuation.index + 1
      if (end < 0 && this.#tail.length >= 120) end = this.#tail.lastIndexOf(' ', 120)
      if (end <= 0) break
      this.#queue(this.#tail.slice(0, end))
      this.#tail = this.#tail.slice(end).trimStart()
    }
    this.#wake?.()
  }

  finish(): void {
    if (this.#closed || this.#finished) return
    this.#queue(this.#tail)
    this.#tail = ''
    this.#finished = true
    this.#wake?.()
  }

  /**
   * Queues one phrase as the voice should say it. A cut at a line break or a
   * lone mark leaves nothing to say, and the speech route refuses empty text,
   * so such a phrase is dropped rather than sent; Markdown marks are removed
   * for the same reason the caption removes them.
   */
  #queue(raw: string): void {
    const phrase = captionTokens(raw).join('').trim()
    if (/[\p{L}\p{N}]/u.test(phrase)) this.#phrases.push(phrase)
  }

  /**
   * Holds the voice where it is. The sink's clock stops with it, so resume
   * picks up mid-word; phrases keep rendering meanwhile, and the news that
   * one started sounding waits for the resume, when it really does.
   */
  pause(): void {
    if (this.#closed || this.#paused) return
    this.#paused = true
    this.#sink.pause()
  }

  resume(): void {
    if (this.#closed || !this.#paused) return
    this.#paused = false
    this.#sink.resume()
    const held = this.#held
    this.#held = []
    for (const deliver of held) deliver()
  }

  #started(phrase: string | undefined): void {
    const deliver = () => {
      if (this.#closed) return
      if (phrase !== undefined) {
        this.#heard.push(phrase)
        this.options.onPhrase?.(phrase)
      }
      this.options.onPlaying()
    }
    if (this.#paused) this.#held.push(deliver)
    else deliver()
  }

  /** What the listener heard of this reply, as far as the speaker knows: every phrase that began to sound. */
  get heard(): string {
    return this.#heard.join(' ')
  }

  stop(): void {
    if (this.#closed) return
    this.#closed = true
    this.#held = []
    this.#phrases = []
    this.#tail = ''
    this.#sink.close()
    this.#wake?.()
    this.#played?.()
  }

  async #next(): Promise<string | undefined> {
    while (!this.#closed && !this.#finished && this.#phrases.length === 0) {
      await new Promise<void>((resolve) => { this.#wake = resolve })
      this.#wake = undefined
    }
    return this.#closed ? undefined : this.#phrases.shift()
  }

  async #render(text: string): Promise<SpeechOutcome> {
    try { return await this.options.speak(text) }
    catch { return { kind: 'note', note: 'The speech provider could not be reached.' } }
  }

  async #run(): Promise<void> {
    let text = await this.#next()
    let rendering = text === undefined ? undefined : this.#render(text)
    while (rendering !== undefined && !this.#closed) {
      const clip = await rendering
      const phrase = text
      if (this.#closed) return
      if (clip.kind === 'note') { this.stop(); this.options.onFailure(clip.note); return }
      const played = new Promise<void>((resolve) => { this.#played = resolve })
      await this.#sink.enqueue(clip, () => this.#played?.())
      if (this.#closed) return
      this.#started(phrase)
      text = await this.#next()
      rendering = text === undefined ? undefined : this.#render(text)
      await played
      this.#played = undefined
    }
    if (!this.#closed) this.#sink.finish()
  }
}
