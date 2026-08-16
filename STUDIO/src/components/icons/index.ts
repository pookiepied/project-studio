export { IconStateProvider, IconStateContext, type IconState } from './Icon'
export { fromLucide, type LucideIconProps } from './fromLucide'
export { Icons, type IconConcept } from './registry'
export { ProviderMark, type ProviderId } from './ProviderMark'

/**
 * The type a stored icon has.
 *
 * Anything holding an icon as data -- the permission modes, the command
 * palette, the settings sections -- names this rather than the renderer that
 * happens to produce it, which is what let the marks be swapped for a library
 * without touching those files.
 */
export type { LucideIconComponent as IconComponent } from './fromLucide'
