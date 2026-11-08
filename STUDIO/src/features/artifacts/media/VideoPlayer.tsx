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
 * What it does *not* supply is a look, and its stock glyphs and strip read as
 * a browser's own player dropped into the message. So everything visible is
 * ours: the glyphs below are slotted into its buttons, and the system player
 * is the reference for the rest (`styles/player.css`) - one bar of frosted
 * glass floating inside the picture, there only while the pointer is, with
 * filled rounded glyphs, a thin scrubber whose knob appears under the
 * pointer, and the time gone and the time left on either side of it.
 *
 * ---- Two controls that play ----------------------------------------------
 *
 * A play glyph in the middle of the picture, and the bar along the bottom.
 * The centred one is the invitation: a still frame with nothing on it reads
 * as a picture, and a reader who does not know it moves never finds the
 * small button in the bar. It leaves the moment the clip plays - a glyph
 * over a moving picture is a watermark - and the bar stays, fading with the
 * pointer, for the scrubbing and the sound.
 *
 * ---- Where the black came from -------------------------------------------
 *
 * `media-controller` paints `--media-background-color`, which defaults to
 * black. Setting it transparent lets the panel's own surface show through.
 *
 * ---- What is deliberately absent ----------------------------------------
 *
 * No fullscreen: opening a clip larger is the viewer's job. No speed control,
 * no picture-in-picture, no chapters. This plays a short clip in a message.
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
    <media-controller class="studio-player" autohide="2">
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

      <media-play-button slot="centered-chrome" class="studio-player-centre">
        <PlayGlyph slot="play" />
        <PauseGlyph slot="pause" />
      </media-play-button>

      <media-control-bar>
        <media-play-button>
          <PlayGlyph slot="play" />
          <PauseGlyph slot="pause" />
        </media-play-button>
        <media-time-display notoggle="" class="studio-player-time" />
        <media-time-range />
        <media-time-display remaining="" notoggle="" class="studio-player-time" />
        <media-mute-button>
          <MutedGlyph slot="off" />
          <SoundGlyph slot="low" />
          <SoundGlyph slot="medium" />
          <SoundGlyph slot="high" />
        </media-mute-button>
      </media-control-bar>
    </media-controller>
  )
}

/*
 * The glyphs: filled, with rounded joins, drawn on one 20-unit grid so they
 * share a weight. The play triangle sits a unit right of centre, where it
 * looks centred - its mass is at the flat edge.
 */
function PlayGlyph({ slot }: { slot: string }) {
  return (
    <svg slot={slot} viewBox="0 0 20 20" aria-hidden className="studio-player-glyph">
      <path d="M6.5 4.6c0-.9 1-1.4 1.7-.9l8 5.4c.6.4.6 1.4 0 1.8l-8 5.4c-.7.5-1.7 0-1.7-.9z" fill="currentColor" />
    </svg>
  )
}

function PauseGlyph({ slot }: { slot: string }) {
  return (
    <svg slot={slot} viewBox="0 0 20 20" aria-hidden className="studio-player-glyph">
      <rect x="5" y="4" width="3.6" height="12" rx="1.2" fill="currentColor" />
      <rect x="11.4" y="4" width="3.6" height="12" rx="1.2" fill="currentColor" />
    </svg>
  )
}

const SPEAKER = 'M3 8.2c0-.6.4-1 1-1h2.3l3.4-2.8c.6-.5 1.6-.1 1.6.8v9.6c0 .9-1 1.3-1.6.8L6.3 12.8H4c-.6 0-1-.4-1-1z'

function SoundGlyph({ slot }: { slot: string }) {
  return (
    <svg slot={slot} viewBox="0 0 20 20" aria-hidden className="studio-player-glyph">
      <path d={SPEAKER} fill="currentColor" />
      <path d="M13.6 7.4a3.6 3.6 0 0 1 0 5.2M15.6 5.4a6.4 6.4 0 0 1 0 9.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function MutedGlyph({ slot }: { slot: string }) {
  return (
    <svg slot={slot} viewBox="0 0 20 20" aria-hidden className="studio-player-glyph">
      <path d={SPEAKER} fill="currentColor" />
      <path d="M13.8 8l4 4M17.8 8l-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
