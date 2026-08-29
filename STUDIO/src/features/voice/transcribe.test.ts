import { describe, expect, it } from 'vitest'

import { transcribeRecording } from './transcribe'
import type { VoiceNote } from './useMicInput'

/**
 * The seam's own contract, where the environment can be pinned: outside
 * Tauri with no dev env vars there is no harness, and that fact is a note,
 * never typed-out words pretending to be a transcript. The happy path is the
 * media-routes suite on the harness side; this file pins the two exits the
 * composer's strip depends on.
 */

const note = (blob: Blob | null): VoiceNote => ({ blob, durationMs: 1_700 })

describe('the dictation seam', () => {
  it('says what happened when nothing was recorded', async () => {
    const outcome = await transcribeRecording(note(null))
    expect(outcome.kind).toBe('note')
    expect(outcome.kind === 'note' && outcome.note).toContain('Nothing was captured')
  })

  it('says the harness is not running rather than inventing words', async () => {
    const outcome = await transcribeRecording(note(new Blob([new Uint8Array([1, 2, 3])])))
    expect(outcome.kind).toBe('note')
    expect(outcome.kind === 'note' && outcome.note).toContain('harness is not running')
  })
})
