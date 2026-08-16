/**
 * The composer's control vocabulary.
 *
 * Every control in the toolbar row is built from these, so the row stays on one
 * baseline and one rhythm no matter how many controls it grows.
 *
 * Two changes from the previous vocabulary, both for the same reason — the row
 * read as a strip of tiny web widgets rather than a Mac toolbar:
 *
 *   - **Controls are 28px, not 24.** 24px is below every desktop platform's
 *     minimum comfortable target, and it made the icon buttons feel like they
 *     needed aiming. 28 with a 14px glyph is the AppKit toolbar proportion.
 *   - **Pills no longer reserve a fixed 104px for their value.** That was there
 *     to stop the row reflowing when a longer option was picked, which is the
 *     right instinct and the wrong fix: "Opus 5" in a 104px box is a control
 *     that looks broken. `StableLabel` solves it properly.
 *
 * Add a control by composing these. Do not invent a one-off size here.
 */

/** Height of every control in the toolbar row (px). */
export const CONTROL_HEIGHT = 28

/** A run of controls that share the row's baseline. */
export const toolbarGroup = 'flex h-7 min-w-0 items-center gap-0.5'

/**
 * Circular icon-only control — attach, voice, send.
 *
 * Round rather than rounded-square because these are single-purpose verbs with
 * no label; the shape is what distinguishes them from the labelled pills
 * beside them at a glance.
 */
export const roundIconButton =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-full p-0 leading-none outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring [&>svg]:block'

/**
 * Labelled control that opens something — model, permission.
 *
 * A true capsule. These sit inline with the round icon buttons, and a rounded
 * rectangle next to a circle reads as two unrelated control families sharing a
 * row. `rounded-full` is also the one radius that is trivially concentric with
 * anything — a capsule never fights the corner it sits inside.
 */
export const pillButton =
  'inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0 text-xs leading-none font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring [&>svg]:block'

/** Text inside a pill, vertically centred against the icon beside it. */
export const pillLabel = 'inline-flex h-full min-w-0 items-center truncate leading-none'

/** Resting and hover treatment for a pill that is not currently open. */
export const pillIdle = 'text-muted-foreground hover:bg-muted hover:text-foreground'

/** A pill whose popover is open. */
export const pillActive = 'bg-muted text-foreground'

/**
 * Reserving width for a control whose value changes: see `StableLabel`.
 *
 * The rule this replaced was a hardcoded `w-[104px]` on every pill's value,
 * added to stop the toolbar reflowing when a longer option was picked. The
 * instinct was right and the fix was not — it is both too wide for a short
 * label and a silent truncation the day a longer one arrives. `StableLabel`
 * derives the width from the actual candidates instead.
 *
 * The layout classes for that live in the component, not here: they only work
 * as a set, and exporting them separately invites composing them with a
 * conflicting `display`, which is exactly the bug that shipped once already.
 */
