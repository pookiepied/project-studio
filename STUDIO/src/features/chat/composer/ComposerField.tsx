import { useCallback, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type Ref } from 'react'
import { COMPOSER, DURATION, EASE_OUT } from '@/design/tokens'
import { cn } from '@/lib/cn'

export interface ComposerFieldHandle {
  focus: () => void
}

/**
 * The height animation. A string rather than a Framer value because the height
 * is written imperatively by the measurement below.
 */
const SHAPE_CURVE = `${DURATION.slow}s cubic-bezier(${EASE_OUT.join(', ')})`
const HEIGHT_TRANSITION = `height ${SHAPE_CURVE}`

/**
 * How tall this text would be at a given width, asked WITHOUT touching the
 * field.
 *
 * The field is animating its own height almost whenever this is called, and
 * the previous approach measured it in place: suspend the transition, set
 * `height: auto`, read `scrollHeight`, put a height back, force a reflow,
 * re-enable the transition. Every step of that is a write to the element the
 * animation is running on, so every keystroke cancelled the run and started a
 * new one from wherever it had reached. It also had to borrow the element's
 * WIDTH to answer the wrap question, mutating the thing being animated a
 * second time for a value that has nothing to do with what is on screen.
 *
 * A stand-in has neither problem. It is a shallow clone, so it carries the
 * same classes and therefore the same font, padding and border box; it is laid
 * out in the same parent, so it inherits the same everything; and it is
 * removed before the frame ends. `scrollHeight` on a fresh element with
 * `height: auto` is simply the content height — no reset needed, because there
 * is no previous height for it to floor against.
 */
function measure(element: HTMLTextAreaElement, width: number): number {
  const parent = element.parentElement
  const stand = element.cloneNode(false)
  if (!parent || !(stand instanceof HTMLTextAreaElement)) return element.scrollHeight

  // `value` is a property, not an attribute, so a clone starts empty.
  stand.value = element.value
  stand.style.position = 'absolute'
  stand.style.top = '0'
  stand.style.left = '0'
  stand.style.visibility = 'hidden'
  stand.style.pointerEvents = 'none'
  stand.style.transition = 'none'
  stand.style.height = 'auto'
  stand.style.overflowY = 'hidden'
  stand.style.width = `${width}px`

  parent.appendChild(stand)
  const height = stand.scrollHeight
  parent.removeChild(stand)
  return height
}

/**
 * The text area.
 *
 * Starts exactly one line tall and grows with its content, animated to each
 * measurement on a monotonic ease — never a spring: a spring on a measured
 * height overshoots, and the caret visibly bounces past where you are typing.
 * (For a while the height was not animated at all, for that reason; the
 * ease-out moves in one direction and stops exactly at the measurement, which
 * is what lets the motion be visible without it ever being wrong.) The
 * measurement suspends the transition while it works — see `remeasure`.
 *
 * Enter sends, Shift+Enter breaks. IME composition is excluded: during a
 * Japanese or Chinese conversion Enter commits the candidate and must not also
 * send the message.
 */
export function ComposerField({
  value,
  onChange,
  onSubmit,
  onPaste,
  placeholder,
  handleRef,
  onKeyDownCapture,
  followEnd = false,
  inlineWidth,
  onMultilineChange,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  /**
   * What to do with a paste that carries files -- a screenshot on the
   * clipboard arrives as one. Text pastes never reach this: the field is a
   * text field first, and only a paste with files in it is an attachment
   * event.
   */
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void
  placeholder: string
  handleRef?: Ref<ComposerFieldHandle>
  /**
   * First look at a key, for the slash picker: true means the key was the
   * picker's (an arrow moving its row, Enter taking one) and the field does
   * nothing further with it. Absent or false, the key is the field's.
   */
  onKeyDownCapture?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** Keeps the end of the text in view, for words arriving rather than typed. */
  followEnd?: boolean
  /** The stable width beside the tools, even while the field occupies a full row. */
  inlineWidth?: () => number
  onMultilineChange?: (multiline: boolean) => void
}) {
  const field = useRef<HTMLTextAreaElement>(null)

  /**
   * The height this element was last told to go to.
   *
   * The guard that stops a keystroke retargeting an animation at the height it
   * is already animating to. Without it every keystroke restarted the run, so
   * a field that had a 400ms move to make never got more than ~120ms of it
   * before starting over: measured mid-sentence, the inline height read 56px
   * while the element was still painting at 18. The text outran its own box
   * and the whole composer stuttered, which is the "flashing" this fixes.
   */
  const committed = useRef<number | null>(null)

  /**
   * How much of each end is dissolving, from how much text lies past it. A
   * proportion rather than a switch, so the fade grows in with the first
   * pixels of scroll and neither end of the draft is ever dimmed.
   */
  const fadeEdges = useCallback(() => {
    const element = field.current
    if (!element) return
    const scrolling = element.style.overflowY === 'auto'
    const past = element.scrollHeight - element.clientHeight - element.scrollTop
    element.style.setProperty('--fade-top', `${scrolling ? Math.min(element.scrollTop, COMPOSER.edgeFade) : 0}px`)
    element.style.setProperty('--fade-bottom', `${scrolling ? Math.max(0, Math.min(past, COMPOSER.edgeFade)) : 0}px`)
  }, [])

  // Layout, not effect. This measures the field and writes its height, and a
  // passive effect runs *after* the browser has painted — so a paste showed one
  // frame at the previous height and radius before snapping to the right ones.
  // Running before paint means the first frame the user sees is already correct.
  const remeasure = useCallback(() => {
    const element = field.current
    if (!element) return

    const width = element.clientWidth || element.getBoundingClientRect().width
    const natural = measure(element, width)
    if (onMultilineChange) {
      const style = getComputedStyle(element)
      const line = Number.parseFloat(style.lineHeight) || 22
      const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
      const decisive = inlineWidth?.() || width
      onMultilineChange(measure(element, decisive) - padding > line * 1.6)
    }
    const clamped = Math.min(natural, COMPOSER.maxHeight)
    element.style.overflowY = natural > COMPOSER.maxHeight ? 'auto' : 'hidden'
    // `stable` reserves the thumb gutter whether it is needed or not. Otherwise
    // appearing a scrollbar on a paste changes the content width mid-type and
    // the text jitters left.
    element.style.scrollbarGutter = 'stable'

    // Only ever written when the target actually moves. A transition that is
    // already heading for this height is left alone to finish.
    if (committed.current !== clamped) {
      committed.current = clamped
      element.style.height = `${clamped}px`
    }
    fadeEdges()
  }, [fadeEdges, inlineWidth, onMultilineChange])

  // `value` is the trigger, not an input: the measurement reads the element,
  // which has already re-rendered with the new text by the time this runs.
  useLayoutEffect(remeasure, [value, remeasure])

  // After the measure above, which is what decides whether the field scrolls.
  useLayoutEffect(() => {
    const element = field.current
    if (!followEnd || !element) return
    element.scrollTop = element.scrollHeight
    fadeEdges()
  }, [value, followEnd, fadeEdges])

  // Appearance changes can alter line height without changing the field's
  // width. The width observer below cannot see that in a fixed-height field.
  useLayoutEffect(() => {
    const observer = new MutationObserver(remeasure)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
    return () => observer.disconnect()
  }, [remeasure])

  // Wrapping depends on the field's width, which typing cannot change but the
  // window being resized can. Without this, a resize left the height at what
  // it was until the next keystroke corrected it. Width only — the observer
  // also fires for the height this code writes itself, and those
  // notifications must not loop back into another measure.
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return

    // The parent reserves tool space after this child's first layout measure.
    // The first delivery must therefore measure the settled width as well.
    let lastWidth: number | null = null
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0
      if (lastWidth !== null && Math.abs(next - lastWidth) < 0.5) {
        lastWidth = next
        return
      }
      lastWidth = next
      remeasure()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [remeasure])

  useImperativeHandle(handleRef, () => ({ focus: () => field.current?.focus() }), [])

  return (
    <textarea
      ref={field}
      rows={1}
      value={value}
      placeholder={placeholder}
      style={{ transition: HEIGHT_TRANSITION, '--composer-edge': `${COMPOSER.edgeFade}px` } as CSSProperties}
      onScroll={fadeEdges}
      // The height the last measure saw was mid-run, so what is left to scroll
      // is only known once the run has finished.
      onTransitionEnd={fadeEdges}
      onChange={(event) => onChange(event.target.value)}
      onPaste={onPaste}
      onKeyDown={(event) => {
        if (onKeyDownCapture?.(event) === true) {
          event.preventDefault()
          return
        }
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
        event.preventDefault()
        onSubmit()
      }}
      className={cn(
        'studio-selectable block w-full resize-none bg-transparent',
        'text-ui text-foreground outline-none placeholder:text-muted-foreground/70',
        'studio-composer-scroll px-2 py-2',
      )}
    />
  )
}
