# ADR 0054 — The Microphone Is Studio's To Grant

**Status:** Accepted · 2026-09-13
**Builds on:** [ADR 0049](0049-the-browser-is-ours-the-engine-is-the-machine-s.md)
— the surface is ours, the engine is the machine's. Here the engine asks a
question through a surface that is not ours, and this decides who answers.
**Plan:** [the media catalogue and dictation plan](../work/media-catalog-and-dictation-plan.md),
D5. Landed in step 0 (`ce952a8b`).

## Context

A page asks for the microphone with `getUserMedia`; WebView2 turns that
into a `PermissionRequested` event on the host. In a Tauri window with no
handler the request stalled: the promise neither resolved nor rejected, the
dictation hook sat in a stage that had no face, and the microphone button
did nothing. With WebView2's default handler it would instead have raised
Edge's own permission bar inside Studio's frame - a borrowed control, in a
borrowed style, in a window that draws all of its own chrome. Neither is a
question the person asked to be asked: they installed Studio and pressed
the microphone.

## Decision

### 1. Studio answers the permission question itself, on every webview

`src-tauri/src/permissions.rs` attaches a `PermissionRequested` handler to
every webview the app creates - the main window from `tauri.conf.json`, the
diagnostic window and the pop-outs from `lib.rs` - from a plugin's
`on_webview_ready`, so no builder can forget it. The microphone, asked for
by one of Studio's own documents (`tauri.localhost`, `localhost`,
`127.0.0.1`), is allowed. Every other kind - camera, location,
notifications, clipboard read - is denied, because Studio asks for none of
them and a page that asks anyway gets its answer without a prompt.

### 2. Windows's own privacy setting still rules

No handler overrides the operating system's microphone switch. When it
refuses, `getUserMedia` rejects with `NotAllowedError`, and the dictation
strip's blocked face says so and where to fix it. The handler removes the
borrowed prompt and the stall; it does not remove the person's control.

### 3. A remote page is not affected

The grant is per origin, and the origins are Studio's own. A page served
to a phone over remote access runs in the phone's browser, which asks in
its own way; nothing here reaches it.

### 4. The waiting has a face

The `requesting` stage of dictation, which the stall exposed as a stage
with no face, now shows "Asking for the microphone" with its own working
dots, so that a stall - should another platform ever produce one - can
never again look like nothing.

## Consequences

- The microphone button works on first press, with no bar and no dialog.
- `webview2-com` joins `Cargo.toml` at the version Tauri's wry already
  pins (one copy, checked with `cargo tree`), so the controller handed over
  by the platform seam and the interfaces registered against are one
  crate's.
- Any future capability Studio wants from the webview (a camera for a
  document scan, say) is an explicit change to the allow list here, not a
  prompt that appears on its own.
