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

## 9. Still open

1. **F-3** — `allowPrivate` at the destination guard. Mine to implement; no
   decision needed, recorded so it is not forgotten.
2. Whether a project may enable a server that is installed but whose trust was
   later revoked. Proposed: no, and it disappears from the project's list with a
   reason rather than failing at call time.
3. What the extensions page shows for a server that is installed, enabled, and
   failing. Health belongs in the row; the wording does not exist yet.

Sources: the 2026-07-28 changelog, versioning, and stdio transport pages on
modelcontextprotocol.io; the 2026-07-28 release post; the Agent Skills
specification.
