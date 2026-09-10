/**
 * The sentence that stands where a prompt just was.
 *
 * A durable prompt is answered once, by whoever gets there first, and every
 * other viewer is told so rather than shown a failure (ADR 0050 §3.3). The
 * telling is this line: the harness's own sentence for the row that is no
 * longer pending, shown where the card was, styled as information rather than
 * as an error - because losing the race to answer is not a failure of this
 * window, and the queue's rules say the person here deserves to know what
 * happened to the question they were reading.
 *
 * The sentence is borrowed verbatim from the harness, not rewritten here, for
 * the same reason the pairing screen shows the listener's refusal verbatim:
 * one source of the one truth. It arrives with a 404 the answering hook has
 * already translated into "the row is gone" - this component carries no state,
 * renders nothing but the sentence, and clears itself on the hook's timer.
 */
export function AnsweredElsewhere({ sentence }: { readonly sentence: string }) {
  return (
    <p role="status" className="mb-3 max-w-[60ch] text-caption text-muted-foreground">
      {sentence}
    </p>
  )
}
