/**
 * The composer's control vocabulary.
 *
 * Every control in the toolbar row is built from these, so the row stays on one
 * baseline and one rhythm no matter how many controls it grows. The geometry is
 * carried over from the previous STUDIO composer — 24px controls, pill labels,
 * round icon buttons, 150ms transitions — because that scale is what makes the
 * row read as a single strip rather than a line of separate buttons.
 *
 * Add a control by composing these. Do not invent a one-off size here.
 */

/** Height of every control in the toolbar row (px). */
export const CONTROL_HEIGHT = 24

/** A run of controls that share the row's baseline. */
export const toolbarGroup = 'flex h-6 min-w-0 items-center gap-1'

/** Circular icon-only control — attach, voice, send. */
export const roundIconButton =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full p-0 leading-none transition-colors duration-150 [&>svg]:block'

/** Labelled control that opens something — model, permission. */
export const pillButton =
  'inline-flex h-6 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0 text-xs leading-none font-medium transition-all duration-150 [&>svg]:block'

/** Text inside a pill, vertically centred against the icon beside it. */
export const pillLabel = 'inline-flex h-full min-w-0 items-center leading-none'

/** Resting and hover treatment for a pill that is not currently open. */
export const pillIdle = 'text-muted-foreground hover:bg-muted hover:text-foreground'

/** A pill whose popover is open, or which holds a non-default value. */
export const pillActive = 'bg-muted text-foreground'

/**
 * Width reserved for a pill's value text.
 *
 * Selecting a longer option must not resize the control: the pill would grow,
 * push every control beside it, and re-flow the composer under the pointer.
 * Reserving the widest label's space up front means the row is stable whatever
 * is chosen — and stays stable when real model and permission names replace the
 * placeholders, provided this stays wide enough for them.
 */
export const pillValueWidth = 'inline-flex justify-start overflow-hidden text-ellipsis whitespace-nowrap w-[104px]'
