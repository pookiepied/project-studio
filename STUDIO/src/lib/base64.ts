/**
 * Base64, spoken the same way everywhere bytes cross the webview's JSON seam:
 * attachments out, audio home. `btoa` speaks in characters and overflows on
 * large arguments, so the buffer walks through in chunks - ten megabytes is
 * the largest legal image and this encodes it in a few dozen steps.
 */
export function base64OfBytes(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let at = 0; at < bytes.length; at += step) {
    binary += String.fromCharCode(...bytes.subarray(at, at + step))
  }
  return btoa(binary)
}

/** The way back: audio home from the harness, as bytes a decoder takes. */
export function bytesOfBase64(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at)
  return bytes
}
