# The webview content security policy

Why this file exists: `tauri.conf.json` is strict JSON and `tauri-build`
rejects unknown fields, including a `"//"` comment key inside
`app.security`. The policy is the kind of thing nobody should have to
reverse-engineer from a one-line string, so the reasoning lives here.

Audit finding FE-01: the app shipped with `"csp": null`, which is no policy
at all. With no network code the blast radius was small; the moment the
frontend talks to the harness over HTTP, an injected script would have had
unrestricted fetch to any origin.

## The production policy

```
default-src 'self';
connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:* http://localhost:*;
img-src 'self' data:;
media-src 'self' blob:;
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
object-src 'none';
base-uri 'self';
frame-ancestors 'none'
```

`default-src 'self'` is the floor. Every loosening below it names the
feature that forced it, and nothing was loosened speculatively.

- **`connect-src`** admits loopback because the STUDIO HARNESS is a separate
  local process listening on `127.0.0.1` at a port chosen at launch
  (`src/platform/harness/`). The port is not known ahead of time, so the
  wildcard is on the port and not the host. `ipc:` and `http://ipc.localhost`
  are Tauri's own invoke bridge, which is a custom protocol rather than
  `postMessage` on the platforms that support it; without them
  `window.ts`'s two `invoke` calls would be blocked.
- **`style-src 'unsafe-inline'`** is forced by Framer Motion, which animates
  by writing the element `style` attribute every frame, and by the design
  system's inline CSS-variable writes (`--ui-size`, the window radii). A
  runtime style attribute cannot carry a nonce, so there is no stricter
  form of this that keeps the animation system.
- **`img-src data:`** is forced by inline SVG data URIs in the fixtures and
  by small assets Vite inlines at build time.
- **`font-src data:`** is forced by KaTeX and the bundled font faces; the
  build inlines the smallest of them as data URIs.
- **`media-src blob:`** is forced by voice mode, which plays back a
  `MediaRecorder` Blob (`features/voice/useMicInput.ts`).
- **`object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`** are
  free: nothing in the app uses a plugin, rewrites the base URI, or is
  meant to be framed.

Notably absent: `script-src` is not stated, so it inherits
`default-src 'self'` -- no inline script, no `eval`, no remote script. That
is the directive doing the actual work.

## The dev policy

`devCsp` is the same policy plus exactly two things that exist only while
`pnpm tauri dev` is running and never ship:

- `ws://127.0.0.1:* ws://localhost:*` for the Vite HMR socket.
- `script-src 'self' 'unsafe-inline'` for the React Refresh preamble Vite
  injects into `index.html` in dev.

The built app gets neither.

## What was verified, and what was not

The production policy was exercised against the real `pnpm build` output:
`dist/` served over loopback with this exact string as a
`Content-Security-Policy` response header, loaded in a Chromium browser,
with a `securitypolicyviolation` listener installed on `document`. The home
route, a transcript containing KaTeX and a code block, the artifact gallery
(including a `data:` image), and the settings panes all rendered with zero
violations and zero console messages. All 29 font faces reported
`status: "loaded"`, including the two KaTeX faces the maths actually uses.

Not verified: the same policy inside the Tauri WebView2 webview itself,
which is the only place the `ipc:` and asset-protocol parts of `connect-src`
are exercised. Those two entries are present because Tauri needs them, not
because a failure was observed without them. `pnpm tauri dev` was not run to
completion against a devtools console. `media-src blob:` is likewise
reasoned rather than observed -- exercising it needs a microphone.
