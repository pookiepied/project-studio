/**
 * Reading one harness attachment, as bytes.
 *
 * Tool results lose their pictures at persistence by design: Flue stores the
 * bytes in the attachment store and leaves the transcript carrying references
 * of the shape `att_<message id>_<index>`. The model's projection resolves
 * those references back into images; the UI's does not. This module is the
 * UI's resolver — the piece that turns a reference into something an
 * `<img>` can show, by fetching the bytes the harness has been serving all
 * along at `GET /agents/studio/<conversation id>/attachments/<attachment id>`.
 *
 * ---- Why the bytes cross a seam of their own -------------------------------
 *
 * The text transport decodes every body as UTF-8 (`transport.ts`), which is
 * correct for JSON and fatal for a JPEG: a frame read through
 * `service_fetch` arrives corrupted and cannot be repaired on this side. The
 * bytes therefore cross `service_fetch_bytes`, a command beside it that hands
 * back an ArrayBuffer untouched. Inside Tauri that is the only path; outside
 * Tauri there is no seam at all — the conversation client's rule, kept here
 * rather than inventing a second credential story for a browser fetch the
 * harness's own CORS posture refuses anyway. A caller outside Tauri is
 * answered `null`, which the renderers read as "no picture", the same state
 * a picture that is still loading occupies.
 *
 * ---- Caching ---------------------------------------------------------------
 *
 * The route is immutable — the attachment store keys bytes by digest and the
 * response says `max-age=31536000` — so a resolved reference never changes
 * its answer, and successes are cached for the session. In-flight requests
 * are shared, because one transcript can name the same frame in the card,
 * the report and the rail at once.
 *
 * Successes are also bounded in number rather than kept for the life of the
 * window: see `CACHE_LIMIT`. Correctness does not need the bound - the route
 * is immutable - but a window left open for days does.
 *
 * Failures are remembered briefly, not forever. A 404 is as immutable as a
 * success, but the reader cannot tell a 404 from a harness that was still
 * booting, and "forever" would freeze one unlucky early render into the
 * whole session. A minute is the bound: long enough that paging a transcript
 * past a frame the harness cannot produce does not hammer the route, short
 * enough that a harness which comes back is believed the next time the frame
 * is asked for.
 */

import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/platform/tauri'

/** An attachment reference as the transcript carries it: an id and a mime. */
export interface AttachmentReference {
  readonly id: string
  readonly mimeType: string
}

/**
 * Whether a `data` string names an attachment rather than carrying base64.
 *
 * Undecidable from the alphabet alone is false here: `_` is not a base64
 * character, so a value that starts `att_` cannot be inline bytes, and real
 * base64 cannot accidentally look like one. The prefix is the store's own
 * convention (`att_<message id>_<index>`).
 */
export function isAttachmentReference(data: string): boolean {
  return data.startsWith('att_')
}

/**
 * How the bytes of one attachment arrive. A path in, an ArrayBuffer out;
 * refusals and transport failures reject and are folded into `null` by the
 * resolver, which is the only part renderers see.
 */
export type AttachmentBytes = (path: string) => Promise<ArrayBuffer>

/**
 * The transport, overridable for tests. `null` means the real one, which is
 * the Tauri command; every production caller reads through the cache and
 * never sees this seam at all.
 */
let bytesTransport: AttachmentBytes | null = null

/** Installs a transport, for tests. Pass `null` to restore the real one. */
export function setAttachmentBytesTransport(transport: AttachmentBytes | null): void {
  bytesTransport = transport
}

/** The attachment route under the studio agent, which the harness mounts. */
function attachmentPath(conversationId: string, attachmentId: string): string {
  return `/agents/studio/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}`
}

/**
 * The bytes as they cross the invoke boundary, in every shape they can.
 *
 * The ordinary answer is an `ArrayBuffer`: a raw `tauri::ipc::Response` is
 * served as `application/octet-stream`, and Tauri's injected IPC script sends
 * exactly that content type down `response.arrayBuffer()`. That is the path
 * on this platform and it is the one to expect.
 *
 * The other two shapes are the fallback. When the custom-protocol IPC is
 * blocked, Tauri says so on the console and reverts to the postMessage
 * interface, where the same bytes arrive serialised - a view, or a plain
 * array of numbers. Insisting on `ArrayBuffer` there would turn a working
 * harness into every frame silently missing, with nothing on screen to say
 * why. Reading all three costs four lines and removes that failure entirely.
 */
function bufferOf(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) return value
  if (ArrayBuffer.isView(value)) {
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    // Copied rather than handing back the underlying buffer, which may be
    // larger than the view and would carry bytes that are not the frame's.
    return view.slice().buffer
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'number')) {
    return Uint8Array.from(value).buffer
  }
  return null
}

async function throughTauri(path: string): Promise<ArrayBuffer> {
  const answer: unknown = await invoke('service_fetch_bytes', {
    service: 'harness',
    path,
  })
  const bytes = bufferOf(answer)
  if (bytes === null) {
    throw new Error('The attachment did not arrive as bytes.')
  }
  return bytes
}

/**
 * An ArrayBuffer as base64, for a `data:` URL the CSP already permits.
 *
 * Chunked because `String.fromCharCode` is a plain call: one spread of a
 * hundred-thousand-byte frame would ride the argument limit, and the chunks
 * cost nothing measurable at frame sizes.
 */
function base64Of(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  const chunkSize = 0x8000
  for (let start = 0; start < view.length; start += chunkSize) {
    binary += String.fromCharCode(...view.subarray(start, start + chunkSize))
  }
  return btoa(binary)
}

const resolved = new Map<string, string>()
const failed = new Map<string, number>()
const pending = new Map<string, Promise<string | null>>()

/** How long a failed lookup stays remembered before the route is asked again. */
const RETRY_AFTER_MS = 60_000

/**
 * How many resolved frames are kept.
 *
 * The cache was unbounded, which is right for correctness - the route is
 * immutable, so a resolved reference never needs asking again - and wrong for
 * a window that stays open for days. Each frame is a base64 `data:` URL of a
 * 960-pixel JPEG, on the order of a hundred kilobytes once encoded, and a long
 * browsing conversation produces one per acting call. A few hundred of those
 * is tens of megabytes held for a picture nobody has scrolled back to in
 * hours.
 *
 * Evicted oldest-first, which is the right order here rather than a guess:
 * the surfaces that show frames all look at the newest, and the older ones are
 * reachable only by deliberately scrolling back - a moment where paying for
 * the fetch again is fine. The number is generous enough that ordinary reading
 * never evicts anything.
 */
const CACHE_LIMIT = 120

/**
 * The mime type a frame may claim, narrowed to what it is.
 *
 * The value travels from the tool result through the attachment store, and a
 * tool result is not ours - an MCP server we did not write can put any string
 * there. It ends up inside a `data:` URL, and while an `<img>` will not
 * execute `text/html` no matter what the header says, a URL built from
 * unvalidated input is the kind of thing that is safe until the day someone
 * renders it somewhere else. These are pictures; anything that does not say
 * so is shown as the JPEG the browser capability actually produces.
 */
export function pictureMime(mimeType: string): string {
  return /^image\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : 'image/jpeg'
}

/** Remembers one resolution, evicting the oldest when the cache is full. */
function remember(key: string, url: string): void {
  // Insertion order is Map's own, so the first key is the oldest.
  if (resolved.size >= CACHE_LIMIT) {
    const oldest = resolved.keys().next()
    if (!oldest.done) resolved.delete(oldest.value)
  }
  resolved.set(key, url)
}

/**
 * The `data:` URL for one attachment, or `null` while it cannot be shown.
 *
 * `null` is the answer for every failure — the harness not running, a
 * credential gone stale, an attachment that does not exist — and also for
 * "not yet". A renderer shows its card without the picture in either case;
 * none of them is a state worth a broken image glyph, and none of them is
 * the caller's to distinguish.
 */
export function attachmentDataUrl(
  conversationId: string,
  attachment: AttachmentReference,
): Promise<string | null> {
  const key = `${conversationId}/${attachment.id}`
  const settled = resolved.get(key)
  if (settled !== undefined) return Promise.resolve(settled)
  const failedAt = failed.get(key)
  if (failedAt !== undefined) {
    if (Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve(null)
    failed.delete(key)
  }
  const inFlight = pending.get(key)
  if (inFlight !== undefined) return inFlight

  const request = (async (): Promise<string | null> => {
    if (!isTauri() && bytesTransport === null) return null
    try {
      const transport = bytesTransport ?? throughTauri
      const bytes = await transport(attachmentPath(conversationId, attachment.id))
      const url = `data:${pictureMime(attachment.mimeType)};base64,${base64Of(bytes)}`
      remember(key, url)
      return url
    } catch {
      // Remembered, not forever: see the caching note. The null is the
      // answer for now, and the route is left alone until the bound passes.
      failed.set(key, Date.now())
      return null
    } finally {
      pending.delete(key)
    }
  })()
  pending.set(key, request)
  return request
}
