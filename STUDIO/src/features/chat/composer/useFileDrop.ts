import { useEffect, useRef, useState, type RefObject } from 'react'
import { isFileDrag } from '@/lib/fileDrag'

/** File-manager drops use the same File objects as the picker and clipboard. */
export function useFileDrop(frame: RefObject<HTMLElement | null>, onFiles: (files: readonly File[]) => void): boolean {
  const [dragging, setDragging] = useState(false)
  const receive = useRef(onFiles)
  useEffect(() => { receive.current = onFiles }, [onFiles])

  useEffect(() => {
    let depth = 0
    const reset = () => { depth = 0; setDragging(false) }
    const inside = (target: EventTarget | null) => {
      const zone = frame.current?.closest('[data-attachment-drop-zone]') ?? frame.current
      return target instanceof Node && zone?.contains(target) === true
    }
    const enter = (event: DragEvent) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      if (inside(event.target)) { depth += 1; setDragging(true) }
    }
    const over = (event: DragEvent) => {
      if (!isFileDrag(event)) return
      // Also prevent file navigation outside the active chat's drop zone.
      event.preventDefault()
      const accepted = inside(event.target)
      if (event.dataTransfer) event.dataTransfer.dropEffect = accepted ? 'copy' : 'none'
      if (accepted) setDragging(true)
      else reset()
    }
    const leave = (event: DragEvent) => {
      if (!inside(event.target)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = (event: DragEvent) => {
      reset()
      if (!isFileDrag(event)) return
      event.preventDefault()
      if (!inside(event.target) || !event.dataTransfer) return
      receive.current(Array.from(event.dataTransfer.files))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      window.removeEventListener('blur', reset)
    }
  }, [frame])
  return dragging
}
