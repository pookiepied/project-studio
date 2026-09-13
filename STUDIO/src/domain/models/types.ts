/**
 * The reasoning vocabulary - the one place it is declared.
 *
 * `REASONING_LEVELS` mirrors Pi's `ThinkingLevel` union (which the harness
 * contract re-exports), so what the composer shows is what the runtime can
 * ask for: six levels, of which `xhigh` and `max` only ever reach a request
 * for models whose provider names them. The old webview list had five values
 * and no `xhigh`; two spellings of one concept is how "the UI said max, the
 * wire said something else" starts, so the reconciliation lives here.
 *
 * There is no "default" choice. The dial offers only the levels a model
 * actually supports and rests on medium; a stored row that still carries the
 * old "default" reads as absent (null) and the harness resolves it to the
 * resting level on the run. A model with no reasoning support offers no
 * levels at all, and the control is absent rather than present and inert -
 * so "off" is not a choice either.
 */
const REASONING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type ReasoningLevel = (typeof REASONING_LEVELS)[number]

export type ReasoningChoice = ReasoningLevel

/**
 * The dial's resting level for one model's supported levels.
 *
 * Medium when the model supports it, otherwise the nearest supported level
 * in `REASONING_LEVELS` order, preferring the lower one on a tie. The anchor
 * is medium itself, not the midpoint of the model's own list, so a model
 * exposing `xhigh` and `max` still rests at the nearer of the two rather
 * than at a quietly more expensive high.
 */
export function restingReasoningLevel(supported: readonly ReasoningLevel[]): ReasoningLevel {
  if (supported.includes('medium')) return 'medium'
  const first = supported[0]
  if (first === undefined) return 'medium'
  const order = REASONING_LEVELS
  const mediumIndex = order.indexOf('medium')
  let best: ReasoningLevel = first
  let bestDistance = Math.abs(order.indexOf(best) - mediumIndex)
  for (const candidate of supported) {
    const distance = Math.abs(order.indexOf(candidate) - mediumIndex)
    if (
      distance < bestDistance ||
      (distance === bestDistance && order.indexOf(candidate) < order.indexOf(best))
    ) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/** Display copy for a level, shown in the reasoning control. */
export const REASONING_LEVEL_NOTES: readonly { id: ReasoningLevel; name: string; note: string }[] =
  [
    { id: 'minimal', name: 'Minimal', note: 'Answer straight away.' },
    { id: 'low', name: 'Low', note: 'A moment of thought.' },
    { id: 'medium', name: 'Medium', note: 'The everyday balance.' },
    { id: 'high', name: 'High', note: 'Work the problem through.' },
    { id: 'xhigh', name: 'X-high', note: 'Think harder than high.' },
    { id: 'max', name: 'Max', note: 'Take as long as it needs.' },
  ]
