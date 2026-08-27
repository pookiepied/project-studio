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
 * `default` is a real value beside the levels, not one of them and not their
 * absence: it means the provider's own behaviour. A model with no reasoning
 * support offers no levels at all, and the control is absent rather than
 * present and inert - so "off" is not a choice either; it is what the run
 * does for an unasked level, and no control offers it.
 */
export const REASONING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type ReasoningLevel = (typeof REASONING_LEVELS)[number]

export const REASONING_CHOICES = ['default', ...REASONING_LEVELS] as const

export type ReasoningChoice = 'default' | ReasoningLevel

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
