import { afterEach, describe, expect, it, vi } from 'vitest'

import { transcribeRecording } from './transcribe'
import type { VoiceNote } from './useMicInput'

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

afterEach(() => {
  vi.unstubAllEnvs()
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
