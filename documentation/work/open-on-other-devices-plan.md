# Open Studio on another device — the plan

**Status:** Steps 1–8 built on `task/open-on-other-devices`; ADR 0050 still to be written · **Opened:** 2026-09-10
**Decision to record:** ADR 0050 (draft in §3 below; write it before step 1)
**Depends on:** [ADR 0028](../decisions/0028-harness-client-admission-and-local-access.md) (the loopback rule),
[ADR 0044](../decisions/0044-the-host-supervises-and-holds-the-credential.md)
(the credential lives in Rust), [ADR 0045](../decisions/0045-a-run-outlives-the-window-that-started-it.md)
(a run outlives the window that started it — the reason this is possible at all).

---

## 1. What this is

You switch on **Open on other devices** in Studio's settings. Studio shows a
name, an address and a QR code. You point your phone at it, and Studio opens
in the phone's browser: the same conversations, the same running turn, the
same permission prompts, the same everything. Nothing is a separate app and
nothing is a second copy of your work. It is the same Studio, rendered
somewhere else.

The picture:

```
        phone / laptop / tablet, on the home network or over Tailscale
                                  │  https (or http) to studio.local
                                  ▼
STUDIO (the desktop app, running on your PC)
  ├─ the window you already use              ─┐
  ├─ NEW: a small web listener                │  both render the same state,
  │    serves the built frontend              │  neither is the owner
  │    forwards /api/* and /agents/* ─────────┘
  │    attaches the per-launch bearer, exactly as service_fetch does
  │    holds paired devices, hands out session cookies
  └─ NEW: mDNS responder, publishes studio.local
                                  │  loopback only, unchanged
                                  ▼
STUDIO HARNESS  (127.0.0.1, never reachable from the network)
        conversations · runs · approvals · MCP · the browser capability
```

The harness does not change its posture at all. It stays bound to loopback,
it stays reachable only by something already on the machine, and the token
that admits a request stays inside Rust where it has always lived.

---

## 2. What already works in our favour

This is not a rewrite, and the reason is that four decisions already made for
other purposes happen to be exactly the ones this needs.

**The frontend is already an ordinary HTTP client.** Every call it makes names
a relative path — `/api/...` or `/agents/studio/...`. No host, no port, no
assumption about being inside a window.
[`transport.ts:227`](../../STUDIO/src/platform/harness/transport.ts) already
reads: inside Tauri go through the Rust seam, otherwise call `fetch`. The
browser path is written; it has simply never had a server to talk to.

**A run already outlives the window that started it.** ADR 0045 made the client
re-attach to a run at an offset rather than hold the connection that keeps it
alive. Two readers at two offsets was always in scope. We are not inventing
session sharing — it exists, and the desktop window is merely its first
consumer.

**The approval queue is already durable and already answered by id.** Rows live
in SQLite in `pending_approval`, every client reads them from
`GET /api/permissions/pending`, and `POST /api/permissions/pending/:id`
returns 404 "That approval is no longer pending" when the row is gone. This is
the answer to the two-devices question, and §3.3 says why it means there is no
race to design around.

**Most platform-specific code is already behind `isTauri()`.** Appearance,
drafts, project creation and the connection status all have a branch for "not
in the desktop app". Some of those branches currently return null; they become
real in step 6 rather than needing to be invented.

---

## 3. The decisions

These are the things that should be settled before code is written, because
each one is expensive to change later. Together they are the body of ADR 0050.

### 3.1 The desktop app serves the browser, not the harness

The network listener goes into the Rust side of the Tauri app. It serves the
frontend assets already embedded in the binary, and forwards `/api/*` and
`/agents/*` to the harness on loopback, attaching the per-launch bearer the
same way `service_fetch` does today.

The alternative was to have the harness serve the UI and bind a second,
network-facing port itself. Rejected for three reasons:

- **ADR 0028's rule survives untouched.** The harness binds loopback, the
  supervisor refuses any readiness frame naming a non-loopback host, and none
  of that has to be qualified with "unless the remote feature is on".
- **The per-launch bearer never leaves Rust.** That is currently an absolute
  invariant, and absolute invariants are worth more than convenient ones. A
  browser gets a credential of its own (§3.4) which grants nothing on the
  machine beyond talking to Studio.
- **Rust already has both halves.** `services/sse.rs` parses the harness's
  event stream, and the asset bundle is already embedded for the webview. The
  proxy is mostly wiring rather than new machinery.

The cost, stated plainly: remote access works only while Studio is running on
your PC. Given the feature exists to check on work you left running, that is
the correct behaviour and not a limitation to apologise for.

### 3.2 One frontend, one build, one UI

There is no mobile app, no cut-down view and no second design language. The
same React build that runs in the desktop window is what the phone loads. Where
a screen is unusable at 390 pixels wide, that is a responsive-layout bug in
Studio and it gets fixed in Studio, for both surfaces at once.

This is a deliberate constraint against the easy path. A "mobile version"
starts as a shortcut and ends as a second product with its own bugs and its
own drift.

### 3.3 Two devices are two renders of one state — and the race is already handled

Your instinct is right, and it is right for a reason that is already in the
code rather than by luck.

State does not live in a client. It lives in the harness: conversations and
runs in Durable Streams, approvals in a SQLite table. A client is a window onto
it. Opening a second window does not fork anything, and closing one does not
end anything.

For approvals specifically, the sequence when both devices are looking at the
same prompt is:

1. Both read the row from `GET /api/permissions/pending`. Both render it.
2. The phone answers. The broker resolves the waiting promise, the row is
   deleted, the run continues.
3. The laptop answers a moment later. `broker.answer` finds no such pending
   id, returns false, and the route replies **404, "That approval is no longer
   pending."**

The correctness is already there — nobody double-approves, and the run cannot
be answered twice. What is missing is only manners. Today the second device
would show that 404 as an error, which is wrong: nothing failed, someone else
simply got there first. So one piece of real work:

> **Answered-elsewhere handling.** A 404 on an approval answer is not an
> error state. The prompt should quietly resolve with a line saying it was
> answered on another device, and the poll (1s while a run is live) will have
> removed it within a second anyway.

The same treatment applies to questions (`/api/questions`) and to any other
answer-once surface. The rule to write down: **a durable prompt is answered
once, by whoever gets there first, and every other viewer is told so rather
than shown a failure.**

Two things are worth checking during step 4 rather than assumed:

- Whether `broker.answer` is genuinely atomic against two simultaneous posts,
  or merely usually so. The store is SQLite, and a `DELETE` guarded by the row
  existing is the shape we want.
- Whether the conversation stream tolerates two live readers at different
  offsets. ADR 0045 says it should. It has never actually been done.

### 3.4 Pairing, not a password

The credential model for a browser device:

- Switching the feature on makes Studio show a **six-character pairing code**,
  valid for a few minutes and usable once.
- A device that visits the address and enters the code is issued a long-lived
  **HttpOnly, SameSite=Strict cookie** bound to that device.
- Settings lists **paired devices** — a name you can edit, first paired, last
  seen — with a **Remove** button on each, and a **Remove all** below.
- Removing a device invalidates its cookie immediately, on the next request.
- The pairing secret and the device records are stored with the existing
  keyring credential store, not in the SQLite database, and never in plain
  text in app data.

No accounts, no password to choose, no password to forget, and nothing to type
on a phone keyboard beyond six characters — the QR code carries the address so
the code is the only thing entered by hand.

Rate limiting on the pairing endpoint: a few attempts per minute, then a
cooldown, because six characters is short enough to be worth guessing if a
device is allowed to try forever.

### 3.5 A remote device is a full device

You asked for the same UI with nothing removed, and that includes approving
permissions. So a paired device gets the same surface the desktop window has:
run the agent, answer approvals, manage projects, providers and MCP servers.

The security boundary is **which devices are paired**, not **what a paired
device may do**. That is a coherent position: the whole point is to be able to
deal with your work when you are not at your desk, and a device that can start
a run that writes files but cannot change a setting is an odd middle.

The seam to keep open anyway: the harness's admission layer keys scopes by
client type, and that table is deliberately built so adding a type is a compile
error until someone chooses its scopes. Adding a `remote` client type now —
with the full operational scope set, matching the desktop — costs nothing today
and is where a future view-only or approve-only device would plug in without
redesign. It also means the harness's own logs can tell a remote request from
a desktop one, which is worth having the day something looks wrong.

### 3.6 The address should be a name, not an IP

Typing `192.168.1.47:7420` is developer behaviour, and this is not a developer
tool. Three layers, in order of how often they matter:

- **A QR code in settings.** The normal path. Nobody types anything at all,
  and it carries the full URL including the port.
- **mDNS: `studio.local`.** The memorable name for the second visit and after,
  published by Studio itself on the home network. Windows resolves `.local`
  natively, as do macOS and iOS. Android's support in browsers is unreliable,
  so the QR code and the raw address stay visible as the fallback rather than
  being hidden once mDNS works.
- **Tailscale's own name.** From outside the house, Tailscale's MagicDNS already
  gives the machine a stable name with no work from us. Studio should detect a
  Tailscale interface and show that address too, labelled as the one that works
  away from home.

An honest note, because it changes what mDNS is for: mDNS is link-local
multicast and does not travel over Tailscale. `studio.local` is the friendly
name **at home**; the Tailscale name is the one **away**. Studio should show
both and say which is which, rather than implying one address works everywhere.

### 3.7 HTTPS, and the one feature that depends on it

Browsers reserve some capabilities for secure contexts. `localhost` is exempt;
`studio.local` over plain HTTP is not. Two things are affected:

- **Voice input breaks.** Microphone access requires a secure context, full
  stop. There is no way around this over plain HTTP.
- **Clipboard copy falls back.** `navigator.clipboard` is unavailable, and
  [`lib/clipboard.ts`](../../STUDIO/src/lib/clipboard.ts) needs a
  `document.execCommand` fallback path — which is easy and worth having.

Three options were considered. A self-signed certificate is rejected outright:
a full-page browser security warning is exactly the opposite of the feeling
this feature is meant to have. Shipping a real certificate is not possible for
a `.local` name. So: **ship HTTP, feature-detect, and degrade with an
explanation** — voice input hides itself on an insecure origin with a line
saying why — and document `tailscale serve` as the supported path to full
parity, since it puts a real certificate in front of the port with one command
and no warnings.

If this proves annoying in practice, the follow-up is Studio running
`tailscale serve` itself when it detects Tailscale, which turns the documented
step into a checkbox. That is deliberately out of scope for the first version.

### 3.8 Nothing is exposed until you say so

- The listener does not exist until the setting is switched on. It is not
  bound-and-firewalled or listening-but-refusing; it is not created.
- Switching it off closes the listener and drops every connection.
- The setting does not persist across restarts silently — or rather, it does
  persist, but the state is visible: while it is on, Studio's tray icon and
  a strip in settings say so, with the address and the number of connected
  devices.
- On Windows, first activation will raise the firewall prompt. Studio should
  say that is coming and what to choose, rather than letting a system dialog
  appear out of nowhere.

---

## 4. The steps

Ordered so that each one is provable before the next depends on it.

### Step 1 — The listener and the proxy, loopback only

Add the web listener to the Rust side, bound to `127.0.0.1` on a fixed port,
serving the embedded frontend assets and forwarding `/api/*` and `/agents/*`
to the harness with the bearer attached. No settings UI, no pairing, no
network binding.

**Done when** a desktop browser on the same PC can open the port and load
Studio's shell against the running harness.

**Watch for:** SSE must pass through unbuffered, or streaming looks broken in
a way that will be blamed on step 2.

### Step 2 — The browser streaming client

Implement the conversation channel for the browser: read the harness's SSE
stream directly with `fetch` and a reader, honouring the same opaque offset
and `control` frame semantics the Rust reader honours. This slots into the
existing injectable seam in `createConversationClient` rather than changing
conversation logic.

**Done when** a turn started in the desktop window streams live in the
browser tab, and a turn started in the browser tab streams live in the desktop
window.

**Watch for:** the reconnect-at-offset path, which is where a subtle bug will
duplicate or drop events. It needs a test that kills the connection mid-run.

### Step 3 — Pairing, devices, revocation

The pairing code, the cookie, the device store in the keyring, the device
list, revocation, and the rate limit. Add the `remote` client type to the
harness's admission table with the full operational scopes.

**Done when** an unpaired browser gets the pairing screen and nothing else,
a paired one gets Studio, and Remove takes effect on the very next request.

### Step 4 — Two clients at once, told honestly

The answered-elsewhere handling from §3.3, for approvals and questions. Verify
the atomicity of `broker.answer` and of two live stream readers, and add tests
that pin both.

**Done when** answering a prompt on one device makes it disappear on the other
with a sentence, not an error.

### Step 5 — The setting, the address, the QR code

The settings screen: the switch, the state strip, the QR code, the addresses
with labels for home and away, the Tailscale detection, the firewall note, the
paired device list. The tray indication while it is on.

**Done when** you can turn it on, scan the code with your phone, and be in.

### Step 6 — Browser parity for the desktop-only surfaces

Each of these has a Tauri-only path today and needs a browser answer:

| Surface | Today | In a browser |
| --- | --- | --- |
| Quit app, tray | Tauri command | Hidden; a browser tab is not the app's life |
| Open second window | Tauri command | Open in a new tab |
| Restart harness, harness status | Tauri command | Proxy exposes a status and restart endpoint |
| Window state, appearance | Tauri store plugin | `localStorage` |
| Composer drafts | Tauri store plugin | `localStorage` |
| Pick a project folder | Native dialog | A harness-side folder browser, since the file system being chosen is the PC's, not the phone's |
| Voice input | Works | Hidden on an insecure origin, with the reason shown |
| Clipboard | Works | `execCommand` fallback |

The folder picker is the only one with real design work in it, and it is worth
doing well: a small "browse the PC's folders" list served by the harness is
also the honest answer for the desktop app's own future needs.

### Step 7 — mDNS

Publish `studio.local` while the feature is on, withdraw it when off. Last,
because everything works without it and it is the piece most likely to behave
differently across networks.

### Step 8 — Responsive passes

Walk the real screens at phone width and fix what breaks, in the shared
components rather than behind a mobile branch. This is likely to be more work
than it sounds and should be treated as its own pass rather than squeezed into
step 5.

---

## 5. What is deliberately not in this

- **No access from outside without Tailscale.** No relay, no tunnel, no port
  forwarding advice, no cloud anything. If you can reach the machine, you can
  reach Studio; making you reachable is Tailscale's job and it is better at it.
- **No multi-user.** Paired devices are all you. There are no accounts, no
  per-person history and no permissions between people.
- **No offline or mobile-installed app.** No service worker, no PWA install
  prompt in the first version. It is a page you open while your PC is on.
- **No separate mobile design.** Covered in §3.2.

---

## 6. Open questions

1. **Fixed port or remembered port?** A fixed default (something memorable and
   unlikely to collide) makes the address stable and printable. Falling back
   when it is taken makes the address change. I lean fixed, with a clear error
   and a manual override if it is occupied.
2. **Does the setting survive a restart?** I lean yes — you turned it on
   because you want to reach your machine, and having to be at the machine to
   re-enable reaching the machine is a joke at your expense. The visible state
   strip and tray indication are what keep it honest.
3. **Should the desktop window show that a device is connected?** I lean toward
   something quiet — a small indicator, not a notification — so you are never
   surprised that another screen is live.

---

## 7. Rough sizes

| Step | Size | Notes |
| --- | --- | --- |
| 1 Listener and proxy | Medium | New Rust HTTP surface; SSE pass-through is the risk |
| 2 Browser streaming | Medium | Seam exists; offset handling is the risk |
| 3 Pairing | Medium | Mostly new, but self-contained |
| 4 Two clients | Small | Behaviour already correct; manners are missing |
| 5 Settings and address | Small | UI over facts steps 1–3 already produce |
| 6 Parity | Medium | Eight small items, one real one (folder picker) |
| 7 mDNS | Small | One crate, publish and withdraw |
| 8 Responsive | Unknown | Needs a walk through the real screens first |

Steps 1 and 2 together are the proof that the whole idea works. If they land
cleanly, nothing after them is architecturally uncertain.
