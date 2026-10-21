import { describe, expect, it } from 'vitest'
import { MAX_DOCUMENTS_PER_TURN, MAX_DOCUMENT_BYTES } from '@/domain/attachments/limits'

import {
  DOCUMENT_ACCEPT,
  documentMimeOf,
  pickDocumentFiles,
} from './documents'

/**
 * The rules a document has to pass at pick time: judged by name and size,
 * before a byte is read; the harness judges the bytes at the send.
 */
describe('picking documents', () => {
  it('knows a document by its name, whatever the picker said its type was', () => {
    expect(documentMimeOf('Report.PDF')).toBe('application/pdf')
    expect(documentMimeOf('notes.md')).toBe('text/markdown')
    expect(documentMimeOf('deck.pptx')).toContain('presentationml')
    expect(documentMimeOf('photo.png')).toBeNull()
    expect(documentMimeOf('README')).toBeNull()
    expect(DOCUMENT_ACCEPT).toContain('.pdf')
    expect(DOCUMENT_ACCEPT).toContain('.xlsx')
  })

  it('accepts by name and size, and names each refusal', () => {
    const { accepted, rejections } = pickDocumentFiles([
      new File(['a'], 'a.pdf'),
      new File(['b'], 'b.exe'),
      new File([new Uint8Array(1)], 'big.docx'),
    ])
    expect(accepted.map((file) => file.name)).toEqual(['a.pdf', 'big.docx'])
    expect(rejections).toEqual([{ filename: 'b.exe', reason: expect.stringContaining('Not a document') }])
  })

  it('refuses a file past the harness ceiling before reading it', () => {
    const big = new File([''], 'big.pdf')
    Object.defineProperty(big, 'size', { value: MAX_DOCUMENT_BYTES + 1 })
    const { accepted, rejections } = pickDocumentFiles([big])
    expect(accepted).toEqual([])
    expect(rejections[0]?.reason).toContain('Over 50 MB')
  })

  it('counts the turn, not the click, against the cap', () => {
    const files = Array.from({ length: 3 }, (_, at) => new File(['x'], `${at}.txt`))
    const { accepted, rejections } = pickDocumentFiles(files, MAX_DOCUMENTS_PER_TURN - 1)
    expect(accepted).toHaveLength(1)
    expect(rejections).toHaveLength(2)
    expect(rejections[0]?.reason).toContain(`at most ${MAX_DOCUMENTS_PER_TURN}`)
  })
})
