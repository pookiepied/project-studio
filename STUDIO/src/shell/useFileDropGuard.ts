import { useEffect } from 'react'
import { isFileDrag } from '@/lib/fileDrag'

/** HTML file drops must never navigate the desktop webview, on any route. */
export function useFileDropGuard() {
  useEffect(() => {
    const prevent = (event: DragEvent) => { if (isFileDrag(event)) event.preventDefault() }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])
}
