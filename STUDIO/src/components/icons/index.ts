import type { ComponentType, CSSProperties } from 'react'
import type { IconSize } from '@/design/tokens'
import type { IconState } from './Icon'

export { Icons } from './registry'

/**
 * The type a stored icon has.
 *
 * Structural on purpose. Two renderers produce marks now — `fromLucide` for
 * the library set and `defineIcon` for the few that have to move inside
 * themselves — and they forward refs to different elements, a span and an svg.
 * Naming either concrete type here would make the registry's own members
 * incompatible with each other, which is a detail no consumer should ever have
 * to know.
 *
 * What every consumer actually needs is the prop contract, and both renderers
 * honour the same one. Anything holding an icon as data — the permission
 * modes, the command palette, the settings sections — names this, which is
 * what let the whole set move to a library and then move part of the way back
 * without those files changing.
 */
export type IconComponent = ComponentType<{
  size?: IconSize
  state?: IconState
  className?: string
  style?: CSSProperties
}>
