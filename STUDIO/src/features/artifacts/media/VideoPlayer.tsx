import 'media-chrome'
import type { CSSProperties } from 'react'

/**
 * The video player.
 *
 * `media-chrome` rather than a hand-written control bar. Playback UI is one of
 * those things that looks like an afternoon and is not: keyboard shortcuts,
 * focus order, screen-reader labelling, scrubbing with a pointer that leaves
 * the bar, buffered ranges, live regions for the time, and the browser
 * differences under all of it. Every one of those is a bug we would find later
 * and fix worse.
 *
 * They are web components, so React renders them as elements and there is no
 * wrapper library in between -- which also means the styling is ours: these are
 * plain custom properties, so the player answers to the same tokens as
 * everything else instead of arriving with a look of its own.
 *
 * ---- What is deliberately absent ----------------------------------------
 *
 * No speed control, no picture-in-picture, no chapter list, no volume slider.
 * This plays a six-second generated clip inside a chat message. Every control
 * that does not serve that is a control in the way of the two that do, and a
 * dense bar of six icons under a small video reads as a media player someone
 * embedded rather than as part of the reply.
 */
const THEME: CSSProperties = {
  '--media-primary-color': 'oklch(1 0 0)',
  '--media-secondary-color': 'oklch(1 0 0 / 22%)',
  '--media-control-background': 'transparent',
  '--media-control-hover-background': 'oklch(1 0 0 / 14%)',
  '--media-range-track-height': '3px',
  '--media-range-thumb-height': '11px',
  '--media-range-thumb-width': '11px',
  '--media-range-thumb-border-radius': '999px',
  '--media-font-family': 'var(--font-sans)',
  '--media-font-size': 'var(--text-micro)',
  '--media-text-color': 'oklch(1 0 0)',
  // The bar floats over the video rather than adding height below it, so the
  // frame stays the aspect ratio the artifact declared.
  '--media-control-bar-display': 'flex',
} as CSSProperties

export function VideoPlayer({
  src,
  poster,
  title,
  autoPlay = false,
}: {
  src: string
  poster?: string
  title: string
  autoPlay?: boolean
}) {
  return (
    <media-controller style={THEME} class="size-full">
      <video
        slot="media"
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        aria-label={title}
        className="size-full bg-black object-contain"
      />

      {/* One big target over the whole frame. Clicking a video to play it is
          the gesture everyone already has; making them find a small button
          first is the thing that makes an embedded player feel fiddly. */}
      <media-poster-image slot="poster" src={poster} />

      <media-control-bar class="w-full">
        <media-play-button />
        <media-time-display />
        <media-time-range />
        <media-duration-display />
        <media-mute-button />
        <media-fullscreen-button />
      </media-control-bar>
    </media-controller>
  )
}
