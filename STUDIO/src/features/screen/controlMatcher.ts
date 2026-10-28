/**
 * The few spoken words that act at once, before any model hears them (D4).
 *
 * "Stop the computer" said to a model is a request it may get round to after
 * a tool finishes; said to this, it is a button press. So the grammar is
 * strict and whole: the utterance, normalised, must be one of these phrases
 * and nothing else. "Stop that", "what does stop mean here", "yeah, keep
 * going" and anything with more in it go to the model as they always did -
 * a matcher that guessed would act on words the person did not mean as a
 * command, and that is worse than a turn's delay.
 *
 * Only final transcripts are matched, never partial ones. The utterance is
 * still sent afterwards, marked with what was done, so the agent can say so
 * rather than do it again.
 */

export type SpokenControl = 'stop_computer' | 'pause' | 'resume' | 'show_me'

export interface ControlState {
  /** The computer is paused by the person, so "continue" has something to continue. */
  readonly paused: boolean
  /** The screen is shared, so "let me show you" has something to show on. */
  readonly sharing: boolean
}

const STOP = new Set(['stop the computer', 'stop computer', 'stop using my computer', 'stop using the computer', 'stop controlling my computer'])
const PAUSE = new Set(['pause the computer', 'pause computer', 'pause'])
const RESUME = new Set(['resume', 'continue', 'resume the computer', 'carry on', 'go ahead'])
const SHOW = new Set(['let me show you', 'wait let me show you', 'hold on let me show you', 'let me show you something'])

/** Lower case, letters and spaces only, a leading "Studio" and a trailing "please" dropped. */
export function normaliseUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:hey |ok |okay )?studio /, '')
    .replace(/ (?:please|now|right now)$/, '')
    .trim()
}

export function matchControl(text: string, state: ControlState): SpokenControl | null {
  const said = normaliseUtterance(text)
  if (STOP.has(said)) return 'stop_computer'
  if (PAUSE.has(said)) return 'pause'
  // "Continue" means the computer only while the computer is what is paused;
  // otherwise it is conversation, and the model decides what it continues.
  if (RESUME.has(said)) return state.paused ? 'resume' : null
  if (SHOW.has(said)) return state.sharing ? 'show_me' : null
  return null
}
