import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { motion, useDragControls } from 'framer-motion'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { Deferred, lazyNamed } from '@/components/state'
import { useMediaSource } from '@/features/artifacts/media/source'
import { MaskCanvas } from '@/features/artifacts/media/MaskCanvas'
import {
  EDIT_PROMPTS,
  EDIT_RATIOS,
  maskDataUrl,
  useMediaEditing,
  wireOfDataUrl,
  type MaskStroke,
  type MediaViewerHandle,
  type PreparedEdit,
  type ViewerSpec,
} from '@/features/artifacts/media/edits'
import { MAX_IMAGE_BYTES_PER_TURN } from '@/domain/attachments/limits'
import type { MediaOutput } from '@/domain/artifacts/media'
import type { TurnImageWire } from '@/platform/harness'
import { cn } from '@/lib/cn'
import { SHELL } from '@/design/tokens'

const VideoPlayer = lazyNamed(
  () => import('@/features/artifacts/media/VideoPlayer'),
  'VideoPlayer',
)

/**
 * A generated picture, opened: the picture as large as it fits, a few dark
 * pills over its top edge, and one tool bar under it.
 *
 * ---- The composer stays --------------------------------------------------
 *
 * On the chat page the viewer is laid over the transcript and the composer
 * stays where it is, under the tool bar (`composer`). Whatever is typed there
 * while the picture is open goes with the picture: attached, and - when a
 * tool has marked part of it - with the marks as a second image and the
 * words framed as an edit of that part (`prepare`, called by the page's
 * send). So Markup and Comment have no field of their own; the composer is
 * the field. Without a composer (the overlay the showcase opens), the two
 * take an inline field instead.
 *
 * ---- One bar --------------------------------------------------------------
 *
 * Markup, Comment, Remove BG, Erase, Resize sit in one bar with a grip to
 * move it, as in the reference. The tool in use is lit; its own controls
 * (undo, the ratios, Erase's apply) follow a divider in the same bar rather
 * than replacing it, so the bar never changes into something else under the
 * pointer. Clicking the lit tool again puts it down. No prompt caption: what
 * was asked for is on the transcript's row, and the picture is the point.
 *
 * `edits.ts` says why every edit is a message and not a feature.
 */
export function MediaViewer({
  spec,
  onClose,
  composer,
  handle,
}: {
  spec: ViewerSpec
  onClose: () => void
  /** True where the page's composer stands under the viewer and is its field. */
  composer: boolean
  handle?: Ref<MediaViewerHandle>
}) {
  const { output, title, model, video, onKeep } = spec
  const src = useMediaSource(output, video)
  const poster = output.poster
  const editing = useMediaEditing()
  const [tool, setTool] = useState<Tool | null>(null)
  const [strokes, setStrokes] = useState<readonly MaskStroke[]>([])
  const [instruction, setInstruction] = useState('')
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  // The clip's own shape, once it is known: the box is drawn at it, so the
  // controls sit on the picture and not across empty space beside it.
  const [clipRatio, setClipRatio] = useState<number | null>(null)
  const bounds = useRef<HTMLDivElement>(null)
  const drag = useDragControls()

  const editable = editing !== null && !video && src !== null && src.startsWith('data:')
  const painting = tool === 'markup' || tool === 'comment' || tool === 'erase'

  // A new picture starts with nothing marked.
  useEffect(() => {
    setTool(null)
    setStrokes([])
    setInstruction('')
    setNote(null)
    setClipRatio(null)
  }, [output])

  // On the page there is no overlay to hear Escape: a tool down first, then the viewer.
  useEffect(() => {
    if (!composer) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      if (tool !== null) pick(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const pick = (next: Tool | null) => {
    setTool((current) => (current === next ? null : next))
    setStrokes([])
    setNote(null)
  }

  const prepare = (text: string): PreparedEdit => {
    const name = fileNameOf(output)
    const picture = src === null ? null : wireOfDataUrl(src, name)
    if (picture === null) return { refusal: 'This picture is not in a format that can be sent back for an edit.' }
    const images: TurnImageWire[] = [picture]
    let words = text
    if (painting && strokes.length > 0) {
      const mask = image === null ? null : maskDataUrl(strokes, image.naturalWidth, image.naturalHeight)
      const wire = mask === null ? null : wireOfDataUrl(mask, `mask-${name.replace(/\.[^.]+$/, '')}.png`)
      if (wire === null) return { refusal: 'The marked area could not be drawn.' }
      images.push(wire)
      words = tool === 'erase' && text.trim() === ''
        ? EDIT_PROMPTS.erase
        : tool === 'comment' ? EDIT_PROMPTS.point(text) : EDIT_PROMPTS.area(text)
    }
    const bytes = images.reduce((sum, one) => sum + Math.floor((one.data.length * 3) / 4), 0)
    if (bytes > MAX_IMAGE_BYTES_PER_TURN) return { refusal: 'This picture is too large to send back for an edit.' }
    return { text: words, images }
  }

  useImperativeHandle(handle, () => ({ prepare }))

  const send = (text: string) => {
    if (editing === null || sending) return
    const prepared = prepare(text)
    if ('refusal' in prepared) {
      setNote(prepared.refusal)
      return
    }
    setSending(true)
    setNote(null)
    void editing.send(prepared.text, prepared.images).then(
      (receipt) => {
        setSending(false)
        if (receipt.ok) onClose()
        else setNote('The edit could not be sent.')
      },
      () => {
        setSending(false)
        setNote('The edit could not be sent.')
      },
    )
  }

  const closeFromBackground = (event: React.PointerEvent) => {
    if (event.target === event.currentTarget && !painting) onClose()
  }

  return (
    <div ref={bounds} className="flex size-full min-h-0 flex-col items-center gap-3" onPointerDown={closeFromBackground}>
      <div
        className="flex w-full shrink-0 items-center gap-1.5"
        // On the page the row stands in the band the window's header
        // occupies, so the model and the controls sit at the very top.
        style={composer ? { height: SHELL.topStrip.height } : undefined}
        onPointerDown={closeFromBackground}
      >
        {model ? <span className={PILL_TEXT}>{model}</span> : null}
        <span className="ml-auto flex items-center gap-1.5">
          {keepButton(onKeep, video)}
          <IconButton label="Close" onClick={onClose} tooltipSide="bottom" className={PILL_BUTTON}>
            <Icons.close />
          </IconButton>
        </span>
      </div>

      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center [container-type:size]" onPointerDown={closeFromBackground}>
        {video && src ? (
          <div
            className="relative overflow-hidden rounded-[18px] bg-black"
            // As large as fits: the full width, or the full height at the
            // clip's shape, whichever is smaller.
            style={{
              aspectRatio: String(clipRatio ?? output.ratio ?? 16 / 9),
              width: `min(100cqw, ${String(clipRatio ?? output.ratio ?? 16 / 9)} * 100cqh)`,
            }}
          >
            <Deferred
              label="Video player"
              {...(poster
                ? { fallback: <img src={poster} alt="" aria-hidden className="size-full object-cover opacity-60" /> }
                : {})}
            >
              <VideoPlayer src={src} poster={poster} title={title} autoPlay onRatio={setClipRatio} />
            </Deferred>
          </div>
        ) : (
          <>
            <img
              ref={setImage}
              src={src ?? poster}
              alt={title}
              draggable={false}
              className="max-h-full max-w-full rounded-[18px] object-contain"
            />
            {painting ? (
              <MaskCanvas
                image={image}
                strokes={strokes}
                onStrokes={setStrokes}
                brush={tool === 'comment' ? PIN : BRUSH}
                pin={tool === 'comment'}
              />
            ) : null}
          </>
        )}
      </div>

      {note !== null ? <p className="shrink-0 text-caption text-white/80" role="status">{note}</p> : null}

      {editable ? (
        <motion.div
          drag
          dragControls={drag}
          dragListener={false}
          dragMomentum={false}
          dragConstraints={bounds}
          role="toolbar"
          aria-label="Edit the image"
          className="flex max-w-full shrink-0 flex-wrap items-center gap-0.5 rounded-[14px] bg-[#262626]/95 p-1 shadow-lifted ring-1 ring-white/[0.07] backdrop-blur-md"
        >
          <span
            aria-hidden
            onPointerDown={(event) => drag.start(event)}
            className="grid cursor-grab touch-none grid-cols-2 gap-[3px] px-2 py-1.5 active:cursor-grabbing"
          >
            {Array.from({ length: 6 }, (_, at) => <span key={at} className="size-[3px] rounded-full bg-white/45" />)}
          </span>
          <ToolButton label="Markup" icon={<Icons.inkPen />} lit={tool === 'markup'} disabled={sending} onClick={() => pick('markup')} />
          <ToolButton label="Comment" icon={<Icons.chat />} lit={tool === 'comment'} disabled={sending} onClick={() => pick('comment')} />
          <ToolButton label="Remove BG" icon={<Icons.image />} disabled={sending} onClick={() => send(EDIT_PROMPTS.removeBackground)} />
          <ToolButton label="Erase" icon={<Icons.inkErase />} lit={tool === 'erase'} disabled={sending} onClick={() => pick('erase')} />
          <ToolButton label="Resize" icon={<Icons.expand />} lit={tool === 'resize'} disabled={sending} onClick={() => pick('resize')} />

          {tool === 'resize' ? (
            <>
              <Divider />
              {EDIT_RATIOS.map((ratio) => (
                <ToolButton key={ratio} label={ratio} disabled={sending} onClick={() => send(EDIT_PROMPTS.ratio(ratio))} />
              ))}
            </>
          ) : null}

          {painting ? (
            <>
              <Divider />
              <IconButton
                label={tool === 'comment' ? 'Remove the spot' : 'Undo the last stroke'}
                onClick={() => setStrokes((current) => current.slice(0, -1))}
                disabled={strokes.length === 0}
                className="rounded-lg text-white/85 hover:bg-white/10 [&_.studio-icon]:text-white/85"
              >
                <Icons.inkUndo />
              </IconButton>
              {tool === 'erase' ? (
                <ToolButton label="Erase marked" primary disabled={sending || strokes.length === 0} onClick={() => send('')} />
              ) : composer ? (
                <span className="px-2 text-caption text-white/55">
                  {strokes.length === 0
                    ? tool === 'comment' ? 'Click a spot' : 'Paint an area'
                    : 'Then describe it below'}
                </span>
              ) : (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (instruction.trim() !== '' && strokes.length > 0) send(instruction)
                  }}
                >
                  <input
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    placeholder={tool === 'comment' ? 'What should change here?' : 'What should the marked area become?'}
                    aria-label="Describe the change"
                    className="h-8 w-56 rounded-lg bg-white/10 px-2.5 text-caption text-white outline-none placeholder:text-white/45"
                  />
                  <ToolButton label="Send" primary submit disabled={sending || strokes.length === 0 || instruction.trim() === ''} />
                </form>
              )}
            </>
          ) : null}
        </motion.div>
      ) : null}
    </div>
  )
}

type Tool = 'markup' | 'comment' | 'erase' | 'resize'

/** The brush, and the comment's spot, in screen pixels. */
const BRUSH = 28
const PIN = 44

function keepButton(onKeep: (() => void) | undefined, video: boolean): ReactNode {
  if (onKeep === undefined || video) return null
  return (
    <IconButton label="Keep in the library" onClick={onKeep} tooltipSide="bottom" className={PILL_BUTTON}>
      <Icons.keep />
    </IconButton>
  )
}

export function fileNameOf(output: MediaOutput): string {
  const path = output.path ?? ''
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name === '' ? 'image.png' : name
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-white/12" />
}

function ToolButton({
  label,
  icon,
  onClick,
  lit = false,
  disabled = false,
  submit = false,
  primary = false,
}: {
  label: string
  icon?: ReactNode
  onClick?: () => void
  lit?: boolean
  disabled?: boolean
  submit?: boolean
  primary?: boolean
}) {
  return (
    <button
      type={submit ? 'submit' : 'button'}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={icon === undefined || primary ? undefined : lit}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-caption transition-colors duration-fast',
        'disabled:pointer-events-none disabled:opacity-45 [&_.studio-icon]:size-[1.1em]',
        primary
          ? 'bg-accent text-white hover:bg-accent/85'
          : cn('text-white/85 hover:bg-white/10 [&_.studio-icon]:text-white/85', lit && 'bg-white/12 text-white'),
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/** A control floating over the picture: a small dark pill. */
const PILL_BUTTON =
  'rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70 [&_.studio-icon]:text-white'
const PILL_TEXT =
  'flex h-8 items-center rounded-full bg-black/55 px-3 text-caption text-white/85 backdrop-blur-sm'
