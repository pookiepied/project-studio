import type { DetailedHTMLProps, HTMLAttributes } from 'react'

/**
 * `media-chrome` ships web components, and React needs to be told they exist.
 *
 * Declared narrowly -- only the elements actually used -- rather than with a
 * catch-all index signature. A catch-all would silence typos in every custom
 * element name in the app, which is the one thing the type system is useful for
 * here.
 */
type MediaElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  class?: string
  src?: string
  /** Seconds of inactivity before the control bar fades. */
  autohide?: string
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'media-controller': MediaElement
      'media-control-bar': MediaElement
      'media-play-button': MediaElement
      'media-time-range': MediaElement
      'media-time-display': MediaElement
      'media-duration-display': MediaElement
      'media-mute-button': MediaElement
      'media-fullscreen-button': MediaElement
      'media-poster-image': MediaElement
    }
  }
}
