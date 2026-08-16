/**
 * Stand-in media for the gallery.
 *
 * A desktop app that is offline by default cannot demonstrate image generation
 * by fetching a picture from the internet, and shipping binaries in the repo to
 * fake it is worse. These are SVGs encoded as data URIs: no network, no assets
 * directory, a few hundred bytes each, and they exercise exactly the code path
 * a real result would -- `<img src>` with an intrinsic aspect ratio.
 *
 * They are abstract on purpose. A photograph would set an expectation about
 * output quality that a demo has no business making.
 */

function dataUri(svg: string): string {
  // `encodeURIComponent` rather than base64: it stays readable in devtools, and
  // for markup this size it is also the shorter of the two.
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`
}

export const GENERATED_IMAGE = dataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  <defs>
    <linearGradient id="a" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8ea2ff"/>
      <stop offset="0.5" stop-color="#f2b6a0"/>
      <stop offset="1" stop-color="#7fd0b6"/>
    </linearGradient>
    <radialGradient id="b" cx="0.28" cy="0.22" r="0.5">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="800" height="600" fill="url(#a)"/>
  <rect width="800" height="600" fill="url(#b)"/>
  <g fill="none" stroke="#ffffff" stroke-opacity="0.42" stroke-width="1.5">
    <circle cx="560" cy="200" r="90"/>
    <circle cx="560" cy="200" r="140"/>
    <circle cx="560" cy="200" r="190"/>
  </g>
  <path d="M0 470 C 180 400, 300 520, 460 450 S 700 380, 800 430 L 800 600 L 0 600 Z"
        fill="#1c1c1c" fill-opacity="0.22"/>
</svg>`)

export const GENERATED_VIDEO_POSTER = dataUri(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540">
  <defs>
    <linearGradient id="v" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#2a2f45"/>
      <stop offset="0.55" stop-color="#5b6ea8"/>
      <stop offset="1" stop-color="#e8a98c"/>
    </linearGradient>
  </defs>
  <rect width="960" height="540" fill="url(#v)"/>
  <g stroke="#ffffff" stroke-opacity="0.2" stroke-width="1">
    <path d="M0 380 H960 M0 420 H960 M0 460 H960 M0 500 H960"/>
  </g>
  <circle cx="480" cy="270" r="54" fill="#ffffff" fill-opacity="0.9"/>
  <path d="M464 244 L516 270 L464 296 Z" fill="#2a2f45"/>
</svg>`)
