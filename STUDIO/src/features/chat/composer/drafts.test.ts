/**
 * @vitest-environment jsdom
 *
 * The suite runs on `node` by default; this file needs a DOM only for
 * `localStorage`, which is the storage the module falls back to when there is
 * no Tauri - and a test process is exactly that case, so it is also the path
 * these tests exercise.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The module holds its map in a module-level cache, so every test re-imports
 * it rather than sharing one. `resetModules` is what makes `primeDrafts`
 * runnable more than once.
 */
async function freshModule() {
  vi.resetModules()
  return import('@/features/chat/composer/drafts')
}

const FILE = 'drafts.json'

beforeEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('composer drafts', () => {
  it('gives back what was typed, per conversation', async () => {
    const drafts = await freshModule()
    await drafts.primeDrafts()

    drafts.writeDraft('cnv_a', 'half a sentence')
    drafts.writeDraft('cnv_b', 'a different one')

    expect(drafts.readDraft('cnv_a')).toBe('half a sentence')
    expect(drafts.readDraft('cnv_b')).toBe('a different one')
    // A conversation nobody typed into is empty, not undefined: the value
    // goes straight into a controlled input.
    expect(drafts.readDraft('cnv_never')).toBe('')
  })

  it('files a draft under `new` before the conversation exists', async () => {
    const drafts = await freshModule()
    await drafts.primeDrafts()

    drafts.writeDraft(null, 'the first thing I will ask')
    expect(drafts.readDraft(null)).toBe('the first thing I will ask')
  })

  it('survives a restart', async () => {
    const first = await freshModule()
    await first.primeDrafts()
    first.writeDraft('cnv_a', 'written before the quit')
    await first.flushDrafts()

    // A second import with the same storage is what a relaunch looks like.
    const second = await freshModule()
    await second.primeDrafts()
    expect(second.readDraft('cnv_a')).toBe('written before the quit')
  })

  it('forgets a draft the moment its message is sent', async () => {
    const drafts = await freshModule()
    await drafts.primeDrafts()
    drafts.writeDraft('cnv_a', 'about to be sent')

    drafts.clearDraft('cnv_a')

    expect(drafts.readDraft('cnv_a')).toBe('')
    // And it is gone from storage too, not merely from memory - a quit
    // inside the debounce window must not resurrect a sent message.
    const reopened = await freshModule()
    await reopened.primeDrafts()
    expect(reopened.readDraft('cnv_a')).toBe('')
  })

  it('stores no entry for a field the person emptied', async () => {
    const drafts = await freshModule()
    await drafts.primeDrafts()
    drafts.writeDraft('cnv_a', 'typed')
    drafts.writeDraft('cnv_a', '')
    await drafts.flushDrafts()

    const stored: unknown = JSON.parse(localStorage.getItem(FILE) ?? '{}')
    expect(stored).toEqual({})
  })

  it('drops stored entries that are not draft-shaped', async () => {
    // The file can be hand-edited, left over from an older record shape, or
    // truncated by a crash mid-write. None of that may reach the composer.
    localStorage.setItem(
      FILE,
      JSON.stringify({
        good: { text: 'kept', at: 1 },
        numberText: { text: 42, at: 1 },
        nullEntry: null,
        notAnObject: 'plain string',
        emptyText: { text: '', at: 1 },
        missingAt: { text: 'still kept', at: 'not a number' },
      }),
    )

    const drafts = await freshModule()
    await drafts.primeDrafts()

    expect(drafts.readDraft('good')).toBe('kept')
    expect(drafts.readDraft('numberText')).toBe('')
    expect(drafts.readDraft('nullEntry')).toBe('')
    expect(drafts.readDraft('notAnObject')).toBe('')
    expect(drafts.readDraft('emptyText')).toBe('')
    // A bad timestamp costs the entry its place in the eviction order, not
    // the text itself - the text is the part that is expensive to lose.
    expect(drafts.readDraft('missingAt')).toBe('still kept')
  })

  it('survives storage holding something that is not JSON at all', async () => {
    localStorage.setItem(FILE, '{not json')
    const drafts = await freshModule()
    await drafts.primeDrafts()
    expect(drafts.readDraft('cnv_a')).toBe('')
  })

  it('keeps the file bounded, dropping the least recently touched first', async () => {
    const drafts = await freshModule()
    await drafts.primeDrafts()

    // Fifty-one drafts, each stamped later than the last.
    for (let index = 0; index < 51; index += 1) {
      vi.setSystemTime(new Date(1_000 + index))
      drafts.writeDraft(`cnv_${index}`, `draft ${index}`)
    }
    vi.useRealTimers()
    await drafts.flushDrafts()

    const stored: unknown = JSON.parse(localStorage.getItem(FILE) ?? '{}')
    expect(Object.keys(stored as object)).toHaveLength(50)
    // The oldest went; the newest stayed.
    expect(drafts.readDraft('cnv_0')).toBe('')
    expect(drafts.readDraft('cnv_50')).toBe('draft 50')
  })

  it('waits for the typing to stop before writing', async () => {
    vi.useFakeTimers()
    const drafts = await freshModule()
    await drafts.primeDrafts()

    drafts.writeDraft('cnv_a', 'p')
    drafts.writeDraft('cnv_a', 'pa')
    drafts.writeDraft('cnv_a', 'par')

    // Nothing written yet: three keystrokes inside the quiet window are one
    // write, not three.
    expect(localStorage.getItem(FILE)).toBeNull()

    await vi.advanceTimersByTimeAsync(500)
    const stored: unknown = JSON.parse(localStorage.getItem(FILE) ?? '{}')
    expect(stored).toMatchObject({ cnv_a: { text: 'par' } })
    vi.useRealTimers()
  })
})
