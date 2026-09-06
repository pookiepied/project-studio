import { useCallback, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react'
import { COMPOSER, DURATION, EASE_OUT } from '@/design/tokens'

export interface ComposerFieldHandle {
  focus: () => void
}

/**
 * The height animation, on the reshape clock (`SHAPE_MOTION` in `Composer`):
 * the same slow duration and the same ease-out the footer track and the
 * controls' relocation use. A string rather than a Framer value because the
 * height is written imperatively by the measurement below, and it is also
 * suspended imperatively while measuring — see `remeasure`.
 */
const HEIGHT_TRANSITION = `height ${DURATION.slow}s cubic-bezier(${EASE_OUT.join(', ')})`

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
  if (!parent) return element.scrollHeight

  const stand = element.cloneNode(false)
  if (!(stand instanceof HTMLTextAreaElement)) return element.scrollHeight

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
 * `onMultilineChange` reports whether the field is past one line, which is
 * what lets the frame move from a capsule to a rounded box and its controls
 * from beside the text to a footer row under it. The frame cannot work that
 * out for itself — it would have to measure the same element twice.
 *
 * Enter sends, Shift+Enter breaks. IME composition is excluded: during a
 * Japanese or Chinese conversion Enter commits the candidate and must not also
 * send the message.
 */
export function ComposerField({
  value,
  onChange,
  onSubmit,
  onMultilineChange,
  onPaste,
  multiline,
  placeholder,
  handleRef,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onMultilineChange: (multiline: boolean) => void
  /**
   * What to do with a paste that carries files -- a screenshot on the
   * clipboard arrives as one. Text pastes never reach this: the field is a
   * text field first, and only a paste with files in it is an attachment
   * event.
   */
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void
  /**
   * Whether the frame currently holds the footer arrangement. The field is
   * wider there than beside the controls, and the decision has to stay
   * consistent across that difference — see `besideWidth`.
   */
  multiline: boolean
  placeholder: string
  handleRef?: Ref<ComposerFieldHandle>
}) {
  const field = useRef<HTMLTextAreaElement>(null)

  // The width the field has while the controls sit beside it. Multiline is
  // decided against *this* width, not against the width the field has once
  // the controls have dropped to the footer and the text runs the full
  // frame. The two differ by the width of the controls, and that gap is an
  // oscillation waiting to happen: a line that fits the full frame but not
  // the narrower column would flip to the footer, unwrap now that it has
  // room, flip back to the capsule, wrap again, and keep going. Deciding
  // both directions against the one width makes the choice stable — the
  // footer leaves exactly when the line fits where the capsule will put it.
  const besideWidth = useRef<number | null>(null)

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

  // Layout, not effect. This measures the field and writes its height, and a
  // passive effect runs *after* the browser has painted — so a paste showed one
  // frame at the previous height and radius before snapping to the right ones.
  // Running before paint means the first frame the user sees is already correct.
  const remeasure = useCallback(() => {
    const element = field.current
    if (!element) return

    // While the controls are beside the field, remember the width they leave
    // it. This is the width the capsule would give the text again if the
    // footer left, so it is the width the decision below must be made
    // against — recorded here because only this arrangement can measure it.
    //
    // The border-box width, to match what `measure` sets on the stand-in.
    // `clientWidth` excludes the reserved scrollbar gutter and includes the
    // padding, so measuring against it asked the question at a width about
    // 20px narrower than the capsule really offers — the two directions were
    // being decided against different widths, which is the oscillation this
    // whole mechanism exists to prevent.
    if (!multiline) besideWidth.current = element.getBoundingClientRect().width

    // How tall the text is at the width the decision cares about, and how
    // tall it is here. In the footer arrangement those are different widths.
    const here = element.getBoundingClientRect().width
    const natural = measure(element, here)
    const decisive = multiline && besideWidth.current !== null
      ? measure(element, besideWidth.current)
      : natural

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

    // One line plus a pixel of slack, rather than comparing to a hardcoded
    // height: the line box changes with the user's text-size preference.
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 20
    onMultilineChange(decisive > lineHeight * 1.6)
  }, [multiline, onMultilineChange])

  // `value` is the trigger, not an input: the measurement reads the element,
  // which has already re-rendered with the new text by the time this runs.
  useLayoutEffect(remeasure, [value, remeasure])

  // Wrapping depends on the field's width, which typing cannot change but two
  // other things can: the window being resized, and this field's own move
  // between the capsule and the footer. Without this, a resize left the
  // height at what it was until the next keystroke corrected it. Width only
  // — the observer also fires for the height this code writes itself, and
  // those notifications must not loop back into another measure.
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return

    let lastWidth = -1
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0
      if (lastWidth < 0 || Math.abs(next - lastWidth) < 0.5) {
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
      style={{ transition: HEIGHT_TRANSITION }}
      onChange={(event) => onChange(event.target.value)}
      onPaste={onPaste}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
        event.preventDefault()
        onSubmit()
      }}
      className={[
        'studio-selectable block w-full resize-none bg-transparent',
        // `text-ui`, not `text-body`. The composer is a control, and it reads
        // as one: it sits in the chrome, beside buttons, and its text should
        // match the row of controls it shares a capsule with rather than the
        // transcript above it. Under `text-body` it was 11px inside a 52px
        // field while the buttons beside it were 12 — the smallest text in
        // the app, in the largest control in the app.
        'text-ui text-foreground outline-none placeholder:text-muted-foreground/70',
        // No vertical padding: the row centres its children, and padding here
        // would fight that and leave the caret sitting low in the capsule.
        'px-1 py-0',
      ].join(' ')}
    />
  )
}
