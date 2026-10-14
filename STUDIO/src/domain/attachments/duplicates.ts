/** Exact content comparison works on insecure browser origins too, without Web Crypto. */
export async function matchingDocument(
  candidate: File,
  held: readonly File[],
): Promise<File | null> {
  if (held.includes(candidate)) return candidate
  const possible = held.filter((file) => file.size === candidate.size)
  if (possible.length === 0) return null
  const bytes = new Uint8Array(await candidate.arrayBuffer())
  for (const file of possible) {
    const existing = new Uint8Array(await file.arrayBuffer())
    if (bytes.length === existing.length && bytes.every((byte, index) => byte === existing[index])) {
      return file
    }
  }
  return null
}

export const DUPLICATE_ATTACHMENT_NOTE = 'Already attached to this message.'
