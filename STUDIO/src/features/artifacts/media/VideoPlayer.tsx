import 'media-chrome'
import type { SyntheticEvent } from 'react'

/**
 * The video player.
 *
 * `media-chrome` supplies the behaviour — keyboard shortcuts, focus order,
 * screen-reader labelling, scrubbing when the pointer leaves the bar, buffered
 * ranges, and the browser differences under all of it. Every one of those is a
 * bug we would otherwise find later and fix worse.
 *
 * What it does *not* supply is a look. Left alone it renders a browser-default
 * control strip: a full-width opaque bar, square hit areas that flash a grey
 * box on hover, and a row of six icons. That is the wrong object for a
 * generated clip sitting inside a chat message. So the appearance is entirely
 * ours, in `styles/player.css` under `.studio-player`, and this file is structure.
 *
 * ---- Two controls that play ----------------------------------------------
 *
 * A play glyph in the middle of the picture, and the pill along the bottom.
 * The centred one is the invitation: a still frame with nothing on it reads
 * as a picture, and a reader who does not know it moves never finds the
 * small button in the pill. It leaves the moment the clip plays - a glyph
 * over a moving picture is a watermark - and the pill stays, fading with the
 * pointer, for the scrubbing and the sound.
 *
 * ---- Where the black came from -------------------------------------------
 *
 * `media-controller` paints `--media-background-color`, which defaults to
 * black. The clip is 16:9 and the frame it sits in is whatever the artifact
 * declared, so any mismatch showed as a black band below the picture — outside
 * the rounded panel's fill and therefore outside the shape entirely. Setting it
 * transparent lets the panel's own surface show through, and `object-fit:
 * cover` means there is nothing to letterbox in the first place.
 *
 * ---- What is deliberately absent ----------------------------------------
 *
 * No fullscreen: opening a clip larger is the lightbox's job, and fullscreen is
 * a mode that takes the whole app away. No speed control, no
 * picture-in-picture, no chapters. This plays a short clip in a message; every
 * control that does not serve that is one in the way of the three that do.
 */
export function VideoPlayer({
  src,
  poster,
  title,
  autoPlay = false,
  onRatio,
}: {
  src: string
  poster?: string
  title: string
  autoPlay?: boolean
  /** The clip's own width over height, once its metadata has loaded. */
  onRatio?: (ratio: number) => void
}) {
  const measured = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      onRatio?.(video.videoWidth / video.videoHeight)
    }
  }

  return (
    <media-controller
      class="studio-player"
      // Controls fade out two seconds after the pointer leaves, and come back
      // on any movement. A permanent bar over a twelve-second clip covers an
      // eighth of the picture for the whole of it.
      autohide="2"
    >
      <video
        slot="media"
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        aria-label={title}
        onLoadedMetadata={measured}
      />

      <media-play-button slot="centered-chrome" class="studio-player-centre" />

      <media-control-bar>
        <media-play-button />
        <media-time-display />
        <media-time-range />
        <media-mute-button />
      </media-control-bar>
    </media-controller>
  )
}
