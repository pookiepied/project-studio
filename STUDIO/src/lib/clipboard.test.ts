/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readDesktopClipboardText } from '@/platform/tauri'
import { copyText, readClipboardText } from './clipboard'

vi.mock('@/platform/tauri', () => ({ readDesktopClipboardText: vi.fn(async () => null) }))

/**
 * The copy control's answer has to be true only when the clipboard really
 * got the text. The fallback path is the browser half of the parity table:
 * on an insecure origin there is no `navigator.clipboard`, and
 * `execCommand('copy')` through a selection is the remaining write.
 */

afterEach(() => {
  vi.restoreAllMocks()
  // The clipboard property is not in jsdom by default; anything a test
  // defined on it comes off again, so the next test meets the real (absent)
  // API and takes the fallback path for real.
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('copyText', () => {
  it('writes through the clipboard API when it exists', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    await expect(copyText('the words')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('the words')
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('falls back to the selection round-trip when the clipboard API is absent', async () => {
    // jsdom has no `navigator.clipboard` and no `execCommand`; the command is
    // stubbed, which is the piece whose behaviour a browser is being asked
    // to supply.
    const execCommand = vi.fn(() => true)
    document.execCommand = execCommand

    await expect(copyText('the words')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    // The textarea the selection lived in is gone again.
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('says no when both ways refuse', async () => {
    const execCommand = vi.fn(() => false)
    document.execCommand = execCommand

    await expect(copyText('the words')).resolves.toBe(false)
  })

  it('says no when there is no way at all', async () => {
    delete (document as { execCommand?: unknown }).execCommand

    await expect(copyText('the words')).resolves.toBe(false)
  })
})

describe('readClipboardText', () => {
  it('takes the desktop read first, even when the browser API would answer', async () => {
    vi.mocked(readDesktopClipboardText).mockResolvedValueOnce('from the desktop')
    const readText = vi.fn(async () => 'from the webview')
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true })

    await expect(readClipboardText()).resolves.toBe('from the desktop')
    expect(readText).not.toHaveBeenCalled()
  })

  it('asks the browser when there is no desktop shell', async () => {
    const readText = vi.fn(async () => 'from the webview')
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true })

    await expect(readClipboardText()).resolves.toBe('from the webview')
  })

  it('reads nothing, quietly, when the desktop read refuses', async () => {
    vi.mocked(readDesktopClipboardText).mockRejectedValueOnce(new Error('held by another application'))

    await expect(readClipboardText()).resolves.toBe('')
  })
})
