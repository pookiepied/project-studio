# Studio Inspector V0

A separate local collector and read-only MCP server for Project Studio. An
assistant can inspect a recorded conversation or follow it while you use the
normal Studio desktop app. No account or cloud telemetry service is required.
Node **24.19 or newer** is required; there are no dependencies to install.

## Start with a normal desktop session

1. Build/restart Studio with this branch's native and client changes. An already
   installed older binary does not acquire the sharing feature automatically.
2. Open **Settings → Diagnostics**. Choose recording/content scope as needed,
   start recording, then click **Share with local Inspector** and **Copy Inspector
   feed path**. Sharing starts off on every app launch and does not enable recording.
   You can also share an already retained window after stopping recording.
   Feed status `ready` means the export is readable; source health separately
   reports whether recording is enabled.
3. From this directory, start the collector below, replacing the sample path with
   the copied path. Keep this process running while testing.

```powershell
node ./src/cli.mjs collect --feed "C:\copied\inspector-feed.json"
```

The default stores metadata only. Add `--include-content` if you want the
collector to retain prompts, exposed reasoning, arguments and results that
Studio's own capture policy permits. Both choices are needed for content.
This flag cannot retrieve content Studio did not capture. Redaction is defense
in depth, not a guarantee that arbitrary free text contains no sensitive data.

The default independent store is `~/.studio-inspector/store.sqlite`. All CLI
commands accept `--store "absolute-path"`; alternatively set
`STUDIO_INSPECTOR_STORE` for both collector and MCP processes. Keep the store
outside the repository. Never point it at a Studio database.

## Connect an assistant

Use an absolute path to this project's `src/cli.mjs`. Start the collector first.
Choose **one** MCP registration method to avoid duplicate servers. The following
commands register a local stdio server; they do not turn on capture or start the
collector. Use an absolute Node executable path if Node is absent from the host's
PATH. No owner credential is needed or accepted.

**Codex CLI / ChatGPT desktop on the same machine:**

```powershell
codex mcp add studio-inspector -- node "C:\pookiepied\Dev Workspace\Project Studio\studio-inspector\src\cli.mjs" mcp
codex mcp list
```

The desktop, CLI and IDE share the local Codex MCP configuration. Reload the
host after changing configuration. A custom store can be appended as
`--store "C:\chosen\store.sqlite"` after `mcp`. See the
[official MCP configuration guide](https://developers.openai.com/codex/mcp).

**Claude Code:**

```powershell
claude mcp add --transport stdio studio-inspector -- node "C:\pookiepied\Dev Workspace\Project Studio\studio-inspector\src\cli.mjs" mcp
```

See [Claude Code MCP setup](https://code.claude.com/docs/en/mcp). The portable
`plugin.json`, `mcp.json` and `skills/inspect-studio/SKILL.md` are included for
hosts supporting Agent Plugins packages. Packaging source does not install it
into a host; direct MCP registration works independently of plugin support.
Read the included skill, or ask the assistant to read it, for the full workflow.

**ChatGPT web:** local Codex configuration is not read by the website. A remote
connection is an additional explicit setup. OpenAI's
[Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
supports forwarding a local stdio command without exposing a public inbound
server. Follow that guide for workspace permissions, tunnel creation, local
runtime and the ChatGPT connection. Point its MCP command at this same CLI's
`mcp` entry point. Keep runtime credentials in the documented environment
variable, never in a chat, feed, argument or repository. No tunnel, account
upload or cloud connection is created by this project. A remote assistant can
receive evidence you choose to return through its MCP connection.

## First test

Start a new assistant conversation with the MCP server enabled:

> Use Studio Inspector to find my Studio conversation [conversation ID]. Check
> source health, summarize its current state, then follow new observations while
> I reproduce the failure. Give evidence references, separate facts from
> hypotheses, and suggest one testable improvement. Do not change Studio.

The intended flow is status → sessions → overview → timeline/operation → raw
event/payload. `watch_session` waits up to 20 seconds and returns a durable
`nextCursor`. Repeat while the assistant is active. The collector keeps recording
when the assistant is idle; an MCP tool does not keep an AI running after a chat
ends. Later, inspect the same retained conversation without repeating the task.

Host events may have no conversation identity. Read `get_source_timeline` using
a source ID returned by status and join only by shared request/operation IDs.
Missing joins, missing settlement, unmeasured usage and gaps stay unknown.
Only provider-exposed captured reasoning is available; hidden model thoughts
and exact provider compute time are unavailable. No cost estimate is invented.

## Historical evidence and operator commands

Save a Studio diagnostic/native export or conversation export as a JSON file:

```powershell
node ./src/cli.mjs import --input "C:\chosen\export.json" --source history --include-content
node ./src/cli.mjs doctor
node ./src/cli.mjs status
node ./src/cli.mjs sessions
node ./src/cli.mjs overview --session "returned-session-id"
node ./src/cli.mjs timeline --session "returned-session-id" --after 0
node ./src/cli.mjs export --session "returned-session-id" --output "C:\chosen\new-archive.json" --include-content
```

Imports support version 1 `project-studio.diagnostics`,
`project-studio.native-diagnostics`, `project-studio.conversation-export`
(`formatVersion: 1`), and `studio-inspector.archive`. Unknown fields/records in
known envelopes survive bounded policy processing; unsupported formats fail.
Conversation exports provide journal evidence, not provider timing or complete
execution traces. Reimport with the same source label deduplicates retained IDs.
Use a distinct source label for a separate Studio installation to prevent opaque
conversation IDs colliding. Source labels scope identity; they do not authorize.

Exports refuse to overwrite a file. `erase` deletes only the configured Inspector
store's retained evidence; stop collector processes first to prevent refilling:

```powershell
node ./src/cli.mjs erase
```

Stopping sharing removes Studio's current feed; clearing source capture removes
its current feed and fences old writers. It does not erase Inspector archives or
exports. Source consent sync/polling is not instantaneous (normally three seconds
plus read time). A crash can leave a stale snapshot, which the collector refuses
after 15 seconds; the next Studio startup removes its owned feed.

## Bounds and limitations

- Studio publishes atomic snapshots with fixed admitted diagnostic GETs, private
  owner credentials, no redirects, bounded pages and epoch checks. It never
  routes model traffic through Inspector. Sharing is an independent background
  reader and can miss events already evicted from Studio's ring.
- Inputs: 48 MiB; feed: 40 MiB; retained events: 20,000 / 32 MiB logical evidence;
  event: 192 KiB; payload: 128 KiB. SQLite has a 128 MiB page ceiling, separate
  from bounded JSON bytes. Metadata/index space counts toward that ceiling.
  Source health is limited to 64 KiB. Disk-full failures do not advance cursors.
- Seven-day retention uses collector receipt time and is pruned on ingestion or
  collector failures. Stopping the collector leaves its existing file in place.
  Counts, bytes, loss, content omissions and possible retention gaps are reported.
  Strings, arrays, fields and depth have explicit projection/omission markers.
- MCP uses newline JSON-RPC stdio; it opens the configured store read-only.
  Queries and raw text are paged, waits bounded, incoming frames limited to 64 KiB
  and concurrent requests to eight. No arbitrary path/network/SQL/execute,
  capture-control, import, deletion or repair tools are offered to an assistant.
- Native clocks, harness clocks, delivery and receipt order remain distinct.
  Overview uses deduplicated leaf model-turn usage, not nested rollups. Findings
  identify observed failed boundaries, not an automatically proven root cause.
- This V0 consumes Studio evidence. Using it from Codex or Claude does not also
  instrument those applications. No web dashboard, autonomous repair, background
  AI scheduler or public HTTP MCP endpoint is included.

Run `npm run check` here. Native/client bridge checks are described in the
[implementation tracker](../documentation/work/studio-inspector-progress.md).
Architecture and boundary ownership live in
[the durable contract](../documentation/architecture/studio-inspector.md).
