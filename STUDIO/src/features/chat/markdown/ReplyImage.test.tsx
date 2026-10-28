/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { harnessBytesDataUrl } from '@/platform/harness'
import { Markdown } from './Markdown'
import { ReplyConversation } from './ReplyImage'

vi.mock('@/platform/harness', async (original) => ({
  ...await original<typeof import('@/platform/harness')>(),
  harnessBytesDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AAAA'),
}))
afterEach(() => { cleanup(); vi.clearAllMocks() })

function inConversation(text: string) {
  return render(<ReplyConversation.Provider value="cnv-1"><Markdown text={text} /></ReplyConversation.Provider>)
}

describe('pictures in a reply', () => {
  it('fetches a web picture through the harness, never from the window', async () => {
    inConversation('![A chart](https://example.com/chart.png)')
    const image = await screen.findByRole('img', { name: 'A chart' })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(harnessBytesDataUrl).toHaveBeenCalledWith(
      `/api/web/image?url=${encodeURIComponent('https://example.com/chart.png')}`, 'image/png', { sniff: true })
  })

  it("reads a saved picture from the conversation's own files", async () => {
    inConversation('![Plot](workspace/chart.png)')
    await screen.findByRole('img', { name: 'Plot' })
    expect(harnessBytesDataUrl).toHaveBeenCalledWith('/api/media/workspace/cnv-1?path=workspace%2Fchart.png', 'image/png', { sniff: true })
  })

  it('keeps a Windows path whole past the URL filters', async () => {
    inConversation('![Plot](C:\\Users\\me\\plot.png)')
    await screen.findByRole('img', { name: 'Plot' })
    expect(harnessBytesDataUrl).toHaveBeenCalledWith(
      `/api/media/workspace/cnv-1?path=${encodeURIComponent('C:\\Users\\me\\plot.png')}`, 'image/png', { sniff: true })
  })

  it('names a picture that cannot be shown instead of drawing a broken one', async () => {
    vi.mocked(harnessBytesDataUrl).mockResolvedValueOnce(null)
    inConversation('![Revenue](https://example.com/gone.png)')
    expect(await screen.findByRole('img', { name: 'Image unavailable: Revenue' })).toBeTruthy()
  })

  it('shows nothing it cannot place: a path outside any conversation', () => {
    render(<Markdown text="![Plot](chart.png)" />)
    expect(screen.getByRole('img', { name: 'Image unavailable: Plot' })).toBeTruthy()
    expect(harnessBytesDataUrl).not.toHaveBeenCalled()
  })

  it('keeps a malformed local image address from breaking the conversation', () => {
    inConversation('![Plot](studio-file:%ZZ)')
    expect(screen.getByRole('img', { name: 'Image unavailable: Plot' })).toBeTruthy()
    expect(harnessBytesDataUrl).not.toHaveBeenCalled()
  })
})
