import { memo, useRef } from 'react'
import { Markdown, scanSources, type Sources } from '@/features/chat/markdown'
import { segment } from '@/features/chat/streaming/segment'

/**
 * A reply, rendered as it is written.
 *
 * The same component whether or not the message is streaming, which is the
 * point: swapping to a plain `<Markdown>` when the stream ended would replace
 * the whole subtree at the exact moment the reader's eye is at the bottom of
 * it, and every finished code block would re-highlight for nothing.
 *
 * What it does is render blocks instead of one document. `segment` decides
 * where the finished text ends, each block is memoised on its own text, and the
 * blocks are keyed by position — so the block being written keeps its identity
 * when it finishes and the next one starts, rather than unmounting and being
 * replaced by an identical copy.
 *
 * The reveal itself is not here. `useSmoothText` owns that and hands this
 * component ordinary growing text, so nothing below this line knows there is a
 * stream at all.
 */
export function StreamedMarkdown({ text, streaming }: { text: string; streaming: boolean }) {
  const { stable, tail } = segment(text, !streaming)
  const blocks = tail ? [...stable, tail] : stable
  // Citations and their source list usually sit in different blocks, so the
  // list is read off the whole reply and shared. Keyed on its content, so the
  // finished blocks keep their memo until the list itself changes.
  const scanned = scanSources(text)
  const key = JSON.stringify([...scanned])
  const previous = useRef<{ key: string; sources: Sources } | null>(null)
  if (previous.current === null || previous.current.key !== key) previous.current = { key, sources: scanned }
  const sources = previous.current.sources

  return (
    <>
      {blocks.map((block, index) => (
        <Block key={index} text={block} sources={sources} streaming={streaming && index === blocks.length - 1 && tail !== ''} />
      ))}
    </>
  )
}

/**
 * One block.
 *
 * `memo` with the default comparison is the entire optimisation: a finished
 * block's text is identical on every subsequent frame, so React skips it and
 * the markdown underneath is never re-parsed. Without this the cost of a frame
 * grows with the length of the reply, and a long answer stutters worse the
 * further it gets.
 */
const Block = memo(function Block({ text, streaming, sources }: { text: string; streaming: boolean; sources: Sources }) {
  return <Markdown text={text} streaming={streaming} sources={sources} />
})
