import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HarnessResult } from '@/platform/harness'
import type { VoiceNote } from './useMicInput'

/**
 * The harness client, as a stand-in whose answers the test scripts. The
 * address is resolved by the real function, so the "no harness" exit still
 * runs against the real absence; only the call over the wire is replaced.
 */
const transcribe = vi.fn<() => Promise<HarnessResult<{ text: string }>>>()

vi.mock('@/platform/harness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/harness')>()
  return {
    ...actual,
    createHarnessClient: () => ({ transcribe: () => transcribe() }),
  }
})

const { transcribeRecording } = await import('./transcribe')

/**
 * The seam's own contract, where the environment can be pinned: with no
 * harness address there is no harness, and that fact is a note, never
 * typed-out words pretending to be a transcript. The happy path is the
 * media-routes suite on the harness side; this file pins the two exits the
 * composer's strip depends on.
 *
 * The absence is stubbed rather than assumed. Outside Tauri the address comes
 * from `VITE_HARNESS_BASE_URL` and `VITE_HARNESS_TOKEN`, and vitest loads the
 * developer's gitignored `.env` like any other vite process -- so on a machine
 * that has ever run the browser build against a hand-started harness, both
 * were set, `resolveHarnessAddress` returned a real address, and this test
 * made a live fetch to whatever port that launch happened to use. It then
 * failed on the sentence for a dead socket instead of the sentence for no
 * harness, which is a true statement about the wrong situation. Stubbing both
 * to empty makes the test say what it means and keeps it off the network.
 */

const note = (blob: Blob | null): VoiceNote => ({ blob, durationMs: 1_700 })

/** A resolvable address, so the call reaches the stand-in client. */
function withHarness(): void {
  vi.stubEnv('VITE_HARNESS_BASE_URL', 'http://127.0.0.1:1')
  vi.stubEnv('VITE_HARNESS_TOKEN', 'test')
}

const ok = (text: string): HarnessResult<{ text: string }> => ({ ok: true, value: { text } })
const refused = (status: number, message: string): HarnessResult<{ text: string }> => ({
  ok: false,
  error: { kind: 'harness-error', status, message },
})

afterEach(() => {
  vi.unstubAllEnvs()
  transcribe.mockReset()
  vi.useRealTimers()
})

describe('the dictation seam', () => {
  it('says what happened when nothing was recorded', async () => {
    const outcome = await transcribeRecording(note(null))
    expect(outcome.kind).toBe('note')
    expect(outcome.kind === 'note' && outcome.note).toContain('Nothing was captured')
  })

  it('says the harness is not running rather than inventing words', async () => {
    vi.stubEnv('VITE_HARNESS_BASE_URL', '')
    vi.stubEnv('VITE_HARNESS_TOKEN', '')

    const outcome = await transcribeRecording(note(new Blob([new Uint8Array([1, 2, 3])])))
    expect(outcome.kind).toBe('note')
    expect(outcome.kind === 'note' && outcome.note).toContain('harness is not running')
  })
})

describe('a file of no bytes', () => {
  it('is nothing said, not a request: a segment is empty and a take is reported', async () => {
    withHarness()
    const empty = note(new Blob([]))

    const segment = await transcribeRecording(empty, { segment: true })
    expect(segment).toEqual({ kind: 'ok', text: '' })

    const take = await transcribeRecording(empty)
    expect(take.kind).toBe('note')
    expect(take.kind === 'note' && take.note).toContain('Nothing was captured')
    // Neither reached the wire. Posted, the empty string was a body the
    // route refused, and the refusal named base64 to a person who had only
    // stopped speaking.
    expect(transcribe).not.toHaveBeenCalled()
  })
})

describe('a refusal a moment could change', () => {
  it('is tried once more, and the second answer stands', async () => {
    withHarness()
    vi.useFakeTimers()
    transcribe
      .mockResolvedValueOnce(refused(429, 'Too many requests'))
      .mockResolvedValueOnce(ok('The second time.'))

    const pending = transcribeRecording(note(new Blob([new Uint8Array([1, 2, 3])])))
    await vi.runAllTimersAsync()
    expect(await pending).toEqual({ kind: 'ok', text: 'The second time.' })
    expect(transcribe).toHaveBeenCalledTimes(2)
  })

  it('is reported after the second refusal, not tried a third time', async () => {
    withHarness()
    vi.useFakeTimers()
    transcribe.mockResolvedValue(refused(502, 'Deepgram answered 503 with no explanation.'))

    const pending = transcribeRecording(note(new Blob([new Uint8Array([1, 2, 3])])))
    await vi.runAllTimersAsync()
    const outcome = await pending
    expect(outcome.kind === 'note' && outcome.note).toContain('Dictation failed')
    expect(transcribe).toHaveBeenCalledTimes(2)
  })

  it('is not what a bad body or a missing model is: those are reported at once', async () => {
    withHarness()
    transcribe.mockResolvedValueOnce(refused(400, 'The transcription body must be ...'))
    const bad = await transcribeRecording(note(new Blob([new Uint8Array([1])])))
    expect(bad.kind).toBe('note')
    expect(transcribe).toHaveBeenCalledTimes(1)

    // The harness names the slot by its product word, dictation - not the
    // capability slot's own name. The refusal is fed as the resolver's real
    // sentence, and the seam's own sentence must come back - not the raw
    // refusal wearing a "Dictation failed" prefix, which is what the fallback
    // would produce if the match were broken.
    transcribe.mockResolvedValueOnce(
      refused(502, 'No dictation model is connected. Choose one in Settings - Providers.'),
    )
    const unset = await transcribeRecording(note(new Blob([new Uint8Array([1])])))
    expect(unset.kind === 'note' && unset.note).toBe(
      'No dictation model is connected - pick one in Settings - Providers',
    )
    expect(transcribe).toHaveBeenCalledTimes(2)
  })
})
