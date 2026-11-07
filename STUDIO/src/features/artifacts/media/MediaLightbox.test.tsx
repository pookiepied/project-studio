/**
 * @vitest-environment jsdom
 */
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MediaLightbox } from './MediaLightbox'
import { MediaViewer } from './MediaViewer'
import {
  EDIT_PROMPTS,
  MediaEditContext,
  wireOfDataUrl,
  type MediaEditing,
  type MediaViewerHandle,
} from './edits'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

afterEach(() => {
  cleanup()
})

function open(editing: MediaEditing | null, overrides: { video?: boolean; url?: string } = {}) {
  const onClose = vi.fn()
  render(
    <MediaEditContext.Provider value={editing}>
      <MediaLightbox
        open
        onClose={onClose}
        title="Ocean bird"
        model="openai/gpt-image-2"
        video={overrides.video ?? false}
        output={{ url: overrides.url ?? PNG, ratio: null }}
      />
    </MediaEditContext.Provider>,
  )
  return { onClose }
}

describe('the viewer', () => {
  it('names the model, shows no prompt caption, and no tools where nothing can be sent', () => {
    open(null)
    expect(screen.getByText('openai/gpt-image-2')).toBeTruthy()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('offers no tools on a video', () => {
    open({ send: vi.fn() }, { video: true })
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('holds every tool in one bar', () => {
    open({ send: vi.fn() })
    const bar = screen.getByRole('toolbar', { name: 'Edit the image' })
    for (const name of ['Markup', 'Comment', 'Remove BG', 'Erase', 'Resize']) {
      expect(within(bar).getByRole('button', { name })).toBeTruthy()
    }
  })
})

describe('editing from the bar', () => {
  it('sends Remove BG as a message with the picture attached, then closes', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true })
    const { onClose } = open({ send })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove BG' }))
    })
    expect(send).toHaveBeenCalledTimes(1)
    const [text, images] = send.mock.calls[0] as [string, readonly { data: string; mimeType: string }[]]
    expect(text).toBe(EDIT_PROMPTS.removeBackground)
    expect(images).toHaveLength(1)
    expect(images[0]?.mimeType).toBe('image/png')
    expect(images[0]?.data).toBe('iVBORw0KGgo=')
    expect(onClose).toHaveBeenCalled()
  })

  it('opens the ratios in the same bar and sends the one chosen', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true })
    open({ send })
    fireEvent.click(screen.getByRole('button', { name: 'Resize' }))
    expect(screen.getByRole('button', { name: 'Resize' }).getAttribute('aria-pressed')).toBe('true')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '16:9' }))
    })
    expect(send.mock.calls[0]?.[0]).toBe(EDIT_PROMPTS.ratio('16:9'))
  })

  it('stays open and says so when the send is refused', async () => {
    const send = vi.fn().mockResolvedValue({ ok: false })
    const { onClose } = open({ send })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove BG' }))
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toMatch(/could not be sent/)
  })

  it('refuses a picture in a format the submission would not take, without sending', async () => {
    const send = vi.fn()
    open({ send }, { url: 'data:image/svg+xml,%3Csvg%3E' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove BG' }))
    })
    expect(send).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toMatch(/format/)
  })

  it('erase waits for paint, and clicking the lit tool puts it down', () => {
    open({ send: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Erase marked' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }))
    expect(screen.queryByRole('button', { name: 'Erase marked' })).toBeNull()
  })

  it('without a composer, Markup takes its own field', () => {
    open({ send: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'Markup' }))
    expect(screen.getByRole('textbox', { name: 'Describe the change' })).toBeTruthy()
  })
})

describe('the viewer over the chat page', () => {
  function onPage() {
    const handle = createRef<MediaViewerHandle>()
    render(
      <MediaEditContext.Provider value={{ send: vi.fn() }}>
        <MediaViewer
          spec={{ output: { url: PNG, ratio: null }, title: 'Ocean bird', video: false }}
          onClose={() => {}}
          composer
          handle={handle}
        />
      </MediaEditContext.Provider>,
    )
    return handle
  }

  it('leaves the words to the composer: no field of its own', () => {
    onPage()
    fireEvent.click(screen.getByRole('button', { name: 'Markup' }))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('Paint an area')).toBeTruthy()
  })

  it('attaches the picture to what the composer sends, with the words as typed when nothing is marked', () => {
    const handle = onPage()
    const prepared = handle.current?.prepare('make it dusk')
    expect(prepared).toEqual({ text: 'make it dusk', images: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png', filename: 'image.png' }] })
  })
})

describe('the edit sentences and the wire', () => {
  it('reads a base64 picture as the wire image and refuses anything else', () => {
    expect(wireOfDataUrl(PNG, 'a.png')).toEqual({ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png', filename: 'a.png' })
    expect(wireOfDataUrl('data:image/svg+xml;base64,PHN2Zz4=', 'a.svg')).toBeNull()
    expect(wireOfDataUrl('data:image/png,abc', 'a.png')).toBeNull()
  })

  it('names the mask as the second image, as the providers are sent it', () => {
    expect(EDIT_PROMPTS.erase).toMatch(/marked in the second image from the first image/)
    expect(EDIT_PROMPTS.area('  a red kite ')).toMatch(/marked in the second image: a red kite Leave/)
    expect(EDIT_PROMPTS.point('add a hat')).toMatch(/spot marked in the second image: add a hat/)
  })
})
