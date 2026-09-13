import { parseMediaJobs, type MediaJob } from '../contracts'
import { isRecord } from '@/lib/guards'
import type { HarnessResult, Requester } from './request'

/**
 * `/api/media`: dictation in, speech out, a dictated passage tidied, and the
 * generation jobs - images and videos - a conversation started. The harness
 * resolves each slot's provider itself, so nothing here learns which vendor
 * served the words.
 */

const MEDIA_PATH = '/api/media'

export interface MediaClient {
  /**
   * Dictation: one recording in, its words out. The harness resolves the
   * transcription slot itself, so the composer never learns which provider
   * served the sentence.
   */
  transcribe(recording: {
    /**
     * The recording, base64. Named for the field the route parses
     * (`transcribeRequestSchema`), because this object is posted as the body
     * unchanged - a different name here is not a translation, it is a body the
     * harness refuses.
     */
    readonly audio: string
    readonly mimeType: string
  }): Promise<HarnessResult<{ readonly text: string }>>
  /**
   * A dictated passage, tidied on the default text model: punctuation,
   * casing, fillers - the words themselves kept. The reply is the whole
   * replacement for what was sent.
   */
  improveText(text: string): Promise<HarnessResult<{ readonly text: string }>>
  /** Read-aloud: text in, audio back as base64 under its mime type. */
  speak(input: {
    readonly text: string
  }): Promise<HarnessResult<{ readonly audio: string; readonly mimeType: string }>>
  /** The generation jobs one conversation started - images and videos - and a stop for one. */
  conversationMediaJobs(id: string): Promise<HarnessResult<readonly MediaJob[]>>
  stopConversationMediaJob(id: string, jobId: string): Promise<HarnessResult<void>>
}

function parseTranscribeResult(value: unknown): { text: string } | null {
  if (!isRecord(value) || typeof value['text'] !== 'string') return null
  return { text: value['text'] }
}

function parseSpeechResult(value: unknown): { audio: string; mimeType: string } | null {
  if (!isRecord(value)) return null
  const audio = value['audio']
  const mimeType = value['mimeType']
  if (typeof audio !== 'string' || typeof mimeType !== 'string') return null
  return { audio, mimeType }
}

export function mediaClient({ json, empty }: Requester): MediaClient {
  return {
    transcribe(recording) {
      // A real round trip: upload the recording, transcribe it at the
      // provider, read the words back. The harness driver holds a 120s budget
      // of its own; 150s here means the composer sees the provider's refusal
      // rather than this client's.
      return json('POST', `${MEDIA_PATH}/transcribe`, recording, parseTranscribeResult, 150_000)
    },

    improveText(text) {
      // One model turn; the harness gives the agent thirty seconds.
      return json('POST', `${MEDIA_PATH}/improve`, { text }, parseTranscribeResult, 40_000)
    },

    speak(input) {
      return json('POST', `${MEDIA_PATH}/speech`, input, parseSpeechResult, 150_000)
    },

    conversationMediaJobs(id) {
      return json(
        'GET',
        `${MEDIA_PATH}/jobs?conversationId=${encodeURIComponent(id)}`,
        undefined,
        parseMediaJobs,
      )
    },

    stopConversationMediaJob(id, jobId) {
      return empty('POST', `${MEDIA_PATH}/jobs/${encodeURIComponent(jobId)}/stop`, {
        conversationId: id,
      })
    },
  }
}
