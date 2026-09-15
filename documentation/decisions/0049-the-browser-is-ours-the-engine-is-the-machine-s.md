# ADR 0049 — The Browser Is Ours, The Engine Is The Machine's

**Status:** Accepted · 2026-09-07
**Builds on:** [ADR 0048](0048-a-capability-is-announced-before-it-is-loaded.md) —
a capability is announced before it is loaded. The browser is the first real
consumer of that mechanism, and this ADR corrects one thing 0048 got wrong.
**Amends ADR 0048 §3:** that section said system provenance loads eagerly,
which conflated two independent axes. Corrected below.
**Builds on:** [ADR 0047](0047-a-contained-command-can-find-the-programs-it-may-run.md) —
its rejection of vendoring Node is the same argument applied here to Chromium.
**Relates to:** `net/destination.ts`, the `C-17` policy. Loopback needed no
change; the reason is recorded below so nobody spends an afternoon relaxing a
rule that was never in the way.

## Context

A model that writes a web page cannot see it. It builds a Next.js site, starts
the dev server — which now works, since background commands exist — and then has
no way to answer "does it render". The gap is not knowledge; it is eyes.

Three constraints came from the product side and each one eliminates options
that would otherwise be reasonable:

**Lightweight.** Studio ships as a desktop application, and a browser is the
heaviest thing anyone would consider putting in it.

**Headless, and it should not feel headless.** The browser must never take over
the person's screen. What they see is an artifact in the transcript that appears
when the browser starts and updates as it works, expandable into the side rail
as a preview. Not a browser window; a report of one. The intent, in the words
that set it: *"it feels like magic happening, rather than looking at too much
power-user functionality."*

**The surface is Studio's.** What the model calls should read as Studio's own
capability, not as a third party's tools that happen to be installed.

## Decision

### 1. Ship no engine. Drive the one that is already there.

There are three real web engines — Blink, WebKit, Gecko — and everything that
renders the actual web is one of them. None is lightweight, and the Rust
alternatives are not a fourth: they are drivers that still require a Chromium
binary, or engines that do not render the real web well enough for "extract the
information from this page", which is the ordinary request.

So the way to be lightweight is to ship nothing. `playwright-core` is pinned to
a `channel` — Edge, then Chrome — so it launches a browser the machine already
has and never downloads one. On Windows this is effectively guaranteed: the
WebView2 runtime ships with Windows 11 and Edge is present regardless.

This is ADR 0047's reasoning, applied to a larger dependency. That ADR rejected
vendoring Node because a bundled runtime puts security updates on Studio's
release schedule instead of the vendor's, drifts against what the user already
maintains, and costs tens of megabytes per platform. Every one of those costs is
larger for a browser.

**When no Chromium is found, refuse with a remedy.** Name what was looked for,
where, and what to install — never a bare failure. The same shape ADR 0047 chose
for a missing program root, and for the same reason: a refusal that names the
fix is actionable, and a silent failure is a bug report. Offering a download
instead would put Studio in the business of shipping and updating a browser for
the minority of machines that lack one, permanently, to save those machines one
install. That trade can be reversed later if it bites — adding a download is
easy, taking one back is not.

### 2. The tool surface is ours. The plumbing is borrowed.

Tools are named `studio_browser_*` and carry `author: studio`. What they accept,
what they return, and what they emit into the transcript is designed here.

Underneath, `playwright-core` does the work that is genuinely hard: finding the
installed browser, and the waiting and retry logic around elements and
navigation that makes automation flaky when hand-rolled. Raw CDP is still
reachable through `newCDPSession`, which is how frames are captured.

**`@playwright/mcp` is rejected**, and the distinction matters. That package is
a complete MCP server with its own tool names and its own result shapes, and no
hook for "emit a frame into an artifact". Building the artifact behaviour on it
would mean wrapping every tool — at which point the surface has been written
anyway and the package is only doing the plumbing that `playwright-core` does
without the wrapper.

**What the reservation about Playwright was really about** was not the library.
It was not wanting a third party to own the face of a core capability. Owning
the tool names, the result shapes and the artifact behaviour answers that
completely, and it survives replacing the plumbing later: swapping
`playwright-core` for a hand-written CDP client would change no contract.

The cost accepted here, stated rather than discovered: we inherit a dependency
in the middle of a core capability, and CDP changes under Chromium are ours to
absorb.

### 3. It runs as a bundled MCP server, in its own process

Not as native in-process tools, though that would be simpler.

**Because the MCP path should be exercised by something real.** The browser is
the first serious consumer of the registry, the supervisor, the catalog,
`list_changed` and ADR 0048's discovery. An in-process tool group tests none of
it, and a mechanism whose only user is a test is a mechanism nobody trusts.

**And because a browser is the thing most likely to wedge.** A separate process
that hangs is a process to restart; an in-process hang is the harness.

Launched as `node.exe <path>/server.mjs`. Never through `npx` or a `.cmd` shim —
`assertValidCommand` refuses those on Windows, on the CVE-2024-27980 reasoning,
and a design that needs the refusal waived is the wrong design.

### 4. Nothing starts until something asks

Four states, deliberately apart, and each one has to be reached before the next
means anything:

| State | What is true | What it costs |
|---|---|---|
| **Enabled** | the selection spine resolved it on for this conversation | nothing |
| **Announced** | it appears in the inventory prose (ADR 0048) | a few lines of prompt |
| **Loaded** | discovery registered some of its schemas | those schemas, appended |
| **Running** | a tool was actually called; a browser exists | 150–300 MB, while it lives |

A project with the browser enabled and a conversation that never browses pays
for a sentence. **The MCP server process itself is not started by enablement
either** — it starts when the first schema is loaded or the first tool is
called, whichever comes first.

**One browser per conversation, many tabs.** Per call would relaunch constantly;
one for the whole harness would let one conversation's page state leak into
another's.

**An idle timeout ends it.** Some minutes with no calls and the browser closes;
the next call relaunches it. The model is not told and does not need to be: a
tool that works either way has nothing to report.

**It is visible and it can be stopped.** The browser runs as a background job,
so it appears in the rail's background-commands panel with a Stop, alongside
everything else the conversation left running. A person who finds Chromium in
their task manager can find it in Studio and end it. That was the gap the
background-jobs work existed to close, and a browser that bypassed it would
reopen it.

### 5. Discovered, not eager — and this corrects ADR 0048

ADR 0048 §3 said system-provenance servers load eagerly. That conflated two
things that are independent:

- **Who owns it** — `author: studio` or `third-party`. A property of the code.
- **How it loads** — eager or discovered. A property of its size.

The browser is `studio` and is roughly twenty tools. Ownership does not make
those schemas cheap. It is announced in the inventory and its schemas are loaded
on request, exactly as a third-party server would be.

The rule that replaces the one being corrected: **eager loading is for
capabilities small enough and general enough that most turns might use them** —
the natives. Everything else is discovered, whoever wrote it.

### 6. Loopback needed no change, and this records why

The obvious assumption is that a browser tool aimed at `localhost:3000` fights
the network policy. It does not, and this is written down so nobody relaxes a
rule that was never in the way.

`C-17` in `net/destination.ts` classifies loopback as its own class, separate
from `private`, and **allows it for a model** — asking approval for host *and*
port, so approving a dev server does not approve an unsecured database on the
same machine.

What refuses local addresses is `parseDestination`, used by the `fetch` tool,
and its own comment says why: fetch reads pages through an external reading
service, and *"the service is not on this machine."* That is a limit of one
transport, not a judgement about the address. A browser opens its own
connection, so it never touches that path.

Two things this does require:

- The browser's destinations pass through `judgeHostPort`, so per-port approval
  still happens and `own-port` is still refused.
- Anything the server binds — a CDP endpoint, a debugging port — calls
  `registerOwnPort`. `own-ports.ts` states the consequence of forgetting: a
  listening port not in that set is a port the guard "cannot protect, and the
  guard then defends nothing while still looking present."

### 7. The window shows a report, not a browser

An artifact appears in the transcript when the browser starts and updates as it
works. Expanding it opens the side rail with the latest frame and the sequence
of actions.

**It is a preview, not a browser.** No address bar, no back button, no way to
browse by hand. Those need history, cookie and profile management, a download
policy and a clear-data control — a second product inside this one, to serve a
person who has a real browser one keystroke away.

**The first version sends a frame per acting call, not a live feed.** MCP has no
natural channel for streaming: a tool result answers a call, it is not a feed.
So a tool that navigates or clicks returns a screenshot alongside its result and
the artifact shows the latest. A true `Page.startScreencast` feed needs a side
channel the transport does not provide, and it is a later refinement rather than
part of this decision. Recorded here so the first version reads as designed
rather than unfinished.

## What was weighed

**A. Drive an installed Chromium (chosen).** Zero shipped. Costs a refusal on
machines without one, and a dependency on what the user maintains.

**B. Bundle Chromium.** Works everywhere with no setup. Costs ~150 MB per
platform, puts browser security updates on Studio's release cadence, and is the
exact trade ADR 0047 already rejected for a much smaller runtime.

**C. A Rust browser.** The original hope, and it does not exist in the required
form. The Rust options are drivers needing a Chromium binary — so they solve
nothing B or A does not — or engines that do not render the real web reliably
enough for the ordinary request.

**D. Reuse the Tauri webview.** Already shipped, so apparently free. WebView2 on
Windows is Chromium and speaks CDP; macOS and Linux are WebKit and do not. A
capability that works on one platform is a capability that has to be explained
on the others.

## Consequences

- Studio's installer does not grow, and the browser is current because someone
  else keeps it current.
- A machine with no Chromium gets a refusal naming the fix, which is a support
  question on Linux and effectively never on Windows.
- The browser is the first thing to exercise the MCP path end to end, so its
  bugs are the discovery mechanism's bugs too. That is the point of it going
  first.
- A conversation that browses carries a browser's memory until it goes idle,
  and the person can see and end it.
- We own a dependency in the middle of a core capability. If it becomes a
  liability, the contract is ours and the plumbing can be replaced beneath it.
- ADR 0048's eager rule is narrowed: eagerness follows size, not ownership.

## Required proof

- Enabling the server starts no process. Loading a schema or calling a tool
  does.
- No browser is downloaded, on any platform, under any code path.
- A machine with no Chromium refuses with a message naming what to install and
  where it looked.
- One browser serves a conversation across many calls; a second conversation
  gets its own; neither sees the other's pages.
- The browser appears as a background job and its Stop ends it.
- An idle browser closes, and the next call works without the model doing
  anything differently.
- A `localhost` destination asks approval for host and port; a second port on
  the same host asks again; an own-port is refused.
- Every port the server binds is registered as an own-port.
- The browser's tools contribute nothing to the tools array until discovered.
- An acting tool returns a frame, and the artifact shows it.

---

## Amendment, 2026-09-09 — a server Studio wrote is not a third party's

Written after building it, because one thing this ADR assumed turned out to be
wrong in a way that would have shipped a browser that could not do its job.

**§6 is right about the network policy and wrong about the sandbox.** It records
at length that `C-17` allows loopback for a model, so a browser aimed at
`localhost:3000` fights nothing — and that is true of the *policy*. It is not
true of *containment*. A contained child is refused `127.0.0.1` under every
capability Windows offers; `isolation/backend.ts` says so, measured, and the
refusal is deliberate. So an MCP server launched the ordinary way could never
have seen a dev server, whatever `C-17` said.

The fix is not to relax containment. It is that **containment was answering a
question this server does not raise.** `isolation/kinds.ts` already classifies
children by who chose the program — ours, the model's, or a third party's — and
a capability Studio wrote and ships is the first of those wearing the third
one's clothes. Its program, arguments and call site were all written here.

So a `provenance: "system"` server launches uncontained, and the word now
carries a boundary it did not carry before. What holds that line:

- `POST /servers` refuses `provenance: "system"` outright. A route that let a
  caller answer "whose program is this" would hand any program on the machine
  an uncontained launch for one extra field.
- The management service refuses to edit or remove a system server, because an
  edit changes what gets launched while the row still claims Studio wrote it.
  Switching one off is a different question and always works.
- The kernel still approves every call, and the network policy still judges
  every host and port. Nothing about dispatch changed.

**And §7's "one browser per conversation" needed a mechanism.** MCP carries no
conversation identity, so one stdio connection serves every conversation and
would otherwise share one browser between them — one conversation's signed-in
session visible in the next. `tools/call` now carries
`_meta: { "studio/conversation": <id> }`, for system-provenance servers only: a
conversation id is the person's, no third-party server has a use for it, and one
that began keying behaviour on it would be tracking somebody across their work.

**§5's correction of ADR 0048 is now implemented as written.** `refreshTools`
used `provenance === "system"` as its eager predicate, which is exactly the
conflation §5 identified — ownership standing in for cost. No MCP server loads
eagerly now, whoever wrote it. Eager is the natives.

## Amendment, 2026-09-15 — what an outside reading found, and what it did not

An independent review of the browser code against this ADR, done by a model
that had not built it. Most of what it found was agreement; three things were
real and are recorded here so the next reader does not rediscover them.

**A profile directory was documented and never used.** `session.ts` carried a
`profileRoot()` that named a per-conversation directory under `~/.studio/browser`
and said it kept two conversations from sharing a cookie jar. Nothing called
it. The launch path was, and is, `chromium.launch({ channel })` plus
`browser.newContext()` — an in-memory context that writes nothing to disk.
The isolation property was true anyway, because each conversation's session
owns its own context; the persistence the comment implied was not. **Decided:
delete the function, keep the in-memory context, and say so.** A browser's
memory lives exactly as long as its process. The idle close in §4 forgets a
sign-in, a cookie and a half-filled form, and the next call starts from
nothing. That is the trade §7 already makes — cookie and profile management is
the second product this ADR refuses to build — and a profile on disk would be
the first piece of it. Recorded as a decision rather than an oversight so it
is not "fixed" back.

**The no-download rule had no test.** `resolve.ts` said the library's default
to download "has to be pinned by a test", and the only test read a refusal
message. It is pinned now, on the two things that would bring a download back:
the manifest depends on `playwright-core` and never `playwright`, and the
launch call names a channel and never passes an `executablePath`.

**The page reader stopped at two boundaries the click path did not.**
`snapshot()` walked `element.children`, which never enters a shadow root, while
the CSS-selector path already pierced shadow DOM — so a model could click a
thing it had never been shown. And `contenteditable` regions were not stamped,
so a rich-text editor read as an empty box with nothing to type into. Both are
a few lines and are done; the ref-clearing moved into the same walk so it
reaches what the walk reaches. Small additions in the same pass: `wait_for`
takes `hidden` (a selector going away, the pair of `gone` for text), `scroll`
goes `left` and `right`, and `viewport` emulates `reducedMotion` and print
`media`.

**Recorded and deliberately not done**, each against the test in this ADR's
consequences — a tool that no named job needs is a schema every turn pays for:

- *Iframes.* The walk does not enter a frame document and refs have no frame
  dimension, so a Storybook story, an iframe-based editor or an embedded
  payment field is invisible and unclickable. This is the gap most likely to
  be hit in ordinary use, and it is the one to build next when it is — with a
  frame dimension on refs, not a `frame` argument on every acting tool.
- *Pixel coordinates.* `click`, `hover` and `drag` take refs and selectors
  only. A canvas — a map, a chart, a signature pad — has no elements to stamp.
  Refs cannot be guessed wrong and coordinates can, which is why the surface
  is refs-first; an optional coordinate form on `click` alone is the smallest
  honest addition when a canvas job arrives.
- *Downloads and network mocking.* "Test my export button" and "show me the
  500 state" are both product decisions about what a headless browser may do
  to the machine and to the app under test. Not taken here.
- *WebSocket traffic* is absent from the network log; the console usually
  carries the failure.

## Amendment, 2026-09-15 — "never download" is the rule; "never a path" was not

§1 said "no `executablePath`, ever", and gave the reason: a path would be one
we found, and the step after finding one is downloading one when we cannot.
That reasoning conflated the rule with one way of breaking it. The rule is
that Studio drives a browser the person installed and keeps up to date, and
**never fetches one**. A browser found at the place its installer put it is
exactly that browser; naming its path is no more a download than naming a
channel is.

What made this matter is Linux. `playwright-core` knows Edge and Chrome by
name and nothing else, and the browser a Linux machine usually has is
**Chromium** — Debian, Ubuntu, Fedora, Arch, the snap, the flatpak — which is
not a channel. Under §1 as written, a Linux user with a working browser got
the refusal, and the refusal told them to install one they had. The same
gap covers Brave on every platform.

**Decided.** Two tiers, in `resolve.ts`, tried in order: every channel the
library knows, seen or not; then a browser found at a known location, and
only if it exists. A path reaches the launch only from that list. The test
that pins the rule now pins *that* — one launch call, its options the
candidate's and nothing else, no `executablePath:` written anywhere in
`session.ts` — rather than the absence of a word.

**Measured and refused: the WebView2 runtime.** It is a Chromium, it is on
every Windows machine Studio can run on (Studio itself is a WebView2 app), and
it looked like the answer to a machine whose Edge was removed. Tried on
2026-09-15 with `playwright-core` against `msedgewebview2.exe`: it launches
and closes before answering. It is not a browser and is not on the list.
Brave from a found path, tried in the same run, answered in 635 ms.

So a Windows machine whose Edge was removed drives Chrome or Brave if either
is present, and otherwise gets the refusal — which is the right answer,
because there is nothing on that machine to drive.

**And the person learns before the model does.** The server process starts
fine on a machine with no browser; the failure lived in the first tool call,
inside a conversation, which is the worst place to find out. The bundled
browser's row in Settings now carries one line — *Drives Microsoft Edge*, or
*No browser found. Studio never downloads one; install Microsoft Edge, Google
Chrome, Brave or Chromium* — read fresh on every list, so an install shows up
on the next look without a restart. "Seen" rather than "will work": only a
launch decides, and the line does not claim otherwise.
