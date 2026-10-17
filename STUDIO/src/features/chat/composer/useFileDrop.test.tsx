/** @vitest-environment jsdom */
import { useRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFileDrop } from './useFileDrop'
import { useFileDropGuard } from '@/shell/useFileDropGuard'

afterEach(cleanup)
function Surface({ receive }: { receive: (files: readonly File[]) => void }) {
  const frame = useRef<HTMLDivElement>(null)
  const dragging = useFileDrop(frame, receive)
  return <><main data-attachment-drop-zone><p>Conversation</p><div ref={frame}><span>Composer</span></div>
    {dragging ? <p role="status">Drop files to attach</p> : null}</main><aside>Sidebar</aside></>
}
const transfer = (files: File[] = []) => ({ dataTransfer: { types: ['Files'], files, dropEffect: 'none' } })

function GuardedSurface({ receive }: { receive: (files: readonly File[]) => void }) {
  useFileDropGuard()
  return <Surface receive={receive} />
}

describe('file drops into the active conversation', () => {
  it('guards routes with no composer without consuming ordinary text drops', () => {
    function OtherRoute() { useFileDropGuard(); return <p>Settings</p> }
    render(<OtherRoute />)
    expect(fireEvent.drop(window, transfer([new File(['a'], 'a.html')]))).toBe(false)
    expect(fireEvent.drop(window, { dataTransfer: { types: ['text/plain'], files: [] } })).toBe(true)
  })
  it('still receives a drop when the global navigation guard has prevented its default', () => {
    const receive = vi.fn()
    render(<GuardedSurface receive={receive} />)
    const files = [new File(['context'], 'notes.txt')]
    fireEvent.drop(screen.getByText('Conversation'), transfer(files))
    expect(receive).toHaveBeenCalledExactlyOnceWith(files)
  })
  it('accepts multiple files over the transcript as one batch and clears the hint after dropping', () => {
    const receive = vi.fn()
    render(<Surface receive={receive} />)
    const conversation = screen.getByText('Conversation')
    const files = [new File(['one'], 'one.png', { type: 'image/png' }), new File(['two'], 'two.pdf', { type: 'application/pdf' })]
    fireEvent.dragEnter(conversation, transfer())
    expect(screen.getByRole('status').textContent).toBe('Drop files to attach')
    const over = transfer()
    expect(fireEvent.dragOver(conversation, over)).toBe(false)
    expect(over.dataTransfer.dropEffect).toBe('copy')
    expect(fireEvent.drop(conversation, transfer(files))).toBe(false)
    expect(receive).toHaveBeenCalledExactlyOnceWith(files)
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('keeps the hint while crossing children and clears it on leaving the chat', () => {
    render(<Surface receive={vi.fn()} />)
    const chat = screen.getByRole('main')
    const child = screen.getByText('Composer')
    fireEvent.dragEnter(chat, transfer())
    fireEvent.dragEnter(child, transfer())
    fireEvent.dragLeave(chat, transfer())
    expect(screen.getByRole('status')).toBeTruthy()
    fireEvent.dragLeave(child, transfer())
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('blocks file navigation outside the chat without attaching to the wrong surface', () => {
    const receive = vi.fn()
    render(<Surface receive={receive} />)
    const outside = screen.getByText('Sidebar')
    const over = transfer()
    fireEvent.dragOver(outside, over)
    expect(over.dataTransfer.dropEffect).toBe('none')
    expect(fireEvent.drop(outside, transfer([new File(['a'], 'a.txt')]))).toBe(false)
    expect(receive).not.toHaveBeenCalled()
  })
  it('leaves text drags alone and removes listeners when the composer leaves', () => {
    const receive = vi.fn()
    const view = render(<Surface receive={receive} />)
    const text = { dataTransfer: { types: ['text/plain'], files: [] } }
    expect(fireEvent.dragOver(screen.getByText('Composer'), text)).toBe(true)
    expect(fireEvent.drop(screen.getByText('Composer'), text)).toBe(true)
    expect(screen.queryByRole('status')).toBeNull()
    view.unmount()
    expect(fireEvent.drop(window, transfer([new File(['a'], 'a.txt')]))).toBe(true)
    expect(receive).not.toHaveBeenCalled()
  })
})
