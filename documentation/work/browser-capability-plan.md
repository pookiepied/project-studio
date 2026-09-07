# The browser capability — the plan

**Status:** Not started · **Opened:** 2026-09-07
**Decision:** [ADR 0049](../decisions/0049-the-browser-is-ours-the-engine-is-the-machine-s.md)
**Blocked on:** [the capability-discovery plan](capability-discovery-plan.md) steps 1–3.
The browser is 0048's first real consumer and cannot ship eagerly, so discovery
has to exist first — shipping it eager and moving it later is the expensive
direction.

ADR 0049 decides what this is. This says how it gets built.

---

## 1. The shape, in one picture

```
harness
  registry        studio-browser · author: studio · a row like any other
  supervisor      spawns on demand, restarts, watches list_changed
  catalog         tools/list → ~20 studio_browser_* definitions
  discovery       announced in the inventory; schemas loaded on request
        │  stdio (MCP), node.exe <path>/server.mjs
        ▼
studio-browser  (Node, bundled, its own process)
  ├─ session     one browser per conversation · lazy · idle timeout
  ├─ tools       navigate, click, type, read_text, screenshot, wait_for, …
  └─ frames      a CDP screenshot after each acting call
        │  playwright-core · channel: msedge | chrome · never downloads
        ▼
Chromium already on the machine — headless, isolated profile in app data
```

Four states, and each has to be reached before the next means anything:
**enabled** (selection) → **announced** (inventory prose) → **loaded**
(discovery registers schemas) → **running** (a call launches a browser).

---

## 2. Steps

### Step 1 — The server, with no browser in it

A Node package under a new top-level directory, built to a single
`server.mjs` the way the harness bundles itself. It speaks MCP over stdio,
answers `initialize` and `tools/list`, and every tool returns "not implemented".

**Why an empty server first.** It proves the part most likely to be wrong —
that the harness can register, spawn, supervise, list and discover a real
third-process server — before any browser exists to confuse the diagnosis. If
`tools/list` reaches the catalog and the inventory names it, the whole MCP path
is sound and everything after is browser work.

**Registered as `author: studio`, `provenance: system`,** using the columns the
discovery plan's step 1 adds. Announced, never eager (ADR 0049 §5).

**Launch is `node.exe <path>/server.mjs`.** Never `npx`, never a `.cmd` shim —
`assertValidCommand` refuses those on Windows and a design that needs the
refusal waived is the wrong design.

**Proof:** the server appears in the inventory with its sentence and tool names;
its schemas are absent from the tools array until discovered; discovering one
registers it; enabling it starts no process.

### Step 2 — Finding a browser, and refusing well

Resolution order: Edge, then Chrome, through `playwright-core`'s `channel`.
Never a download, on any path — that is a test, not a configuration setting,
because the default behaviour of the library is to download and the absence has
to be pinned.

**The refusal is the deliverable of this step**, not an afterthought. It names
what was looked for, where it looked, and what to install. ADR 0047's shape: a
refusal that names the fix is actionable; a bare failure is a bug report.

**Proof:** a machine with a browser resolves it; a machine without one refuses
with all three facts; no code path downloads.

### Step 3 — The session, and its lifecycle

One browser per conversation, many tabs. Launched on the first tool call, not on
connect, not on discovery. An idle timeout closes it; the next call relaunches
it, and the model is not told because a tool that works either way has nothing
to report.

**Headless always,** with an isolated profile under Studio's app data — never
the person's real profile, on any platform, ever.

**It runs as a background job**, so it appears in the rail's background-commands
panel with a Stop. Reuses what already exists rather than inventing a second
place where a long-lived process can hide. This is the step where the browser
becomes something a person can see and end.

**Open:** the job is owned by the MCP server's process, not by the harness's
`BackgroundJobs`. Whether the browser surfaces as a job of the server or the
server itself surfaces as the job needs deciding when the code is in front of
us. The requirement is only that a person can see it and end it.

**Proof:** enabling starts nothing; the first call launches one; a second
conversation gets its own; neither sees the other's pages; idle closes it; the
next call works; Stop ends it.

### Step 4 — The tools

Roughly twenty, named `studio_browser_*`. The set worth having, not the set that
is possible: navigate, back, click, type, press, select, read_text, read_links,
screenshot, wait_for, evaluate, tabs, close.

**Result shapes are ours and are designed once, here.** Every acting tool
returns its result *and* a frame (ADR 0049 §7). Every result carries the page's
URL and title, because a model that clicked and does not know where it landed
will screenshot to find out.

**`read_text` is the one that matters most** and is the reason this exists —
"open this and extract the information" is the ordinary request. It returns
readable text, not raw DOM.

**Content from a page is untrusted** and is labelled as such, the same way
`tools/web/untrusted.ts` and `capabilities.ts` already label what they return.
A page the model reads is a page that can address it.

**Proof:** each tool's contract has a test; a frame accompanies each acting
result; URL and title travel with every result; the untrusted label is present
on read paths.

### Step 5 — Destinations, and the ports we bind

Every destination passes `judgeHostPort`, so per-host-and-port approval happens
and `own-port` is refused. Loopback needs no relaxation — ADR 0049 §6 records
why at length, so that nobody re-derives it.

Every port the server binds calls `registerOwnPort`. `own-ports.ts` states the
cost of forgetting: a listening port outside that set is one the guard "cannot
protect, and the guard then defends nothing while still looking present."

**Proof:** `localhost:3000` asks approval; `localhost:5173` asks again; an
own-port is refused; every bound port is registered.

### Step 6 — The artifact and the preview

An artifact appears when the browser starts and updates as it works — the
current URL, the last frame, the sequence of actions. Expanding it opens the
rail with the frame at a readable size.

It reuses the artifact and rail machinery that exists. The rail already holds
artifacts, a plan and background commands; this is a fourth kind of entry, not a
new mechanism.

**It is a preview and not a browser.** No address bar, no back button, no
browsing by hand — that needs history, cookies, profiles, a download policy and
a clear-data control, which is a second product inside this one, for a person
who has a real browser one keystroke away.

**Proof:** the artifact appears on first use and updates per acting call; the
rail shows the latest frame; there is no control that navigates by hand.

---

## 3. What this must not break

- **ADR 0048.** The browser is announced, never eager. Its schemas enter the
  array only through discovery.
- **ADR 0029.** Nothing removes a tool from a live session. A browser that goes
  away leaves its tools listed and failing at dispatch.
- **The kernel is the only door.** A discovered browser tool is approved per
  call like anything else.
- **`C-17`.** The policy is unchanged. If a change to `net/destination.ts` seems
  necessary, re-read ADR 0049 §6 first — the answer is almost certainly that the
  call is going through the wrong client.
- **`assertValidCommand`.** No shim launches, on any platform.

---

## 4. Open questions

1. **Where does the bundled server live and how is it built?** A new top-level
   directory beside `STUDIO/` and `STUDIO HARNESS/` is the obvious answer and
   has not been decided. It affects `start.ps1`, which currently knows about two
   builds.
2. **Whose job is the browser process?** §3 above. Decide with the code in
   front of us; the requirement is visibility and a Stop, not a particular
   owner.
3. **Live frames.** The first cut sends a frame per acting call because MCP has
   no feed. A real `Page.startScreencast` needs a side channel; whether that is
   worth building is a question for after the first version is used.
4. **macOS.** WebKit is not Chromium, so a Mac without Chrome refuses. Whether
   that is acceptable or needs a WebKit path is a product decision nobody has
   had to make yet.
5. **Downloads initiated by a page.** A browser that can download is a browser
   that can write outside the workspace. Simplest first answer is to refuse
   downloads entirely; that has not been decided.
