import type { View } from '@/app/navigation/views'

export interface DockCategory {
  key: string
  label: string
  items: readonly View[]
}

/**
 * How the dock groups the view registry. The dock is the app's only menu, so
 * this grouping is the whole information architecture — a view that is not
 * listed here is unreachable.
 *
 * Categories carry the semantics from the previous shell: `studio` holds the
 * working surfaces, `spaces` the places work lives, `account` the user's own
 * configuration.
 */
export const DOCK_CATEGORIES: readonly DockCategory[] = [
  { key: 'studio', label: 'Studio', items: ['chat'] },
  { key: 'spaces', label: 'Spaces', items: ['workspace', 'connectors'] },
  { key: 'account', label: 'Account', items: ['settings'] },
]
