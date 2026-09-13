/**
 * One event of a conversation's stream, as the SSE channel delivers it.
 */

import { isRecord } from '@/lib/guards'
import { text } from './guards'

/*
 * The wire shapes of ADR 0045's reading half, mirrored by hand like every
 * other contract in this file. Two sources meet here:
 *
 * - Rust's `StreamEvent` (`src-tauri/src/services/stream.rs`), which is what
 *   actually arrives over a Tauri channel: a kind-tagged kebab-case union in
 *   which every variant carries the offset to resume from. The offset is
 *   opaque — `-1`, or `seq_batch` pairs — and is carried, parsed never.
 * - Flue's conversation content: the updates view's chunks and the history
 *   view's snapshot. That mirror grew past facts into content when rendering
 *   arrived, and now lives in `conversation-chunks.ts`, re-exported here so
 *   the boundary stays "import from index, not from the files". When a
 *   component needs to read what a chunk SAYS, extend that module — not this
 *   one.
 */

/** The mirror of Rust's `StreamEvent`, exactly as it serializes. */
export type WireStreamEvent =
  | {
      readonly kind: 'frame'
      readonly offset: string
      readonly event?: string | null
      readonly data: string
    }
  | { readonly kind: 'up-to-date'; readonly offset: string }
  | { readonly kind: 'keep-alive'; readonly offset: string }
  | { readonly kind: 'ended'; readonly offset: string }

export function parseWireStreamEvent(value: unknown): WireStreamEvent | null {
  if (!isRecord(value)) return null
  const offset = text(value['offset'])
  if (offset === null) return null

  switch (value['kind']) {
    case 'up-to-date':
      return { kind: 'up-to-date', offset }
    case 'keep-alive':
      return { kind: 'keep-alive', offset }
    case 'ended':
      return { kind: 'ended', offset }
    case 'frame': {
      if (typeof value['data'] !== 'string') return null
      const event = value['event']
      return {
        kind: 'frame',
        offset,
        data: value['data'],
        ...(typeof event === 'string' ? { event } : {}),
      }
    }
    default:
      return null
  }
}
