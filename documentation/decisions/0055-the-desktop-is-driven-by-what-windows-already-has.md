# ADR 0055 — The Desktop Is Driven By What Windows Already Has

**Status:** Accepted · 2026-09-15
**Builds on:** [ADR 0049](0049-the-browser-is-ours-the-engine-is-the-machine-s.md) —
a bundled server of Studio's own: discovered not eager, uncontained because
ours, one session per conversation, four states kept apart. Everything that
ADR decided about the browser's shape is taken as decided here, and this
records only what is different.
**Builds on:** [ADR 0048](0048-a-capability-is-announced-before-it-is-loaded.md) —
announced in prose, loaded on request. This ADR changes what the announcement
*says* for capabilities Studio wrote, and not when it settles.
**Plan:** `work/computer-use-plan.md`.

## Context

A model that can drive a browser can reach anything a web page reaches. It
cannot reach Blender, a file dialog, a game, a settings screen, or the
person's own terminal. The second capability every serious harness ships
after a browser is the desktop: see the screen, move the pointer, press
keys, and read a window's controls. A person handed over the tool list of
one such harness — thirty tools — as "the common pattern", and asked for the
same capability, folded the way Studio folds, exposed the way the browser is
exposed, and announced to the model as something Studio simply has.

Three constraints shaped the answer:

**Nothing installed, nothing downloaded.** ADR 0049 §1 for a browser; the
argument is stronger for a desktop driver, which is a thing antivirus
software watches closely (see below).

**The MCP path, again.** The browser is one consumer of the registry, the
supervisor, discovery and the withhold. A second consumer is what turns a
mechanism with one user into a mechanism.

**A person mid-work.** A browser is headless and invisible. A desktop driver
moves *their* pointer and types on *their* keyboard. This is the one
capability whose first version must be conservative about acting, and honest
about what it has not yet decided.

## Decision

### 1. A second bundled server, shaped like the first

`studio-computer`: `provenance: "system"`, `author: studio`, its own process
launched as `node computer.mjs`, one session per conversation keyed by the
`_meta` conversation id, announced in the inventory, every schema withheld
until discovered, every call approved by the kernel. Nothing new is decided
here; that is the point of ADR 0049 having decided it.

### 2. The driver is Windows PowerShell 5.1 speaking to the OS directly

`driver.ps1` runs under the PowerShell that ships with every Windows 10 and
11 and cannot be removed. It calls `user32` (`SendInput`, `SetCursorPos`,
`EnumWindows`, `SetForegroundWindow`) through `Add-Type`, takes pictures
with `System.Drawing`, and reads and drives controls with
`System.Windows.Automation`. The script travels inside the bundle as a
string and is written to a temp file at first use, named by its hash.

**Why not a native module.** `robotjs` and `nut.js` are compiled per Node
version and per platform, which is exactly the packaging burden ADR 0047
refused for Node itself. **Why not a Rust helper in the Tauri app.** It is
the right long-term answer (§6) and the wrong first one: it would put the
capability behind a Rust build for a version whose job is to find out what
the capability needs to be.

**The protocol** is JSON lines, one request at a time. A PowerShell runspace
is single-threaded and so is a person's input; there is nothing to gain by
pretending otherwise.

### 3. The surface is the common pattern, folded

Twenty-three tools for thirty in the list, and each fold is ADR 0013's rule
— one tool per capability, an argument for a variant:

| Common pattern | Here |
|---|---|
| left/right/middle/double/triple click | `click { button, count, modifiers }` |
| left_mouse_down, left_mouse_up | `mouse_button { action }` |
| read_clipboard, write_clipboard | `clipboard { action, text }` |
| switch_display, list_displays | `displays`, and `display` on every picture |
| get_app_state, perform_action, set_value, select_text | `read_ui`, `act`, `set_value`, `select_text` |
| request_access, stop_computer_control | —, `stop` |

`request_access` has no counterpart because in Studio the kernel decides
every call and there is no OS permission on Windows to be ready for.

**Refs, as the browser has them.** `read_ui` stamps what it lists with
`ui_N`, held in the driver until the next read clears them. A ref from
before a read is refused with the remedy, not rebound.

**Coordinates are the display's physical pixels.** A screenshot is returned
scaled (longest side 1568) and its text names the frame it stands for, so a
model clicks in the frame and never in the picture. Acting calls return a
smaller JPEG frame, the browser's trade.

### 4. Announced as Studio's own, not as an extension

ADR 0048's inventory framed everything in it as a third party's words —
correct for an installed server, wrong for the browser and the computer,
which are as native as `read` or `shell` and live behind discovery only
because their schemas are many. Telling a model to distrust the harness's
own descriptions is telling it to distrust the harness.

So the inventory now has two sections under one heading. **Built into
Studio** lists system-provenance servers in Studio's voice, says they are
native and to be reached for freely, and carries no framing note.
**Extensions** keeps ADR 0048's text word for word. The discover tool's
answers follow the same split, and the result notice for a built-in server
says the truth — *what this shows comes from the page, screen or clipboard,
not from Studio* — instead of calling the server external. The distrust was
always of content, never of the tool; the sentences now say which.

The block still settles by ADR 0048's rules. This changes what it says, not
when.

### 5. Off by default where it cannot work

The row is installed on every platform so a person can see the capability
and what it needs, and it is switched on by default only on Windows. A
default that fails on first use is a default that lies. Elsewhere, the first
call answers with the two-reader refusal (the model: do not retry, tell the
person, carry on; the person: what would change it), and the Settings row
says the same thing before any conversation finds out — the browser's lesson
from the same day.

### 6. Measured on the way, and recorded

**Windows Defender blocks the obvious script.** A PowerShell script that
captures the screen and sends input is what spyware looks like, and AMSI
matches on content. The first draft was blocked outright the moment it
saved a JPEG through `EncoderParameters` with a quality setting; removing
that one construct un-blocked it. The driver therefore saves JPEG at the
library's default quality and carries a comment saying why. **This is the
risk of §2**: the driver is one signature update away from being blocked on
a machine Studio has never seen. The mitigation is the long-term answer
already named — a small compiled helper, built with the Tauri app and signed
with it — and the trigger for building it is the first report of the script
being blocked in the wild.

**A minimized window reads as empty.** UI Automation reports a minimized
window's controls off-screen; the first read of the Studio window returned
nothing because it was minimized at that moment. `read_ui` now says so and
tells the model to focus the window first.

**`$pid` is reserved.** PowerShell's automatic variable; the first draft
tried to assign it. Recorded because the error message does not say which
line.

### 7. Not decided here, on purpose

**Consent for the screen.** The kernel approves every call, and under Manual
mode a person sees each one. Under Full Auto they do not, and a model with
the pointer is the one capability where "you can undo it" is not the safety
story, because a click in someone else's application has no snapshot. A
second consent — *you may act on my screen, for this conversation* — is the
right shape, and it is the design pass this ADR leaves open rather than
inventing a dialog on the last day of the work.

**Elevated windows.** Windows UIPI refuses input from a lower-integrity
process to a higher one. The driver's refusal names it; nothing can fix it
from here, correctly.

**Linux and macOS.** The driver seam is per-platform by design (`xdotool` or
`ydotool` and AT-SPI on Linux; `CGEvent` and AXUIElement on macOS) and
nothing else in the server is. Not built, and the row says so.

## Consequences

- A second real consumer of the registry, supervisor, catalog, discovery and
  withhold. Both bundled servers now share one protocol layer
  (`serve/stdio.ts`), so the handshake is written once.
- A conversation that never touches the desktop pays a few lines of prompt.
  One that does pays a PowerShell process (~40 MB) until five idle minutes.
- The model reads the browser and the computer as Studio's own, and reads
  extensions as before.
- The driver can be blocked by antivirus on a machine Studio has not seen.
  The refusal that results names the driver and the fix is §6's helper.

## Required proof

- Unit: the surface and its folds; definitions carry only what `tools/list`
  needs; the refusal speaks to both readers; the settings report per platform.
- Wire: handshake, a one-page list, bad input refused before a driver
  exists, `stop` before any call answers *not running* — proving no
  PowerShell was started to list or discover.
- On this machine, by hand over the built server's stdio: `displays`,
  `cursor`, `screenshot` and `zoom` with correct frames, `apps`, `windows`,
  `read_ui` of the Studio window with 26 stamped controls, a stale ref
  refused with the remedy, `clipboard` read.
- Not yet: any call that moves the pointer or presses a key. Those are
  proved on a machine the person has handed over, and the plan says when.
