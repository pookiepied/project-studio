import { useState } from 'react'
import { MEDIA_FRAME } from '@/design/tokens'
import { AnimatedItem } from '@/features/artifacts/ArtifactMotion'
import { MediaFrame } from '@/features/artifacts/media/MediaFrame'
import type { MediaOutput } from '@/domain/artifacts/media'

/**
 * The outputs of one generation, laid out together.
 *
 * ---- One rule for one picture and for four --------------------------------
 *
 * A frame's width is what its ratio allows under the height cap: a landscape
 * takes the whole measure, a portrait takes `maxHeight × ratio` and stands
 * beside empty space rather than becoming a tower. That is the whole rule
 * for a single picture, and the grid is the same rule applied to rows.
 *
 * Rows hold two. Inside a row each frame grows in proportion to its ratio
 * and starts from nothing, so the two share one height by construction —
 * a 16:9 beside a 9:16 is a wide box and a narrow one of the same height,
 * not two boxes of the same width with one cropped. The cap still applies
 * per frame, which is what keeps a pair of portraits from filling the
 * measure at the height of the window.
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
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex w-full min-w-0" style={{ gap: MEDIA_FRAME.gap }}>
          {row.map((frame) => (
            <AnimatedItem
              key={frame.index}
              index={frame.index}
              style={{
                flexGrow: frame.ratio,
                flexBasis: 0,
                maxWidth: `min(100%, ${String(Math.round(MEDIA_FRAME.maxHeight * frame.ratio))}px)`,
              }}
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
      ))}
    </div>
  )
}
