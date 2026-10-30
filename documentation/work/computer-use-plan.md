# The computer-use capability — the plan

**Status:** Reliability and presence improvements implemented; hands-on desktop verification deferred by the user · **Opened:** 2026-09-15 · **Last worked:** 2026-10-19
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
  catalog         tools/list → 26 studio_computer_* definitions
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
| Seeing | `displays`, `screenshot { display?, window?, format? }`, `zoom { region, display? }` |
| Pointer | `cursor`, `move`, `click { x, y, button?, count?, modifiers? }`, `drag { from, to }`, `mouse_button { action: down \| up }`, `scroll { x, y, direction, amount? }` |
| Keyboard | `type { text }`, `key { keys, repeat? }`, `hold_key { keys, seconds }` |
| Windows | `apps`, `windows { app? }`, `open { app? , path? }`, `focus { window }`, `status`, `arrange { window, action, display?, x?, y?, width?, height? }`, `wait_for_window { text, seconds? }` |
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
observation-scoped `ui_<UUID>_<index>` refs.

**Refs.** `read_ui` stamps every element with its read's UUID and numeric index.
A new read, dispatched input, refusal, or observed non-injected user input
invalidates prior refs. Process identity checks reject a reused native handle.

**Bearings.** Added 2026-09-15, after a model lost its window among many
and mistook a picture of the wrong display for a click that did nothing.
`windows` now says which display each window is on and which is the one
being worked in; `status` says where the work is in one call (the target,
whether it is in front, what is in front if not, the pointer, the displays);
`arrange` does what the title bar does (maximize on a chosen display,
minimize, restore, move, resize, close by WM_CLOSE); `wait_for_window`
waits for a dialog or a slow app by title and names it by handle (since
2026-10-21 a dialog the target itself raised, in front, becomes the target
until it closes; see `computer-use-speed-plan.md`); and
`screenshot { window }` pictures one window wherever it is. With no
`display` given, every picture and every pointer action now follows the
window being worked in, then the pointer, then the primary - not the primary
unconditionally.

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
  *(Done later the same day; see §7.)*

## 7. The incident, and what it decided (2026-09-15)

The first input run typed into the person's own Notepad. ADR 0055 §7 now
records the rule that came out of it and the two features that followed.
The findings that would otherwise be lost:

- **The foreground window is not the frame window** for Store apps. Calculator
  lists as one handle in `windows` and reports another as foreground (its
  `CoreWindow` child). Any "is the right window in front" check must accept a
  child or the root ancestor.
- **`SetForegroundWindow` is refused** unless the caller sent the last input.
  A zero-length `SendInput` mouse move before the call is enough. Raising a
  Store app's frame still leaves the keyboard elsewhere; UI Automation
  `SetFocus` on the first keyboard-focusable descendant is the fix, and it is
  the one step not yet proved by hand.
- **`mouseData` is a DWORD** and PowerShell will not convert a negative int to
  `UInt32`. Reinterpret the bytes; do not cast. Scroll down and scroll left
  both failed on this before.
- **The report is a family, not a copy.** `reportFamily.ts` parameterises
  `BrowserReport`, `BrowserPanel`, the rail entry and `useBrowserPreview` by
  family (`browser` | `computer`), so both capabilities share one box, one
  panel, one hook. The rail keys entries as `<family>:<conversation>`.
- **The sign is a second window.** `computer_indicator_show/hide/stop` in
  `lib.rs`; label `computer-indicator` (in the capabilities file); the client
  renders `ComputerIndicatorWindow` for `?indicator=computer`;
  `useComputerIndicator` on `ChatPage` shows it while the running turn holds a
  computer call and answers its Stop. No border, no resize.
- **Still open:** models calling `studio_computer_*` names without `discover`
  get Pi's "not found". Either open-schema stub entries for the system servers
  or firmer prose in the capability inventory; not decided.

## 8. Current improvement order (2026-10-19)

1. **Implemented:** scoped refs, target identity, coordinate conversion and bounded
   replacement-window observations. Shipped in `1adc1de9`; proofs and limitations
   are in `report/computer-use-recovery.md`.
2. **Implemented, current change:** one desktop input owner across conversations;
   a nonactivating, click-through cursor marker; non-injected input summaries with
   current desktop state; browser cursor shape/press feedback and viewer activity
   context. Input activity does not automatically stop the agent. The explicit
   browser Take control/Resume interaction retains its existing meaning.
3. **Needs Implementation:** bounded condition-based waits for meaningful window
   or control changes, replacing the fixed post-action sampling delay where the
   caller can state a condition. No automatic input resend.
4. **Implemented (2026-10-30, §9 wave 1):** coordinate actions name the `frameId`
   of the picture or read they came from; the lease rejects a stale, foreign or
   other-display frame before input, and a point without a display lands on its
   frame's display.
5. **Needs Decision:** evaluate a compiled replacement for the remaining PowerShell
   driver after measuring the current seams. The small presence helper in this
   change is not a replacement for the driver.
6. **Deferred by user:** hands-on Chrome chooser, dialogs, DPI/multi-monitor,
   physical input and cursor-marker checks. Automated isolated tests continue;
   they do not prove the real desktop scenarios.

Activity reaches the model in its next tool result, including activity observed
during that call. It does not interrupt a model stream or create an idle turn.
Browser viewer movement is bounded/coalesced presence evidence, separately
identified from viewer commands submitted to the page. Native hook availability
does not prove lossless input delivery or identify who physically used a device.

## 9. Correctness and trust upgrade, in waves (2026-10-30)

Design properties adopted from a static study of another desktop runtime
(observation-bound coordinates, one composite look, per-tool effects, host-side
asks, turn scoping, a model-independent stop); its code and strings are not used.
The lease, honest receipts and the tool surface stay as they are.

**Wave 1 — correctness floor (implemented).** `frameId` on every picture and
read, required on coordinate tools and checked by the lease (`control.ts`
`frameUses`/`#frameRefusal`); one `observe` driver op behind `status` and
`read_ui` with `screenshot: true`; per-tool effect labels published as MCP
annotations; structured `read_ui` with identity, patterns, `query`, explicit
truncation and password redaction; `set_value` refuses a password field unless
told the person asked; `mouse_button`, `hold_key` and `select_text` answer with
a picture.

Decided in wave 1: `status` without a picture is still a look for keys and
references but never a frame; `read_ui` is a `read` effect even though it
chooses the working window; `clipboard` is `execute` both ways; `mark` is
`write` because it changes what the person sees.

Decided after wave 1: read-labelled computer tools are **not** admitted as
kernel `read`. Kernel `read` from Studio is allowed without asking because it
"reads no more than it needs" (`policy.ts` `defaultVerdict`), and a desktop
picture can show anything on screen, the person's other work included. The
labels stay published as MCP annotations and the server keeps its
`execute`/`network` effects, so a picture is approved like any other computer
call.

**Wave 2 — trust (implemented).** The runtime stops depending on the model
behaving:

- *In-component ask (P1-4).* Before admission the service asks the driver
  (`sensitivity` op) what input would reach: a browser, password manager or
  terminal (by owning process), or a password field; `open` with `path` and
  clipboard reads are known from the arguments. Such a call is refused with
  `approvalRequest {id, category, app, displayName, riskLevel,
  allowPersistentApproval, maxDuration}` before anything is sent
  (`computer/approvals.ts`, `service.ts #gate`). The harness bridge
  (`extend/mcp/capabilities.ts` `askThenCall`) asks the person through the
  kernel with resource `computer:<category>:<app>` - a policy `ask`
  (`computer-sensitive-target`) that Auto never resolves - and sends the call
  once more with the id in `_meta["studio/approval"]`. The kernel refuses an
  answer longer than `maxDuration` instead of shortening it, and the approval
  card offers nothing longer. An accepted id is held for two minutes for that
  actor and that exact process (`pid` + start time), single use. Wave 1's
  model-settable `password` flag is gone. A batch step that needs asking stops
  the batch before it is sent and is never bridged, since re-sending a batch
  would replay its earlier steps.
- *Turn boundary (P1-5).* The harness stamps the submission id as
  `_meta["studio/turn"]`; a new turn drops the actor's looks and frames
  (`control.ts beginTurn`) and resets the driver's element references when
  that actor read them. No model-callable `new_turn` was added: the stamp does
  the same without the model's word. The shared latest picture is kept, since
  a glance taken as the person finished speaking belongs to the new turn and
  carries its own staleness.
- *E-stop (P1-6).* Escape held for 0.8 s with a physical key event at the
  press, while Studio acted in the last 10 s, latches a stop
  (`activity.cs IsDeliberateStop`). The hooks still read flags only; the key is
  read with one `GetAsyncKeyState(VK_ESCAPE)` poll on the marker's timer. The
  driver refuses any further press in the running op (releases always go
  through), the answer's `userInput.stop` pauses the desktop for everyone
  (`personStop`) as soon as it is read, remaining batch steps refuse `escape`,
  and only the person's resume lifts it. A tap stays a touch: stale screen,
  work continues after a look.
- *Driver errors and budgets (P1-7, P1-8).* Refusals carry `code`
  (`no_element`, `refused`, `control`), classified without reading words; a
  torn answer line fails its request at once; per-op deadlines
  (`session.ts requestBudget`) replace the uniform 60 s.
- *Per-monitor-v2 DPI (P1-9).* `SetProcessDpiAwarenessContext(-4)` with the
  process-wide call as fallback before Windows 10 1703.

Known limits: the approval wait counts against the call's 120 s gate deadline;
approving with a click in Studio is the person's own input, so the re-sent
call is usually refused as stale and goes through after the next look, using
the held approval. Clipboard snapshot/restore (T2-9) moved to wave 4 with the
other clipboard work.

**Wave 3 — capability and surface (implemented).** One new tool,
`studio_computer_get_window` (30 in all); everything else is an argument on a
tool that already had the job, so no voice-tier or `OWNER_TOOLS` change was
needed (`get_window` is a read, not offered to the voice agent, whose short
list is for a shared screen).

- *`act` by pattern (T2-2).* The friendly names stay and resolve against the
  control's own patterns through one table (`Ui-ActionTable`); added
  `scroll`, `scroll_to`, `set_range`, `increase`, `decrease` (RangeValue),
  `move`, `resize`, `rotate` (Transform). An action a control cannot take is
  refused with the ones it can. `scroll` takes a `ref` (T2-7): the control's
  ScrollPattern, else the wheel at its centre; such a scroll names no frame.
- *Window capture (T2-3).* `screenshot capture_mode: "window"` uses
  `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)` - one more P/Invoke in the
  driver, no compiled artifact. It is evidence only: never a frame, because a
  covered window's drawing is not what a click would hit. A blank capture
  (GPU-drawn apps) is said, not passed off. `zoom` stays a display close-up.
- *Window identity (T2-4, N3-1).* `windows` lists each window's pid and
  process start; `focus` and `arrange` take them and refuse a handle Windows
  has reused (code `no_element`); `get_window` confirms the same window or
  lists that process's (or app's) windows now, never choosing.
- *Keys across calls (N3-2).* `hold_key action: "down" | "up"`, tracked with
  the held-key set, so any refusal, pause, handoff or stop lets go; a release
  needs no look, frame or approval.
- *Drag paths (N3-3).* `drag path` (up to 10 points) and `settle_ms`
  (at most 2 s) pause at each point; the op's deadline grows with them.
- *Foreground lock (N3-4).* Folded into `status`: whether Windows is likely to
  let a window be brought to the front (lock timeout vs. the person's last
  input), read without trying.
- *Paste and the clipboard (N3-5, T2-9).* `clipboard action: "paste"` with
  `format: "text" | "html"` (CF_HTML with a text fallback), asked about like
  typing, and puts clipboard text back afterwards, saying when an image or
  file list could not be. A `write` says what kind of thing it replaced and
  its length, never its content.
- *`wait_for_window match`* (T2-10): `title`, `app`, or exact `automationid` /
  `class` of the window's root element.
- *Batch (T2-6).* `mouse_button` and `arrange` join the steps; `clipboard`
  stays out (cross-app data, and a read is asked about on its own). A batch
  whose steps' budgets sum past 100 s is refused before anything is sent.

Audio capture is not planned: Studio has no model allowlist to gate it with.
