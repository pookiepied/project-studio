import type { ConversationClient, ConversationDelivery, TurnSettingsWire } from '@/platform/harness/conversation'
import { StreamingSpeech } from './streamingSpeech'

interface VoiceConversationOptions {
  client: ConversationClient
  output: () => StreamingSpeech
  onText: (text: string) => void
  onFailure: (note: string) => void
  /**
   * Set when voice opens a chat that does not exist yet. The first utterance
   * is submitted with these settings and creates the conversation; only then
   * is there a stream to read.
   */
  fresh?: VoiceFreshChat
}

export interface VoiceFreshChat {
  readonly settings: TurnSettingsWire
  readonly onAdmitted: (text: string, receipt: { readonly submissionId: string; readonly offset: string }) => void
}

/** Audio consumes only new journal events; replay never speaks or submits work. */
export class VoiceConversation {
  private readonly options: VoiceConversationOptions
  #output: StreamingSpeech | undefined
  #draining: StreamingSpeech | undefined
  #activeSubmissions = new Set<string>()
  #ignoredSubmissions = new Set<string>()
  #reader: ReturnType<ConversationClient['attach']> | undefined
  #submission: Promise<unknown> = Promise.resolve()
  #barrier: Promise<void> = Promise.resolve()
  #closed = false
  #epoch = 0
  #accepting = true
  #ownsGeneration = false
  #pendingFirst: VoiceConversationOptions['fresh']
  // Read from our own first receipt: nothing precedes it, so what the
  // stream calls catch-up is this conversation's live reply.
  #replayIsLive = false
  #messageIds = new Set<string>()
  #position = ''
  #holding = false

  constructor(options: VoiceConversationOptions) {
    this.options = options
    this.#pendingFirst = options.fresh
  }

  start(): void {
    if (this.#pendingFirst === undefined) this.#attach()
  }

  #attach(from?: string): void {
    this.#reader = this.options.client.attach({ onEvent: (event) => this.receive(event) }, from === undefined ? undefined : { from })
    void this.#reader.settled.then((result) => {
      if (!this.#closed) {
        this.#output?.stop()
        this.#draining?.stop()
        this.options.onFailure(result.outcome === 'broken' || result.outcome === 'refused' ? result.failure.message : 'The voice connection ended. Reopen voice mode to continue.')
      }
    })
  }

  receive(event: ConversationDelivery): void {
    if (this.#closed || event.kind !== 'chunks' || (event.replaying && !this.#replayIsLive)) return
    for (const chunk of event.chunks) {
      if (chunk.position !== null) {
        const position = `${String(chunk.position.batch).padStart(16, '0')}:${String(chunk.position.index).padStart(8, '0')}`
        if (position <= this.#position) continue
        this.#position = position
      }
      if (!this.#accepting) continue
      if (chunk.submissionId !== null && this.#ignoredSubmissions.has(chunk.submissionId)) continue
      if (chunk.type === 'message-started' && chunk.messageId !== null) {
        this.#ownsGeneration = true
        if (chunk.submissionId !== null) this.#activeSubmissions.add(chunk.submissionId)
        this.#messageIds.add(chunk.messageId)
        if (this.#messageIds.size > 128) this.#messageIds.delete(this.#messageIds.values().next().value ?? '')
      }
      if (chunk.type === 'message-delta' && chunk.deltaKind === 'text' && chunk.delta !== null && chunk.messageId !== null && this.#messageIds.has(chunk.messageId)) {
        if (this.#output === undefined) {
          this.#draining?.stop()
          this.#output = this.options.output()
          if (this.#holding) this.#output.pause()
        }
        this.options.onText(chunk.delta)
        this.#output.append(chunk.delta)
      }
      if (chunk.type === 'submission-settled') {
        this.#ownsGeneration = false
        if (chunk.outcome === 'completed') this.#output?.finish()
        else {
          this.#output?.stop()
          if (chunk.outcome === 'failed') this.options.onFailure(chunk.errorMessage ?? 'The voice model failed to answer.')
        }
        if (this.#output !== undefined) this.#draining = this.#output
        this.#output = undefined
        if (chunk.submissionId !== null) this.#activeSubmissions.delete(chunk.submissionId)
      }
    }
  }

  async send(text: string): Promise<void> {
    const epoch = this.#epoch
    await this.#barrier
    if (this.#closed || epoch !== this.#epoch) return
    this.#accepting = true
    this.#ownsGeneration = true
    const first = this.#pendingFirst
    this.#pendingFirst = undefined
    const settings = first === undefined ? { modelId: null, reasoningLevel: null } : first.settings
    const submission = this.options.client.submitTurn(text, { ...settings, voice: true, deliveryMode: 'steer' })
    this.#submission = submission
    const result = await submission
    if (first !== undefined) {
      if (!result.ok) this.#pendingFirst = first
      else if (!this.#closed) {
        // Even an interrupted first turn created the conversation; read it.
        this.#replayIsLive = true
        this.#attach(result.value.offset)
        first.onAdmitted(text, result.value)
      }
    }
    if (result.ok && epoch !== this.#epoch) this.#ignoredSubmissions.add(result.value.submissionId)
    // Known before its first chunk, so an interrupt in between still fences
    // it off once speaking is allowed again.
    else if (result.ok) this.#activeSubmissions.add(result.value.submissionId)
    if (!this.#closed && epoch === this.#epoch && !result.ok) this.options.onFailure(result.error.message)
  }

  /**
   * Holds Studio's voice while the person may be talking over it, without
   * cancelling anything: the reply keeps generating and its audio waits,
   * exactly where it stopped. `release` lets it go on; `interrupt` ends it.
   */
  hold(): void {
    if (this.#closed || this.#holding) return
    this.#holding = true
    this.#output?.pause()
    this.#draining?.pause()
  }

  release(): void {
    if (!this.#holding) return
    this.#holding = false
    this.#output?.resume()
    this.#draining?.resume()
  }

  get holding(): boolean {
    return this.#holding
  }

  interrupt(): void {
    if (this.#closed) return
    this.#holding = false
    const cancelGeneration = this.#ownsGeneration
    this.#ownsGeneration = false
    const epoch = ++this.#epoch
    this.#accepting = false
    this.#messageIds.clear()
    for (const id of this.#activeSubmissions) this.#ignoredSubmissions.add(id)
    this.#activeSubmissions.clear()
    while (this.#ignoredSubmissions.size > 128) this.#ignoredSubmissions.delete(this.#ignoredSubmissions.values().next().value ?? '')
    this.#output?.stop()
    this.#draining?.stop()
    this.#draining = undefined
    this.#output = undefined
    // Wait for pending admission before aborting, so a late receipt cannot
    // leave obsolete generation running or abort a newer turn.
    const pending = this.#submission
    this.#barrier = this.#barrier.then(async () => {
      await pending
      if (!cancelGeneration) return
      const result = await this.options.client.abortRun()
      if (!this.#closed && !result.ok) this.options.onFailure(result.error.message)
    }).catch(() => { if (!this.#closed) this.options.onFailure('Speech stopped locally, but model cancellation could not be confirmed.') })
      // Once the interrupted reply is fenced off, Studio may speak again
      // without being spoken to: a task finishing is its own new reply, and
      // waiting for the next utterance left that news silent until then.
      .finally(() => { if (epoch === this.#epoch) this.#accepting = true })
  }

  close(): void {
    this.interrupt()
    this.#closed = true
    void this.#reader?.cancel()
  }
}
