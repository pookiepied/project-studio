import { isRecord } from '@/lib/guards'

/**
 * What a media artifact's `data` says, read once.
 *
 * Two writers fill the field. The gallery's fence carries one finished
 * picture as `url` (and a video's `poster`), the way a model would emit it.
 * The generation tools carry what the harness holds: every output as a path
 * the harness serves the bytes at, and — while the job runs — how many are
 * expected, so the frames can be reserved before any file exists. Both
 * spellings fold to one list here so the renderer asks one question.
 *
 * ---- Ratios are numbers ------------------------------------------------------
 *
 * A ratio arrives in three spellings: the tool's input (`16:9`), a CSS
 * `aspect-ratio` (`16 / 9`), and exact pixels (`1024x768`). The layout needs a
 * number — it sizes a frame's width from it — so every spelling is parsed here
 * and nothing downstream sees the text. An unparseable ratio is `null`, never a
 * guess: the frame then takes the default, and adopts the real one when the
 * picture loads.
 */

export interface MediaOutput {
  /** Something an `<img>` or `<video>` can take directly. */
  readonly url?: string
  /** A path the harness serves; the frame resolves it to bytes. */
  readonly path?: string
  readonly mimeType?: string
  /** A frame of a video, shown before it plays. */
  readonly poster?: string
  /** This output's own ratio, when known apart from the artifact's. */
  readonly ratio: number | null
}

export interface MediaData {
  readonly prompt?: string
  readonly model?: string
  /** The vendor's own word on progress, while it runs. */
  readonly detail?: string
  /** Why it failed, in the harness's words, when it did. */
  readonly error?: string
  /** The ratio asked for — every frame's reservation until its file lands. */
  readonly ratio: number | null
  readonly outputs: readonly MediaOutput[]
  /** How many outputs are coming; the frames reserved while working. */
  readonly expected: number
}

const RATIO_COLON = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/
const RATIO_SLASH = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/
const RATIO_PIXELS = /^\s*(\d+)\s*x\s*(\d+)\s*$/i

/** `16:9`, `16 / 9` or `1024x768` as width over height; null for anything else. */
export function ratioOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value !== 'string') return null
  const match = RATIO_COLON.exec(value) ?? RATIO_SLASH.exec(value) ?? RATIO_PIXELS.exec(value)
  if (match === null) return null
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? width / height : null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function outputOf(value: unknown): MediaOutput | null {
  if (!isRecord(value)) return null
  const url = text(value['url'])
  const path = text(value['path'])
  if (url === undefined && path === undefined) return null
  return {
    ...(url === undefined ? {} : { url }),
    ...(path === undefined ? {} : { path }),
    ...(text(value['mimeType']) === undefined ? {} : { mimeType: text(value['mimeType']) }),
    ...(text(value['poster']) === undefined ? {} : { poster: text(value['poster']) }),
    ratio: ratioOf(value['aspectRatio']),
  }
}

export function mediaOf(data: Record<string, unknown> | undefined): MediaData {
  const value = data ?? {}
  const ratio = ratioOf(value['aspectRatio']) ?? ratioOf(value['size'])

  const listed = Array.isArray(value['outputs'])
    ? value['outputs'].flatMap((item) => {
        const output = outputOf(item)
        return output === null ? [] : [output]
      })
    : []

  // The single spelling: one picture, or a clip with its poster. A poster
  // without a clip is still a real frame of it and beats an empty box.
  const url = text(value['url'])
  const poster = text(value['poster'])
  const single: readonly MediaOutput[] =
    listed.length === 0 && (url !== undefined || poster !== undefined)
      ? [
          {
            ...(url === undefined ? {} : { url }),
            ...(poster === undefined ? {} : { poster }),
            ratio: null,
          },
        ]
      : []

  const outputs = listed.length > 0 ? listed : single
  const count = value['count']
  const expected =
    typeof count === 'number' && Number.isInteger(count) && count > 0
      ? Math.max(count, outputs.length)
      : Math.max(1, outputs.length)

  return {
    ...(text(value['prompt']) === undefined ? {} : { prompt: text(value['prompt']) }),
    ...(text(value['model']) === undefined ? {} : { model: text(value['model']) }),
    ...(text(value['detail']) === undefined ? {} : { detail: text(value['detail']) }),
    ...(text(value['error']) === undefined ? {} : { error: text(value['error']) }),
    ratio,
    outputs,
    expected,
  }
}
