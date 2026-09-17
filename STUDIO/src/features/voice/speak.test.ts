import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HarnessResult } from '@/platform/harness'

/**
 * The read-aloud seam, twin of `transcribe.test.ts` and the same shape on
 * purpose: the address is resolved by the real function, only the call over
 * the wire is replaced, and the exits pinned here are the ones the player
 * pill branches on.
 */

const speak = vi.fn<() => Promise<HarnessResult<{ audio: string; mimeType: string }>>>()

vi.mock('@/platform/harness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/harness')>()
  return {
    ...actual,
    createHarnessClient: () => ({ speak: () => speak() }),
  }
})

const { speakText } = await import('./speak')

/**
 * The address stub mirrors the transcribe suite: vitest loads a developer's
 * gitignored `.env` like any other vite process, so without the stub a
 * machine that has run the browser build against a hand-started harness would
 * see this test make a live request. Both variables empty is the no-harness
 * case the first test exists to pin, and the rest run against a resolvable
 * address.
 */
function withHarness(): void {
  vi.stubEnv('VITE_HARNESS_BASE_URL', 'http://127.0.0.1:1')
  vi.stubEnv('VITE_HARNESS_TOKEN', 'test')
}

const audio = (bytes = 'AAAA'): HarnessResult<{ audio: string; mimeType: string }> => ({
  ok: true,
  value: { audio: bytes, mimeType: 'audio/mpeg' },
})
const refused = (
  status: number,
  message: string,
): HarnessResult<{ audio: string; mimeType: string }> => ({
  ok: false,
  error: { kind: 'harness-error', status, message },
})

afterEach(() => {
  vi.unstubAllEnvs()
  speak.mockReset()
})

describe('the read-aloud seam', () => {
  it('says the harness is not running rather than reaching for the wire', async () => {
    vi.stubEnv('VITE_HARNESS_BASE_URL', '')
    vi.stubEnv('VITE_HARNESS_TOKEN', '')

    const outcome = await speakText('Good morning.')
    expect(outcome.kind).toBe('note')
    expect(outcome.kind === 'note' && outcome.note).toContain('harness is not running')
    expect(speak).not.toHaveBeenCalled()
  })

  it('hands back the provider audio under its mime type', async () => {
    withHarness()
    speak.mockResolvedValueOnce(audio())

    const outcome = await speakText('Good morning.')
    expect(outcome).toEqual({ kind: 'ok', audio: 'AAAA', mimeType: 'audio/mpeg' })
  })

  it('translates an unset slot into the sentence that names its fix', async () => {
    withHarness()
    // The resolver's own sentence, verbatim - the slot is named by its
    // product word, read-aloud, not the capability slot's name.
    speak.mockResolvedValueOnce(
      refused(502, 'No read-aloud model is connected. Choose one in Settings - Providers.'),
    )

    const outcome = await speakText('Good morning.')
    expect(outcome.kind).toBe('note')
    expect(outcome.kind === 'note' && outcome.note).toBe(
      'No read-aloud model is connected - pick one in Settings - Providers',
    )
  })

  it('carries any other refusal as a failure with the harness words in it', async () => {
    withHarness()
    speak.mockResolvedValueOnce(refused(502, 'Google refused the speech request: no such voice.'))

    const outcome = await speakText('Good morning.')
    expect(outcome.kind).toBe('note')
    expect(outcome.kind === 'note' && outcome.note).toContain('Read-aloud failed')
    expect(outcome.kind === 'note' && outcome.note).toContain('Google refused the speech request')
  })

  it('says so when the provider answered without audio', async () => {
    withHarness()
    speak.mockResolvedValueOnce({ ok: true, value: { audio: '', mimeType: 'audio/mpeg' } })

    const outcome = await speakText('Good morning.')
    expect(outcome.kind).toBe('note')
    expect(outcome.kind === 'note' && outcome.note).toContain('returned no audio')
  })
})
