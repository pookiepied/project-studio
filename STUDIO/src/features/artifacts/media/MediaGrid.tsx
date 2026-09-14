import { useState } from 'react'
import { MEDIA_FRAME } from '@/design/tokens'
import { AnimatedItem } from '@/features/artifacts/ArtifactMotion'
import { MediaFrame } from '@/features/artifacts/media/MediaFrame'
import type { MediaOutput } from '@/domain/artifacts/media'

/**
 * The outputs of one generation, laid out together.
 *
 * ---- The row is always full ------------------------------------------------
 *
 * Rows hold two, and a row is always the whole measure: inside it each
 * frame grows in proportion to its ratio and starts from nothing, so the
 * two share one height by construction - a 16:9 beside a 9:16 is a wide
 * box and a narrow one of the same height - and together they reach both
 * edges. A picture alone on its row takes the whole measure too. Nothing
 * is ever a box beside empty ground, which was the first draft of this and
 * read as a gallery with holes in it.
 *
 * The height cap is the frame's (see `MEDIA_FRAME`): a tall picture's box
 * is as tall as the cap and as wide as its share, and the picture stands
 * in the middle of it over a blurred copy of itself. So a row of two
 * portraits is two full-height boxes side by side, and a portrait alone is
 * one wide box with the picture centred - never a tower, never a gap.
 *
 * ---- Ratios move once ------------------------------------------------------
 *
 * Every frame is reserved at the ratio the call asked for. When a picture
 * loads it reports its real one, and the row re-flows to it - once, because
 * a file's dimensions do not change after the first read. The reservation
 * is the guess and the picture is the fact; the grid keeps the fact.
 */
export function MediaGrid({
  outputs,
  expected,
  ratio,
  video,
  title,
  working,
  onOpen,
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

  return (
    <div className="flex flex-col" style={{ gap: MEDIA_FRAME.gap }}>
      {rows.map((row, rowIndex) => {
        // Shares of the row, summing to one. Flexbox hands out only that
        // fraction of the free space when the factors sum to less - a lone
        // portrait with a factor of 0.56 took half the row and left the rest.
        const total = row.reduce((sum, frame) => sum + frame.ratio, 0)
        return (
          <div key={rowIndex} className="flex w-full min-w-0" style={{ gap: MEDIA_FRAME.gap }}>
            {row.map((frame) => (
              <AnimatedItem
                key={frame.index}
                index={frame.index}
                style={{ flexGrow: frame.ratio / total, flexBasis: 0 }}
              >
                <MediaFrame
                  output={frame.output}
                  video={video}
                  title={count > 1 ? `${title} (${String(frame.index + 1)} of ${String(count)})` : title}
                  working={working}
                  ratio={frame.ratio}
                  onRatio={(real) =>
                    setMeasured((previous) =>
                      previous[frame.index] === real ? previous : { ...previous, [frame.index]: real },
                    )
                  }
                  {...(onOpen !== undefined && frame.output !== null
                    ? { onOpen: () => onOpen(frame.index) }
                    : {})}
                />
              </AnimatedItem>
            ))}
          </div>
        )
      })}
    </div>
  )
}
