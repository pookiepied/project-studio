# The computer-use capability — the plan

**Status:** Steps 1-5 landed; step 6's input half waits for a handed-over machine · **Opened:** 2026-09-15 · **Last worked:** 2026-09-15
**Decision:** [ADR 0055](../decisions/0055-the-desktop-is-driven-by-what-windows-already-has.md)
**Rests on:** [ADR 0049](../decisions/0049-the-browser-is-ours-the-engine-is-the-machine-s.md)
(a bundled server of Studio's own, discovered not eager, uncontained because ours),
[ADR 0048](../decisions/0048-a-capability-is-announced-before-it-is-loaded.md)
(announced in prose, loaded on request).

ADR 0055 decides what this is. This says how it gets built, and what the
first version deliberately does not do.

---

## 1. The shape, in one picture

```
harness
  registry        studio-computer · provenance: system · a row like the browser's
  supervisor      spawns on demand, restarts, uncontained (ours)
  catalog         tools/list → 23 studio_computer_* definitions
  discovery       announced as built in; schemas loaded on request
        │  stdio (MCP), node.exe <path>/computer.mjs
        ▼
studio-computer  (Node, bundled, its own process)
  ├─ session     one driver per conversation · lazy · idle timeout
  ├─ tools       screenshot, click, type, key, read_ui, act, windows, …
  └─ driver      JSON lines over stdio to a PowerShell process
        │  powershell.exe -File driver.ps1  (Windows PowerShell 5.1, always present)
        ▼
user32 · System.Drawing · System.Windows.Automation — nothing installed, nothing downloaded
```

The same four states as the browser: **enabled** → **announced** → **loaded**
→ **running**. The last one costs a PowerShell process (~40 MB) and nothing
else; it closes itself after some minutes idle.

---

## 2. The tool surface

Named `studio_computer_*`, `author: studio`. The list a person handed over as
"the common pattern" had thirty entries; this is the same capability set,
folded the way ADR 0013 folds — one tool per capability, an argument where
the list had a tool per variant.

| Job | Tools |
|---|---|
| Seeing | `displays`, `screenshot { display?, scale? }`, `zoom { region, display? }` |
| Pointer | `cursor`, `move`, `click { x, y, button?, count?, modifiers? }`, `drag { from, to }`, `mouse_button { action: down \| up }`, `scroll { x, y, direction, amount? }` |
| Keyboard | `type { text }`, `key { keys, repeat? }`, `hold_key { keys, seconds }` |
| Windows | `apps`, `windows { app? }`, `open { app? , path? }`, `focus { window }` |
| Accessibility | `read_ui { window?, depth?, limit? }`, `act { ref, action }`, `set_value { ref, value }`, `select_text { ref, start, end }` |
| Other | `clipboard { action: read \| write, text? }`, `wait { seconds }`, `stop` |

Folded, and why: `left_click`/`right_click`/`middle_click`/`double_click`/
`triple_click` are `click` with `button` and `count`, exactly as the browser
did it; `left_mouse_down`/`left_mouse_up` are `mouse_button`; `switch_display`
is a `display` argument on `screenshot` and `zoom`, because a display choice
is a property of a picture, not a mode to be in; `read_clipboard`/
`write_clipboard` are one `clipboard`. `request_access` is not a tool at all —
in Studio the kernel decides every call and there is no OS permission on
Windows to be ready for. `get_app_state` is `read_ui`, and it hands out
`ui_N` refs the way the browser hands out `ref_N`.

**Refs.** `read_ui` stamps every element it lists with `ui_N`, kept in the
session's map until the next `read_ui`, which clears it. A ref from before a
read is gone, not rebound — the browser's rule, for the browser's reason.

**Coordinates.** Physical pixels of the chosen display. A screenshot may be
returned scaled down (longest side 1568 by default) and the result names the
full frame it corresponds to, so a model that clicks reads the frame, never
the image. Multi-monitor: `displays` lists them with their offsets; a
coordinate is always within one display's frame.

---

## 3. Steps

### Step 1 — The protocol layer, shared

The browser server's stdio/JSON-RPC handling moves to `src/serve/stdio.ts`
and both servers use it. One place that speaks both protocol eras, one place
that turns a thrown error into an `isError` result. The browser wire tests
keep passing; that is the whole check.

### Step 2 — The driver

`src/computer/driver.ps1`, imported as a string (`?raw`) and written to a
temp file at first use. JSON lines in, JSON lines out, one request at a time
(a PowerShell runspace is single-threaded and so is a person's input). Ops:
`displays`, `screenshot`, `cursor`, `move`, `click`, `drag`, `button`,
`scroll`, `type`, `key`, `hold`, `apps`, `windows`, `open`, `focus`,
`read_ui`, `act`, `set_value`, `select_text`, `clipboard`.

Measured before anything else: screenshot correctness across DPI scaling,
`SendInput` for Unicode text, `SetForegroundWindow` from a background
process, UIAutomation on a WebView2 window and a Win32 window.

### Step 3 — The session and the server

`src/computer/session.ts` owns one driver process per conversation, lazy,
with the browser's idle timeout and the browser's `disconnected` handling.
`src/computer/server.ts` is the entry; `src/computer/tools.ts` the 23
definitions. `builtin.ts` registers a second row.

### Step 4 — Native vibe

`CapabilityInventoryEntry` learns `builtIn`; the inventory block renders a
**Built into Studio** section above the **Extensions** section, in Studio's
own voice, with no "these are somebody else's words" framing for our own
servers. `discover` drops the third-party note for built-in servers. The
result notice for a built-in server says the *screen* or *page* is untrusted,
not that the server is external.

### Step 5 — Not Windows

Linux and macOS get the refusal shape: what this needs, what is there, what
to do. The driver is Windows-only in this version and says so in the row.

### Step 6 — Proof

Unit: tool surface, folding, refs, refusal text, protocol over the wire.
Integration (Windows, opt-in): a real driver answers `displays`, `cursor`,
`apps`, `windows`, `read_ui` on the harness's own console window, and a
`screenshot` decodes as a PNG of the reported frame. Input ops are proved by
hand on a machine the person has handed over, never by a test that moves
their mouse.

---

## 4. What this must not break

- The browser's four states, its wire, and its tests.
- The withhold: no MCP tool loads eagerly, this one included.
- `POST /servers` still refuses `provenance: "system"`.
- The inventory's settled-ness rules: the new section changes what the
  block *says*, not when it settles.

---

## 5. Not in this version, on purpose

- **Acting on a display the person is using.** The kernel approves every
  call; there is no second "you may take the screen" consent yet. Recorded
  for the design pass, because a person mid-work must be able to say no
  once for the whole conversation, not per click.
- **Elevated windows.** UIPI blocks input to a higher-integrity process;
  the refusal names it.
- **Teach mode, screen recording, OCR.** Different products.
- **Linux (`xdotool`/`ydotool`, AT-SPI) and macOS.** The driver seam is
  per-platform by design; nothing else in the server is.

---

## 6. What was actually built, and what was found

Steps 1-5 landed on 2026-09-15 in one pass; ADR 0055 §6 records what was
measured. Three things worth carrying:

- **Defender blocks the obvious script** (ADR 0055 §6). The driver avoids the
  one construct that tripped it, and the durable fix is a compiled helper.
- **The wire is proved, the input is not.** `displays`, `cursor`,
  `screenshot`, `zoom`, `apps`, `windows`, `read_ui`, `clipboard`, a stale
  ref, bad input and `stop` were all driven over the built server's stdio on
  this machine. Nothing that moves the pointer or presses a key has been run,
  because the person was working at the keyboard. That is the hand-check
  still owed, alongside the browser's.
- **No rail artifact yet.** The browser reports itself into the transcript
  and the rail; the computer does not. A screenshot arrives as an image in
  the tool result and is drawn as one. A "what the model did on the desktop"
  panel is the same shape as the browser's and is the next design item.
