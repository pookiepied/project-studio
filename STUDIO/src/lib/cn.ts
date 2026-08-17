import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Class composition, with the type roles taught to tailwind-merge.
 *
 * ---- The bug this exists to prevent ---------------------------------------
 *
 * `twMerge` decides which of two conflicting utilities wins by first sorting
 * each class into a group. It knows Tailwind's own names; it does not know
 * ours. `text-ui` is not a font size it has heard of, so it fell through to the
 * only other thing a `text-*` class can be -- a colour -- and landed in the
 * text-colour group alongside `text-muted-foreground`.
 *
 * One group, so one winner. Every call of the shape
 *
 *     cn('text-ui', muted && 'text-muted-foreground')
 *
 * silently emitted `text-muted-foreground` alone. The role class never reached
 * the DOM. The element then inherited the default UI size at the browser's own
 * line-height instead of the role's, which is why sizing looked almost
 * right almost everywhere and exactly right nowhere -- and why the effect moved
 * around as components were edited: it depended on whether a colour happened to
 * share the `cn()` call.
 *
 * ---- Why this is the fix, rather than a rule about how to write components --
 *
 * Declaring the roles as font sizes puts them in the group they actually belong
 * to. Size and colour stop conflicting, so both survive; two *sizes* in one call
 * still collapse to the last one, which is the override behaviour worth keeping.
 * Nothing at a call site changes, and nothing has to be remembered: a component
 * writes the class it means and gets it.
 *
 * The alternative -- forbidding role and colour in the same `cn()` -- is a
 * convention no reviewer can enforce and the compiler cannot see, which is what
 * let this survive three passes over the same symptom.
 *
 * Keep this list in step with the roles in `design/tokens/typography.ts` and the
 * classes in `index.css`. All three describe one scale.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'caption', 'ui', 'body', 'title'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
