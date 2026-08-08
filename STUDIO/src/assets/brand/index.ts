import logoUrl from './logo.png'
import iconSvgUrl from './studio-icon.svg'
import faviconUrl from './favicon.ico'
import appleTouchIconUrl from './apple-touch-icon.png'

/** Typed handles to the bundled brand assets. Import from here, never by path. */
export const brand = {
  logoUrl,
  iconSvgUrl,
  faviconUrl,
  appleTouchIconUrl,
} as const
