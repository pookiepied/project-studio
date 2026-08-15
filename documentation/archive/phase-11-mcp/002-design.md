> **Superseded — archived 2026-08-15.** Kept for provenance, not as current
> guidance. The live source of truth is
> `documentation/work/phases-1-11-remediation.md`.

# Task 002 — Phase 11: MCP

**Status:** design, not started. Nothing here is built.
**Researched:** 9 August 2026.
**Decides nothing on its own.** The decisions that survive review become ADRs
0025 and up; this file is the working record behind them, including the parts
that turned out to be wrong.

---

## 1. What changed in the protocol

MCP now has two eras, and the split happened twelve days ago.

| Revision | Date | Era |
|---|---|---|
| 2024-11-05 | first public | legacy |
| 2025-03-26 | HTTP+SSE deprecated here | legacy |
| 2025-06-18 | | legacy |
| 2025-11-25 | OAuth discovery, icons, elicitation, experimental tasks | legacy |
| **2026-07-28** | **stateless core** | **modern** |

The spec's own words for the two sides are *legacy* (establishes a session with
an `initialize` handshake) and *modern* (carries version, identity, and
capabilities as per-request metadata). A client that speaks both is *dual-era*.
We adopt that vocabulary rather than inventing ours — the name of a thing
should match the name in the document that defines it.

### 1.1 What 2026-07-28 removed

This is the important half, because it is code we now never write.

- **The `initialize` / `notifications/initialized` handshake.** Gone. Every
  request carries `_meta.io.modelcontextprotocol/protocolVersion` and
  `io.modelcontextprotocol/clientCapabilities`.
- **`Mcp-Session-Id`.** Gone. `tools/list` no longer varies per connection.
  A server needing cross-call state mints an explicit handle and passes it as
  an ordinary tool argument.
- **Server-to-client requests.** `roots/list`, `sampling/createMessage`, and
  `elicitation/create` are replaced by Multi Round-Trip Requests: the server
  returns `resultType: "input_required"` with an `inputRequests` field, and the
  client *retries the original request* carrying `inputResponses`. The server
  never initiates.
- **SSE resumability.** `Last-Event-ID` and event ids are gone. A broken stream
  loses the request and the client re-issues it with a new id.
- **`ping`, `logging/setLevel`, `notifications/roots/list_changed`.** Gone.
  Log level is per request via `_meta.io.modelcontextprotocol/logLevel`.
- **Roots, Sampling, and Logging are all deprecated** as features, with a
  twelve-month minimum window and named migrations (tool parameters instead of
  Roots; the provider API directly instead of Sampling; `stderr` or
  OpenTelemetry instead of Logging).

Every one of those was a source of state, and state is what made MCP clients
hard. A modern-only client is markedly smaller than a legacy one.

### 1.2 What 2026-07-28 added

- **`server/discover`** — servers MUST implement it. Returns supported
  versions, capabilities, identity. Doubles as the era probe.
- **`UnsupportedProtocolVersionError`** (`-32022`) carrying `supported` and
  `requested`, so a version mismatch is recoverable in one retry.
- **`resultType`** on every result: `"complete"` or `"input_required"`. A result
  from an earlier-protocol server that omits it MUST be read as `"complete"`.
- **`subscriptions/listen`** — one long-lived POST-response stream, opted into
  per notification type, replacing the HTTP GET endpoint and
  `resources/subscribe`.
- **An extensions framework.** `extensions` on both capability objects, keyed by
  a prefixed identifier. Tasks moved out of core into
  `io.modelcontextprotocol/tasks`; MCP Apps is `io.modelcontextprotocol/ui`.
- **`CacheableResult`** — `ttlMs` and `cacheScope` are now required on the list
  results, and servers SHOULD return tools in deterministic order specifically
  to improve prompt-cache hit rates.
- **Required headers on Streamable HTTP POST** — `Mcp-Method`, `Mcp-Name`,
  `MCP-Protocol-Version` — so gateways can route without parsing bodies.
- **Authorization hardening.** RFC 9207 `iss` must be validated; Dynamic Client
  Registration is deprecated in favour of Client ID Metadata Documents;
  credentials MUST be keyed by issuer and MUST NOT be reused across
  authorization servers.
- **An error-code allocation policy.** `-32000`–`-32019` implementation-defined,
  `-32020`–`-32099` reserved for the spec.

### 1.3 The era probe

This is the whole of the compatibility story, and it is short.

**stdio.** Send `server/discover` first, with the preferred modern version in
`_meta`. Three outcomes:

| Reply | Means |
|---|---|
| `DiscoverResult` | modern — pick a version from `supportedVersions` |
| a recognized modern error | modern — retry with one of its `supported` versions, do **not** fall back |
| any other error, or a timeout | legacy — fall back to `initialize` |

The spec is explicit that the fallback must not key on one error code, because
legacy servers answer an unknown pre-`initialize` method with whatever they
like, or with nothing.

**Streamable HTTP.** Send a modern request; on `400 Bad Request`, inspect the
body for a recognized modern error before falling back.

Era is a property of the server, not of a request. Cache it for the life of the
process (stdio) or the origin (HTTP), persist it across restarts of the same
configuration, and re-probe when a cached assumption fails.

### 1.4 Recommendation on versions

- Speak **2026-07-28** by default and always prefer it.
- Be dual-era, with legacy limited to **2025-11-25 and 2025-06-18**.
- Do **not** implement the HTTP+SSE transport. It has been deprecated since
  2025-03-26 and is now Deprecated under a formal removal clock. It is a second
  complete transport for servers that are already ending.
- Do **not** implement Roots, Sampling, or Logging. All three are deprecated in
  the revision we are adopting, and all three have named migrations.

The era abstraction has to exist from the first commit even if the legacy
module lands second. Retrofitting an era seam into a client written as though
one wire format existed is the change nobody makes cleanly.

---

## 2. Where the code should live

### 2.1 The proposal

`src/` currently holds eighteen entries at one level. Adding `mcp/`, `skills/`,
`hooks/`, and later `teams/` alongside `db.ts` makes that worse. The grouping
the owner asked for is right, but the reason usually given for it — "these are
all things you plug in" — is the weak reason, and a weak reason produces a
folder that later collects anything.

The strong reason is that a parent folder makes a boundary **testable**.
`architecture.test.ts` already enforces rules by path: it refuses any import of
a tool module from outside `src/tools/`. A parent gives us a second rule of the
same kind — nothing under it may reach the model except through the gate — and
that turns a naming preference into an enforced invariant.

```
src/extend/
  registry/     one lifecycle: sources, scope, enable, disable, watch, reload
  mcp/          the protocol client
  skills/       Phase 12
  hooks/        later
```

**Not `extensions/`.** That word now names a specific MCP mechanism
(`io.modelcontextprotocol/tasks` and friends). Two meanings for one word inside
the same subsystem is the exact fault ADR 0020 was written about.

**`agents/` stays where it is.** A subagent is not plugged in; it is the
harness's own runtime identity, and it *consumes* the other three. Teams, when
they arrive, sit with agents for the same reason.

The honest cost: one more path segment on every import, and `mcp` is not an
obscure word that needed a shelf. It is worth it once there are three of them,
and there will be.

### 2.2 What is genuinely shared, and what is not

| | MCP | Skills | Hooks |
|---|---|---|---|
| Discovery, scope, enable/disable, hot reload | yes | yes | yes |
| Grants new authority | **yes** | no | **yes** |
| Runs a process or opens a socket | yes | no | yes |
| Needs credentials | yes | no | rarely |
| Contributes | capabilities | instructions | behaviour |

So the answer to "are MCP and skills the same category" is: they share a
lifecycle and nothing else. `registry/` owns the lifecycle. Trust, permission,
transport, and credentials stay in `mcp/`.

The decisive difference is authority. A skill is text and files; it can only
ask the agent to use tools it already has. An MCP server adds tools and a
process. A skill that ships `scripts/` is not a counter-example — running that
script is `shell`, which goes through the gate like everything else, so the
authority still arrives from one place.

Hooks sit with MCP, not with skills. A hook runs a command.

### 2.3 The MCP subtree

```
src/extend/mcp/
  errors.ts        domain "mcp"
  store.ts         SQLite rows — configuration, never a secret
  registry.ts      which servers exist, and their current state
  trust.ts         per-server trust, mirroring src/permissions/trust.ts
  auth/            none | bearer | header | oauth
  transport/
    stdio.ts       spawn, framing, stderr, shutdown
    http.ts        Streamable HTTP
  protocol/
    era.ts         the probe, and the cache
    modern.ts      2026-07-28
    legacy.ts      2025-11-25, 2025-06-18
  client.ts        one connected server
  supervisor.ts    spawn, health, restart, backoff, teardown
  capabilities.ts  a server's tool -> CapabilityDescriptor
```

---

## 3. Findings that need a decision

These came out of reading our own code against the spec. Each one is a real
collision, not a preference.

### F-1 — Every MCP tool is currently unrunnable

ADR 0019 and ADR 0024: a capability whose provenance is *connected* is refused
for `execute` and `network` absolutely, whatever the capability switches say,
because isolation is `in-process` (`S-02`).

`contracts/capabilities.ts` also says effects are declared by the integrator and
never by the server. We cannot know what a server's tool does, so the only
honest declaration is the conservative one — `execute` and `network`.

Put together: **no MCP tool can ever run.** Phase 11 collides with a rule Phase
10 relied on.

The resolution should be the symmetrical one, because this project already owns
the shape. Folder trust is *per folder, decided once, denies rather than asks*.
Server trust should be **per server, decided once**, in the same words and
through the same kind of store. A server the user named, configured, and gave a
token to is not anonymous third-party code, and the absolute refusal should
apply only to servers that have not been trusted.

What must not happen is a general relaxation of the connected rule. The refusal
stays absolute for anything the user did not explicitly admit.

### F-2 — `npx` does not run under our execution rules

ADR 0019: an executable path plus an argument vector, never a string;
`shell: false`; **no `.bat` or `.cmd` on Windows** (CVE-2024-27980); absolute
paths only.

Almost every MCP server README says `npx -y some-server`. On Windows `npx` is
`npx.cmd`. Every one of those configurations is refused by our own rules, which
are correct and are not going to change.

Options, in order of preference:

1. Resolve `npx` ourselves to `node.exe` plus the absolute path of npm's
   `npx-cli.js`, and spawn that. Keeps the rule and accepts the config.
2. Refuse, and tell the user exactly what to write instead.
3. Both — resolve when we can, refuse with a precise message when we cannot.

This is the single largest source of "it works on their machine" reports we
will get, and it is a Windows-first product.

### F-3 — `net/destination.ts` blocks the most common MCP server

The SSRF guard built for `fetch` refuses private hosts, including `localhost`.
A local MCP server on `http://localhost:3000` is normal and legitimate.

So the guard is not one rule; it is one rule per purpose. `fetch` follows a URL
the *model* produced and must refuse private hosts. An MCP endpoint is a URL
the *user typed into a settings form* and may be private. Same module, an
explicit `allowPrivate` decision at the call site, and the default stays
refusing.

### F-4 — Connecting a server steps outside containment

`readRoots` and `writeRoots` bound *our* tools. An MCP server is a separate
process with its own view of the disk and its own network access. Nothing we
have reaches inside it.

This is not fixable at this layer and must not be papered over. It is the
strongest argument that per-server trust (F-1) has to be an explicit, informed
decision with the consequence stated in the dialog, not a checkbox.

`S-02` is what would change it.

### F-5 — Server-supplied tool names meet `K-07`

`capabilityIdProblem` refuses a namespace or name containing `/`. That rule was
written for exactly this moment. Consequences to settle:

- The namespace is `mcp:<serverId>`, and **`serverId` is ours** — assigned when
  the user adds the server, not the server's self-reported name. A server that
  can choose its own id can land on another server's key and inherit its grants.
- A tool whose name contains `/` is dropped, with a visible reason. Not
  escaped: an escaped key is unreadable in every log and every stored grant.
- Names also need a length bound and duplicate handling within one server.

---

## 4. Control plane

### 4.1 Source of truth

SQLite, in the application-owned database. One `mcp_server` row per server,
holding transport, command or URL, arguments, environment keys, auth *shape*,
enabled, trust, and era cache.

**No secret is in a row.** The migration guard already fails a column that looks
like credential storage, so this is enforced rather than remembered. The row
holds "this server uses a bearer token, the value is at keyring id X"; the value
is in the OS credential store.

Files are the source of truth in every comparable tool (see §6). We are choosing
the database instead because the product surface is a settings screen, not an
editor, and because two sources of truth is the fault this project names most
often. Importing a `mcp.json` is a one-way conversion into rows, not a second
home.

### 4.2 Reload without restarting

A change writes the row and bumps a generation counter. The registry
re-resolves **at a turn boundary, never mid-turn.**

Mid-turn is not a small sin here. The tool list sits in the cached prompt prefix
(`mental-model.md` §3.2) — changing it mid-turn throws away the cache and can
strand an in-flight call. A turn boundary costs the user nothing they can
perceive. The new spec pushes the same way: `ttlMs`, `cacheScope`, and
deterministic tool ordering exist to make the list cacheable.

Adding a server probes it immediately, so the settings screen can say
*connected*, or say precisely why not. Removing one tears down after in-flight
calls settle.

### 4.3 Whether the model may manage servers

Yes, with the verbs split, because they are not the same act.

| Operation | Rule |
|---|---|
| list servers, health, last error | always allowed, read-only |
| add a server | always asks; never auto-approved, including Full Auto |
| edit command, args, or URL | same as add — it converts an approved server into a different program |
| enable / disable | asks |
| remove | asks |
| supply a secret | **never** — the model may not carry one |

The last line is not a new rule. "Never place credentials or tenant authority in
model-selected arguments" is Working Rule 6 and predates this phase. The model
proposes a server; the user supplies the key in the dialog. That also means the
`mcp` management tool never accepts a token-shaped argument at all — the field
does not exist in its schema, which is stronger than validating it.

A model that can add an MCP server can add one that does anything, so this is
privilege escalation by construction, and "always asks" is the floor.

---

## 5. Auth shapes to support

| Shape | Where it applies |
|---|---|
| none | local stdio, open local HTTP |
| bearer token | most remote servers |
| custom header, e.g. `x-api-key` | common enough to be first-class |
| environment variables | stdio, where the key usually lives |
| OAuth 2.1 | remote servers that require it |

OAuth carries the new obligations: validate `iss` per RFC 9207 before redeeming
a code; prefer Client ID Metadata Documents over Dynamic Client Registration;
key persisted client credentials by issuer and re-register when the
authorization server changes.

Every secret goes to `src/credentials/`. Nothing new is invented here.

---

## 6. How the three installed tools do it

Read from the local machine on 9 August 2026.

| | Source of truth | Shape | Scopes |
|---|---|---|---|
| Claude Code | `~/.claude.json`, plus `.mcp.json` in a project | JSON, `{type, command, args, env}` or url | user, project, local |
| Codex | `~/.codex/config.toml` | TOML, `[mcp_servers.name]` with `command`, `args`, `[.env]`, `startup_timeout_sec` | user |
| opencode | `~/.config/opencode/opencode.jsonc` | JSONC against a published schema | user, project |

Two things are worth taking.

**Declaration and consent are separate.** Claude's per-project record holds
`enabledMcpjsonServers` and `disabledMcpjsonServers` — the project file says a
server *exists*, and the user's own store says whether it *runs*. A repository
cannot enable a server by being cloned. Our trust decision (F-1) is the same
idea and should be built as the same idea.

**A startup timeout is a first-class field.** Codex has
`startup_timeout_sec` per server. A server that hangs on start must not hang the
application. Ours belongs in the row, with a default.

What we do not take is the file as the source of truth, and the restart that
follows from it.

Working Rule 7 still applies: opencode is a behavioural reference, not our
architecture.

---

## 7. What this does not change

- MCP tools arrive as ordinary `CapabilityDescriptor`s in `gate.list()`. The
  agent loop, Flue, and Pi are untouched by this phase. If a schema limit in Pi
  bites, it bites at the point of conversion and nowhere else.
- ADR 0024 already covers the visibility question: a server whose tools the
  sandbox refuses does not appear in the model's list, and there is no second
  decision to make.
- The permission resource for an MCP tool is the server and the tool together,
  so a grant is never `mcp:github/*`.
- Long-running server work belongs to the `io.modelcontextprotocol/tasks`
  extension, not to a longer deadline. Out of scope here; recorded so the
  deadline is not quietly raised instead.

---

## 8. Decisions taken, 9 August 2026

The owner settled every blocking question in one pass. Recorded here; these
become ADR 0025 when the code lands.

### D-1 — Three layers, not four

**F-1 is accepted, and it collapses rather than adds.** Trust is not a separate
wall that a server passes through at call time. It is the *act of adding the
server*, recorded. That is the one moment where the consequence in F-4 can be
put in front of a person who is already thinking about this specific server.

The owner also specified a layer that was missing: a server is installed once on
the machine, and then chosen **per project**, defaulting to off.

| Layer | Question | Where it is decided | Default |
|---|---|---|---|
| **Installed** | Do I accept that this program runs outside the folder wall? | once, when added | not installed |
| **Enabled** | Does *this project* use it? | per project | **off** |
| **Approved** | May this call happen? | the permission kernel | ask |

Checked in that order. Enabled is checked first, and it is checked before
anything connects — a server a project did not select is never spawned, never
probed, and never appears in `tools/list`. It costs no process, no token, and no
prompt-cache space.

**Enabled can only subtract.** Selecting a server for a project does not approve
one call it makes; the kernel is untouched. De-selecting one is absolute: hidden
from discovery, not refused at call time. That asymmetry is what makes it safe
to put behind a plain checkbox in the project screen.

This mirrors ADR 0021 exactly. Folder trust is per folder and global; a grant
belongs to a project. Server trust is per server and global; server enablement
belongs to a project. Same shape, second application.

Native tools are not in this system at all. `read`, `shell`, `fetch`, and the
rest are not extensions, do not appear on the extensions page, and cannot be
switched off there. If we ever ship an MCP server ourselves, it is listed and is
not de-selectable.

The same three layers apply to skills and to connectors. Skills skip the first
layer's warning, because a skill grants no authority (§2.2), but the per-project
selection is identical — the reason there is prompt cost and attention, not
safety.

`WorkspaceTrustStore` in `src/permissions/trust.ts` is the model to copy:
`trusted | untrusted | undecided`, one row keyed by root, a store rather than a
flag.

### D-2 — The folder is `src/extend/`

Chosen over `src/plugins/` for one forward-looking reason. Every comparable tool
converges on *plugin* meaning a **bundle** — one installable unit containing
skills, agents, hooks, and MCP servers together, distributed through a
marketplace. Claude Code already uses the word that way, and this product will
want the same thing. Spending the word now on the categories leaves nothing to
call the bundle later except `plugins/plugins`.

`extensions/` is unavailable: the 2026-07-28 revision uses that word for a
specific protocol mechanism, and grep would stop working inside the one subtree
that needs it most.

`extend` is a verb, collides with nothing, and reads correctly at the import
site: `extend/mcp`, `extend/skills`.

The product surface can still be called the Extensions page. What the user sees
and what the folder is called do not have to be the same word, and here they
must not be.

### D-3 — `npx` is resolved, not refused

**Resolving is not a weakening of the rule.** CVE-2024-27980 lives entirely in
the `.bat`/`.cmd` path, where Windows routes the spawn through `cmd.exe` and the
argument escaping is broken. Spawning `node.exe` with `[<abs>/npx-cli.js,
...args]` never touches `cmd.exe`, passes an argument vector, and keeps
`shell: false`. It is exactly as safe as refusing, and it accepts the
configuration printed in every server's README.

The procedure:

1. Take the configuration as written.
2. Resolve `npx`, `npm`, `pnpm`, `yarn`, `bunx` to the interpreter plus the
   absolute path of the CLI script. Never a shell, never a `.cmd`.
3. If it cannot be resolved, refuse and print the exact line that would work.

One thing this does **not** solve, and which belongs in the install dialog
rather than in the spawn code: `npx -y package` fetches code from the network
and runs it. That is the user's own decision, the same as `npm install`, and it
is not `V-01` — `V-01` is about binaries *we* vouch for. But it is precisely the
consequence D-1's first layer exists to state.

The settings screen should encourage a pinned `package@version`. Encouraged,
not enforced: enforcing it would refuse most published configurations.

### D-4 — Dual-era ships in version one

Reversed from §1.4's suggestion that legacy could follow. The owner asked the
question that settles it: *if I download a popular MCP server today, does it
work?*

**Modern-only, it does not.** The revision is twelve days old. The compatibility
matrix says modern client plus legacy server **fails** — not degrades. Every
server installed on this machine today is legacy. Every server published before
28 July 2026 is legacy.

So both eras land together, behind one seam.

Legacy coverage, split by transport, because the cost is not the same on each:

- **stdio** — accept any legacy revision we can complete an `initialize`
  handshake with. Across the four legacy revisions the stdio handshake barely
  differs; the differences are in HTTP and in optional features we are not
  implementing anyway. Breadth here is nearly free.
- **HTTP** — require Streamable HTTP, which means `2025-03-26` or later. Do not
  implement HTTP+SSE. That excludes only remote servers still on `2024-11-05`,
  a transport deprecated for seventeen months and now under a removal clock.

`C-16` is answered by this.

### D-5 — Firecrawl

Deferred again, at the owner's request. `C-14` is unchanged.

## 9. The destination guard, settled (closes F-3)

The question was asked as "may `fetch` reach my own dev site on
`localhost:3000`", and it is the right question, because it exposes that the
guard was built on the wrong axis.

**The strictness follows who wrote the URL, not what the address is.**

| Caller | URL author | Rule |
|---|---|---|
| `fetch` | the model | strict |
| an MCP endpoint | the user, in a settings form | permissive |

An MCP endpoint the user typed needs a well-formed URL and an `http`/`https`
scheme, and nothing else. There is no escalation to prevent: the user could open
that address in a browser. A local HTTP MCP server on `localhost` is the normal
case, not the exception.

The model-authored side is not one rule either. "Private" was too coarse.

| Range | Rule | Why |
|---|---|---|
| `169.254.0.0/16`, cloud metadata | **refused, never offered** | this is the actual SSRF prize, and it is worth credentials on a VPS |
| `10/8`, `172.16/12`, `192.168/16`, `100.64/10` | refused by default | other people's routers, printers, and machines; the user gains nothing |
| loopback — `127.0.0.0/8`, `::1`, `localhost` | **allowed through the normal gate** | this is the user's own machine and their own dev server |
| our own harness ports | **refused, never offered** | the model calling our control plane is escalation, full stop |

Loopback is not blanket-allowed. It goes through the approval ladder like any
other destination, so the answer is *yes, after you approve it once*.

**One refinement to ADR 0022.** For loopback the permission resource must be
**host and port**, not host alone. `localhost:3000` is a dev site;
`localhost:11434` is Ollama with no authentication. Approving one must not
approve the other. Outside loopback the host remains the resource, unchanged.

The "never offered" rows work like the approver's existing rule that nothing
above the workspace root is ever offered as a scope. Not a default that can be
answered around — an address the dialog cannot express.

---

## 10. Is there an `extend` engine?

Yes, and it is a **spine, not an engine**. The distinction decides whether the
folder ages well.

### 10.1 What is actually shared

Taking each candidate honestly rather than by resemblance:

| | Truly identical across MCP, skills, hooks? |
|---|---|
| Identity — `kind` and `id` | yes |
| Origin — shipped by us, or added by the user | yes |
| Per-project on/off | yes — one boolean against a pair of ids |
| Change signal and reload timing | yes — one counter, re-read at a turn boundary |
| The row a settings screen renders | yes in shape |
| What the thing *is* — transport, auth, parsing, spawning, effects | **no** |

The shared part is four fields and a signal. Everything expensive is
type-specific. So the shared thing must stay small on purpose, and the way to
keep it small is not discipline — it is the direction of the dependency.

### 10.2 The rule that keeps it from growing

**MCP, skills, and hooks depend on the spine. The spine knows none of them.**

If `extend/inventory.ts` imported `extend/mcp/`, then adding a fourth kind would
edit the spine, and the spine would accumulate one branch per kind until it was
the engine nobody wanted. That is "one place that knows six things" — the
inversion of the fault ADR 0020 named.

Inverted, a fourth kind adds a folder and edits nothing.

This is testable, which is why it is the rule rather than a preference.
`architecture.test.ts` gains one line: **nothing at `src/extend/*.ts` may import
from a subdirectory of `src/extend/`.** A hub cannot form without failing the
suite.

### 10.3 It is not on the call path

The spine decides **presence**, never **permission**. It answers "does this
project use Blender", and it answers it *before* anything connects. Once a
server is connected, its tools are ordinary `CapabilityDescriptor`s in the gate,
and the spine is not consulted again.

So it cannot become a second door. There is still one door, and it is
`CallGate`. This is the strongest evidence that the shared part is not an
engine: an engine would be in the middle of every call, and this is in the
middle of none.

### 10.4 Shape

Two files, not a folder:

```
src/extend/
  inventory.ts    what exists: kind, id, origin, name, icon
  selection.ts    what this project uses: default off, on/off, change counter
  mcp/
  skills/
  hooks/
```

Two files do not need a folder, and Working Rule 8 forbids inventing one for
them. It can become `extend/inventory/` the day it earns it. Placing them at the
root of `extend/` also makes the architecture rule in §10.2 trivially
expressible.

**Not `registry`.** `src/retrieval/registry.ts` already exists and
`extend/mcp/registry.ts` will, and three registries meaning three things is how
a word stops carrying information.

---

## 11. How many kinds are there

Fewer than the list suggests, because two of the words on it are not kinds.

| | What it is | Where |
|---|---|---|
| **MCP server** | adds tools | `extend/mcp/` — this phase |
| **Skill** | adds instructions | `extend/skills/` — Phase 12 |
| **Hook** | adds behaviour at a point in the loop | `extend/hooks/` — later |
| Connector | **not a kind** | a remote MCP server with OAuth and a good icon |
| Plugin | **not a kind** | a *bundle* of the three above; a distribution format |
| Subagent, team | not extensions | `src/agents/` — they consume the three |

**Three runtime kinds.** That is the whole surface.

A connector being a remote MCP server removes an entire subsystem that looked
necessary. Gmail, Notion, and Linear all ship remote MCP servers with OAuth, and
we already have to build remote MCP with OAuth. What "connector" adds is
presentation: a name, an icon, and a sign-in button instead of a URL field. That
is a settings screen, not a subsystem.

A plugin installs into the three kinds and then stops existing at runtime.
Nothing in `src/` needs to know what a plugin was — which is exactly why the
word had to stay free (D-2).

---

## 12. What we ship ourselves

We will bundle MCP servers and skills with the application. An image generator
was the example given. Two questions follow: where the files sit, and what makes
one of ours different from one the user added.

### 12.1 Where

ADR 0014 already answers this. The installation is read-only and is where
shipped assets live; `platform/` already exposes `installationRoot()` and
`vendorRoot()`. A bundled extension is a shipped asset.

```
<installation>/
  vendor/     third-party binaries we pinned — ripgrep today
  library/    extensions we wrote and ship
    mcp/
    skills/
```

A sibling of `vendor/`, not inside it. `vendor/` means third-party code we
pinned; a skill we wrote is not vendored, and collapsing the two would make the
`V-01` hash rule ambiguous about what it covers.

Nothing resolves against the working directory. That rule is already enforced
and this inherits it.

### 12.2 What makes one ours

`CapabilityProvenance.trusted` says only native capabilities are trusted, and
anything the user connected is not. A server we wrote, pinned, and shipped is
**native** by that definition. The test is "did we review this code", not "does
it run in our process".

So a bundled server is trusted, skips the install warning, and is not subject to
the connected-capability refusal in D-1.

That is a real door, so it must be narrow:

**The bundled list is compiled in, never a directory scan.** If `library/` were
enumerated at startup, dropping a folder into it would mint a trusted MCP
server, and an installer, an unpacker, or a careless script could do that. The
manifest lives in the binary and the files are hash-checked, which is `V-01`'s
rule applied to extensions rather than to binaries.

### 12.3 Identity

Every extension needs one id that is stable, unique across the machine, and
readable in a stored grant.

**Bundled ids use a reserved `studio.` prefix; user ids may not.** So
`studio.image-gen` and `blender`, and a capability key of
`mcp:studio.image-gen/generate`. One uniqueness rule, no collision possible in
either direction, and nothing ugly in a log line.

The alternative — an origin column and unprefixed ids — allows a user to add a
server named `image-gen` and collide with a future bundled one. A reserved
prefix costs one dot.

### 12.4 One disagreement, stated

The instruction was that bundled servers are non-negotiable. I propose they are
**listed, on by default, not removable, but switchable off per project.**

The reason is prompt cost, not safety. An image generator's tool schemas sit in
the cached prefix of every turn in every project, including projects that will
never generate an image. That is the same argument that produced ADR 0024's
filtered list, and it does not stop applying because the tool is ours.

Not removable and not editable, because it is ours. Off-switchable, because the
user pays for it on every turn.

---

## 13. Edge cases worked before any code

Written deliberately before implementation, because the owner's stated fear is
the right one: a gate system with too many layers becomes impossible to reason
about, and by then the cost of changing it is a rewrite.

### 13.1 Turning a server off while it is being used

Two clocks, and they are not the same clock.

- **New calls stop immediately.** The moment selection changes, the gate refuses
  that server. No turn boundary, no grace.
- **In-flight calls are cancelled** through the signal path `CallBounds` already
  carries, and teardown waits for them to settle.
- **The tool list changes at the next turn boundary**, because it lives in the
  cached prompt prefix.

So there is a window where the model can still see a tool that will now refuse.
That is acceptable and honest — it is the same window ADR 0024 already accepts
for "not approved yet" — and the refusal message says the server was switched
off, not that it failed.

### 13.2 Hiding is mechanical, not a policy choice

ADR 0024 says only what can *never* run is hidden, and that permission is
deliberately not consulted. Selection looks like it contradicts that. It does
not, and the reason matters:

**An unselected server is never connected, so we never learn its tool names.**
There is nothing to list. Hiding is not a decision we make; it is the absence of
information.

That also means the three rules stay distinct rather than competing:

| Condition | In the model's list? |
|---|---|
| Sandbox cannot contain the effect | no — ADR 0024 |
| Not selected for this project | no — never connected |
| Selected, but not approved yet | **yes** — ADR 0024 |

### 13.3 What happens to grants

Four events, four different answers. Getting these wrong is the difference
between a scope toggle and a security hole.

| Event | Grants |
|---|---|
| Disabled for a project | **kept** — this is scope, not a security action, and losing approvals on every toggle teaches people to approve everything |
| Untrusted | revoked |
| Removed | **revoked** |
| Its command, arguments, or URL edited | **revoked** |

The last two are load-bearing.

**Revoking on removal is what makes id reuse safe.** Otherwise removing
`blender` and adding a different server also called `blender` inherits every
approval the first one earned. The alternative — an internal random id — makes
every stored grant and every log line unreadable, which this project has
repeatedly refused to do.

**Revoking on edit is the other half of a rule already written.** D-1 says
editing a command always asks. Asking is not enough on its own: an approved
`mcp:blender/render` whose command is quietly repointed at another program keeps
its approval and runs the new program. A different command is a different
program, so it is a different server.

### 13.4 A server can change a tool after you approve it

MCP servers may change their tool list at any time. A tool approved as "search
the docs" can be re-described later, and the grant still matches on the name.
This is a known attack shape against MCP clients and it is not theoretical.

**Fix: hash the tool definition — name, description, and input schema — and
store the hash with the grant.** A changed definition is a different tool and
asks again. Cheap, local, and it needs no cooperation from the server.

### 13.5 `fetch` can reach an MCP server directly

This one is a real hole created by §9, and it is worth stating plainly.

Once loopback is reachable by `fetch`, the model can `POST` a `tools/call`
straight at `http://localhost:8080/mcp` and skip the gate, the selection layer,
and the permission kernel completely. Every configured HTTP MCP endpoint is a
back door into itself.

**Fix: every configured MCP endpoint joins the never-offered list**, beside the
cloud metadata address and our own harness ports. `fetch` cannot reach an
address we run MCP on, and the dialog cannot express the approval.

`shell` is a different story and is not fixable here. A model with approved
`shell` can `curl` anything or run the server binary itself. That is a known and
accepted property — it is why `shell` asks every time — and pretending otherwise
would be worse than naming it.

### 13.6 Effects should follow the transport

§3's blunt answer was `execute` plus `network` for every MCP tool. That is more
than the truth for half of them.

| Server | Effects | Because |
|---|---|---|
| Remote, over HTTP | `network` | it cannot touch this disk; it is a request to another machine |
| Local, over stdio | `execute`, `network` | it is a process on this machine, and we cannot know what it reaches |

Both still ask, because both are elevated. But a remote call no longer takes a
shadow-repository snapshot before every request, which it had no way of needing.

Bundled servers we wrote declare their real effects, like any native tool.

### 13.7 The migration guard forbids the obvious column name

`src/storage/migrations.ts:192` refuses any column whose words include `key`,
`token`, `secret`, or `credential`. So `keyring_id`, `credential_ref`, and
`auth_token` are all refused, and the allowlist exists to be argued with rather
than extended casually.

The guard is right, and it points at a better design: **store no reference at
all.** The credential entry's name is derived from the server id —
`studio.mcp.<serverId>` — so the row holds only the auth *shape*
(`none | bearer | header | oauth`). There is nothing to name, nothing to leak,
and the guard never has to be argued with.

### 13.8 Process lifetime on Windows

`src/process/exec.ts` runs a process to completion. A stdio MCP server is
long-lived, so this needs new machinery beside it rather than a change to it.
`buildEnvironment` is reusable as-is.

Three failures to handle, all of which are the usual way this goes wrong:

- **`stderr` must be drained.** An undrained pipe fills and the child blocks
  forever, looking like a hang with no error.
- **Startup needs a timeout**, per server and stored in the row. Codex has one
  for the same reason.
- **Teardown must kill the tree.** `npx` spawns `node` which spawns the server.
  Killing the parent on Windows orphans the rest. Job Objects is the mechanism,
  and the stdio transport page names it.

Restarts need backoff and a give-up state that the settings screen can show. A
server that crashes on start must not be respawned in a loop.

### 13.9 Prompt cache stability

Legacy servers make no promise about tool ordering, and a list that changes
order between turns invalidates the cached prefix for no reason.

**We sort tools ourselves before building the prompt.** The modern revision asks
servers to be deterministic; sorting locally makes it true for every server,
including the legacy ones, and costs nothing.

`tools/list` is re-fetched on `ttlMs` where the server gives one, on a
`listChanged` notification, and otherwise on a default interval — never
mid-turn.

### 13.10 Full Auto must still stop at a connected server

ADR 0018: Full Auto resolves a *default* `ask` and never a policy one. MCP
capabilities must therefore carry a **policy** `ask`, not a default one.
Otherwise Full Auto plus one connected server is unattended arbitrary action,
which is the exact thing ADR 0018 was written to prevent.

### 13.11 An untrusted folder switches MCP off entirely

Folder trust already denies `write`, `execute`, and `network` in an untrusted
folder, and every MCP tool has at least one of those. So MCP is off there, with
no new rule needed.

The only work is the message. It must say the folder is not trusted, not that
the server failed.

---

## 14. Still open

Both earlier items are answered. An untrusted server stays in the project's list
and says so — *untrusted* is a state with a name, not an absence — and a server
that is switched off is unavailable to the model rather than merely refused,
which §13.1 and §13.2 spell out.

1. §12.4 — whether a bundled server may be switched off per project. The owner
   said non-negotiable; the counter-argument is prompt cost on every turn of
   every project.

Sources: the 2026-07-28 changelog, versioning, and stdio transport pages on
modelcontextprotocol.io; the 2026-07-28 release post; the Agent Skills
specification.
