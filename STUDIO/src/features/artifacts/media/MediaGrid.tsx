import { useState } from 'react'
import { MEDIA_FRAME } from '@/design/tokens'
import { AnimatedItem } from '@/features/artifacts/ArtifactMotion'
import { MediaFrame } from '@/features/artifacts/media/MediaFrame'
import type { MediaOutput } from '@/domain/artifacts/media'

/**
 * The outputs of one generation, laid out together.
 *
 * ---- Each frame is the shape of its picture --------------------------------
 *
 * A frame is sized from its ratio and the row's height, never stretched to
 * the measure: a 16:9 is wide, a 9:16 is narrow, a square is square. The set
 * stands under one height (`MEDIA_FRAME`): a picture alone is at most
 * `maxHeight` tall, two side by side share a shorter row, and three or four
 * fall into two rows that split the height between them. A row that would
 * run past the column shrinks its frames together, in proportion, so the
 * shapes hold at any width.
 *
 * This replaced rows that always filled the measure, with a tall picture
 * centred over a blurred copy of itself in a wide box. That suited a wide
 * reading column; at Family A's window it made one portrait a full-width
 * block and four squares a column of the screen.
 *
 * ---- Ratios move once ------------------------------------------------------
 *
 * Every frame is reserved at the ratio the call asked for. When a picture
 * loads it reports its real one, and the frame re-shapes to it - once,
 * because a file's dimensions do not change after the first read. The
 * reservation is the guess and the picture is the fact; the grid keeps the
 * fact.
 */
export function MediaGrid({
  outputs,
  expected,
  ratio,
  video,
  title,
  working,
  onOpen,
  onKeep,
}: {
  outputs: readonly MediaOutput[]
  /** How many frames there will be; the ones past `outputs` are reserved. */
  expected: number
  /** The ratio the call asked for, or null for the default. */
  ratio: number | null
  video: boolean
  title: string
  working: boolean
  /** Open the output at this index larger. */
  onOpen?: (index: number) => void
  onKeep?: (output: MediaOutput, index: number) => void
}) {
  const [measured, setMeasured] = useState<Readonly<Record<number, number>>>({})

  const count = Math.max(expected, outputs.length, 1)
  const frames = Array.from({ length: count }, (_, index) => {
    const output = outputs[index] ?? null
    return {
      index,
      output,
      ratio: measured[index] ?? output?.ratio ?? ratio ?? MEDIA_FRAME.defaultRatio,
    }
  })

  const rows: (typeof frames)[] = []
  for (let start = 0; start < frames.length; start += 2) rows.push(frames.slice(start, start + 2))
  const height = rowHeight(count, rows.length)
  const radius = count > 1 ? MEDIA_FRAME.setRadius : MEDIA_FRAME.radius

  return (
    <div className="flex min-w-0 flex-col" style={{ gap: MEDIA_FRAME.gap }}>
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex min-w-0" style={{ gap: MEDIA_FRAME.gap }}>
          {row.map((frame) => (
            <AnimatedItem
              key={frame.index}
              index={frame.index}
              // The basis is the frame's width at the row's height; shrinking
              // is weighted by the basis, so a row too wide for the column
              // narrows every frame by the same factor and keeps each shape.
              style={{ flex: `0 1 ${String(Math.round(height * frame.ratio))}px`, minWidth: 0 }}
            >
              <MediaFrame
                output={frame.output}
                video={video}
                title={count > 1 ? `${title} (${String(frame.index + 1)} of ${String(count)})` : title}
                working={working}
                ratio={frame.ratio}
                radius={radius}
                onRatio={(real) =>
                  setMeasured((previous) =>
                    previous[frame.index] === real ? previous : { ...previous, [frame.index]: real },
                  )
                }
                {...(onOpen !== undefined && frame.output !== null
                  ? { onOpen: () => onOpen(frame.index) }
                  : {})}
                {...(onKeep !== undefined && frame.output !== null
                  ? { onKeep: () => { if (frame.output !== null) onKeep(frame.output, frame.index) },
                      keepLabel: count > 1 ? `Keep ${String(frame.index + 1)} in the library` : 'Keep in the library' }
                  : {})}
              />
            </AnimatedItem>
          ))}
        </div>
      ))}
    </div>
  )
}

/** The height every frame in a row is drawn at, before any shrinking to fit. */
export function rowHeight(count: number, rows: number): number {
  if (count <= 1) return MEDIA_FRAME.maxHeight
  if (rows === 1) return MEDIA_FRAME.pairHeight
  return (MEDIA_FRAME.maxHeight - MEDIA_FRAME.gap * (rows - 1)) / rows
}
